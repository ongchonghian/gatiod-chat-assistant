import type {
  GatiodSystemKey,
  GroundingResult,
  NormalizedUtterance,
  PolicyDecision,
  ReadinessResult,
  RouteDecision,
  ToolPlanCall,
  V2SessionState,
  V2SystemFacts,
} from "./contracts.js";
import { collectCalculatedSubtotals, getInstances, hashExtractedFacts } from "./stateMachine.js";
import { decideSlotAction } from "./dialoguePolicy.js";
import { isConfirmation, isEditRequest } from "./factPatch.js";
import { buildLegacyConfirmation, buildStructuredConfirmation } from "./confirmationBuilder.js";
import { V2_SYSTEM_REGISTRY, isStructuredLiveSystem, requireStructuredCapability } from "./systemRegistry.js";
import { SYSTEM_SELECTION_PATTERN } from "./systemSelection.js";
import {
  buildGlobalCvcOffer,
  getCalculatedSystems,
  verifyGlobalCvcSnapshot,
} from "./globalCvc.js";
import { validateUpperLimbReadinessFromSchema } from "./slotSchemas/upperLimbExtractor.js";

export type ShadowAuditEvent =
  | { type: "readiness_shadow_agreement"; system: string; ready: boolean }
  | { type: "readiness_shadow_disagreement"; system: string; primaryReady: boolean; schemaReady: boolean; primaryMissing: string[] | undefined; schemaMissing: string[] | undefined }
  | { type: "readiness_shadow_failed"; system: string; error: string };

const READINESS_SHADOW_ENABLED = process.env.GATIOD_READINESS_SHADOW === "true";

function runUpperLimbReadinessShadow(
  primaryResult: ReadinessResult,
  systemState: V2SessionState["systems"][GatiodSystemKey],
  onShadowAudit: (event: ShadowAuditEvent) => void,
): void {
  try {
    const schemaResult = validateUpperLimbReadinessFromSchema(systemState);
    const primaryMissing = primaryResult.missingFields;
    const schemaMissing = schemaResult.missingFields;
    const readyDiffers = primaryResult.ready !== schemaResult.ready;
    const missingDiffers =
      JSON.stringify((primaryMissing ?? []).slice().sort()) !==
      JSON.stringify((schemaMissing ?? []).slice().sort());
    if (readyDiffers || missingDiffers) {
      onShadowAudit({
        type: "readiness_shadow_disagreement",
        system: "upper_limb",
        primaryReady: primaryResult.ready,
        schemaReady: schemaResult.ready,
        primaryMissing,
        schemaMissing,
      });
    } else {
      onShadowAudit({ type: "readiness_shadow_agreement", system: "upper_limb", ready: primaryResult.ready });
    }
  } catch (err) {
    onShadowAudit({ type: "readiness_shadow_failed", system: "upper_limb", error: String(err) });
  }
}

export { runUpperLimbReadinessShadow as runUpperLimbReadinessShadowForTest };

const GLOBAL_CVC_COMBINE_RE = /^(combine|confirm and combine|yes|y|ok|okay|proceed|confirmed)$/i;
const GLOBAL_CVC_ADD_SYSTEM_RE = /\b(add another system|add\s+system|another\s+system)\b/i;
const GLOBAL_CVC_EDIT_RE = /\b(edit (a )?finding|edit findings|edit)\b/i;

const CONTINUATION_REPLY_PATTERN = /^(no|yes|y|n|ok|okay|confirmed|proceed|continue|none)$/i;

const SYSTEM_DISPLAY_NAMES: Record<string, string> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro / Digestive",
  hearing: "Hearing",
  cns: "Central Nervous System",
  visual: "Visual",
};

function isSystemSelectionReply(normalized: NormalizedUtterance): boolean {
  return SYSTEM_SELECTION_PATTERN.test(normalized.normalizedText);
}

function isShortContinuationReply(normalized: NormalizedUtterance): boolean {
  const compact = normalized.normalizedText.trim().toLowerCase();
  if (CONTINUATION_REPLY_PATTERN.test(compact)) return true;
  return normalized.tokens.length > 0 && normalized.tokens.length <= 3 && normalized.unresolvedTerms.length === 0;
}

function proposeLookupTool(normalized: NormalizedUtterance, grounding: GroundingResult): ToolPlanCall {
  const top = grounding.ontologyMatches[0];

  if (top?.type === "nerve") {
    return {
      name: top.system === "lower_limb" ? "lookup_lower_nerve" : "lookup_nerve",
      args: top.system === "lower_limb"
        ? { nerveKey: top.canonicalId, deficitType: "combined", lossType: "partial" }
        : { nerveKey: top.canonicalId, deficitType: "combined", lossType: "partial" },
      status: "proposed",
      validation: {
        ok: true,
        message: "Ontology-matched nerve; defaulted to combined partial pending user correction.",
      },
    };
  }

  if (top?.type === "dbe") {
    return {
      name: top.system === "lower_limb" ? "lookup_lower_dbe_condition" : "lookup_dbe_condition",
      args: { conditionId: top.canonicalId },
      status: "proposed",
      validation: { ok: true, message: "Ontology-matched DBE condition." },
    };
  }

  return {
    name: "search_dictionary",
    args: { query: normalized.normalizedText.slice(0, 180) },
    status: "proposed",
    validation: { ok: true, message: "Fallback dictionary lookup for ambiguous term." },
  };
}

function shouldDoLookupFirstForAssessment(route: RouteDecision, grounding: GroundingResult): boolean {
  if (route.operation !== "assessment") return false;
  const top = grounding.ontologyMatches[0];
  if (!top) return false;
  if (top.score < 0.5) return false;
  return top.type === "dbe" || top.type === "nerve" || top.type === "amputation";
}

export function makePolicyDecision(
  route: RouteDecision,
  normalized: NormalizedUtterance,
  grounding: GroundingResult,
  state: V2SessionState,
  onShadowAudit?: (event: ShadowAuditEvent) => void,
): PolicyDecision {
  // ── Pending Global CVC offer (Q4) ─────────────────────────────────────────
  // After ≥2 systems calculate, the assistant offers a combination. The
  // doctor's reply is interpreted here before the regular system-confirmation
  // flow so a chip click ("Combine") doesn't get routed as a new utterance.
  if (state.pendingGlobalCvcConfirmation) {
    const text = normalized.normalizedText.trim();

    if (GLOBAL_CVC_COMBINE_RE.test(text)) {
      const verification = verifyGlobalCvcSnapshot(state, state.pendingGlobalCvcConfirmation);
      if (!verification.ok) {
        // Snapshot is stale — re-offer with current values. The chat service
        // refreshes the pending snapshot from `pendingGlobalCvcSnapshot` so
        // the next "Combine" reply verifies against the new component values.
        const reOffer = buildGlobalCvcOffer(state);
        return {
          action: "clarify",
          reason:
            "Component PI values changed since the Global CVC offer was presented; re-offering with current values.",
          requiresConfirmation: true,
          clarificationQuestion:
            reOffer?.appendMessage ??
            "Component values changed since the offer was presented. Please review.",
          chips: reOffer?.chips,
          proposedTools: [],
          pendingGlobalCvcSnapshot: reOffer?.snapshot,
        };
      }

      const components = getCalculatedSystems(state);
      return {
        action: "execute_tools",
        reason: "Confirmed Global CVC offer; executing assess_global_cvc.",
        requiresConfirmation: false,
        proposedTools: [
          {
            name: "assess_global_cvc",
            args: {
              systemSubtotals: components.map((c) => ({
                system: c.system,
                piPercent: c.piPercent,
              })),
            },
            status: "proposed",
            validation: {
              ok: true,
              message: `Combining ${components.length} component PI value${components.length === 1 ? "" : "s"}.`,
            },
          },
        ],
      };
    }

    if (GLOBAL_CVC_ADD_SYSTEM_RE.test(text)) {
      return {
        action: "clarify",
        reason: "Doctor chose to add another system before global combine.",
        requiresConfirmation: false,
        clarificationQuestion:
          "Which system would you like to assess next? Tell me the findings and I'll route them.",
        chips: [
          "Upper Limb",
          "Lower Limb",
          "Spine",
          "Hearing",
          "Respiratory",
          "Renal",
          "Gastro-Digestive",
        ],
        proposedTools: [],
        clearPendingGlobalCvc: true,
      };
    }

    if (GLOBAL_CVC_EDIT_RE.test(text)) {
      return {
        action: "clarify",
        reason: "Doctor chose to edit a finding before global combine.",
        requiresConfirmation: false,
        clarificationQuestion:
          "Which finding would you like to edit? Tell me the system and what to change.",
        proposedTools: [],
        clearPendingGlobalCvc: true,
      };
    }

    // Anything else: fall through to regular handling. chatServiceV2 will
    // clear the pending offer on its next state update so the doctor isn't
    // trapped in a stale offer if they pivot to an unrelated topic.
  }

  // ── Confirmation / correction handling ──────────────────────────────────
  // When V2 has presented a structured confirmation, intercept the response
  // before routing to resolve it deterministically.
  if (state.pendingConfirmation) {
    const primary = state.pendingConfirmation.system;

    if (isConfirmation(normalized)) {
      // For structured_live systems: run readiness → hash check → arg builder → execute_tools (D8)
      if (isStructuredLiveSystem(primary)) {
        const cap = requireStructuredCapability(primary);
        const systemState = state.systems[primary];

        // Prefer instance-aware readiness when an active instance exists.
        const instanceValidator = V2_SYSTEM_REGISTRY[primary].instanceReadinessValidator;
        const activeInstance = instanceValidator
          ? getInstances(state, primary).filter((i) => i.status !== "calculated")
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
          : undefined;
        const readiness: ReadinessResult = activeInstance && instanceValidator
          ? instanceValidator(activeInstance)
          : cap.readinessValidator(systemState);
        if (READINESS_SHADOW_ENABLED && primary === "upper_limb" && !activeInstance && onShadowAudit) {
          runUpperLimbReadinessShadow(readiness, systemState, onShadowAudit);
        }
        if (!readiness.ready) {
          return {
            action: "clarify",
            reason: `Readiness check failed: ${readiness.reason}`,
            requiresConfirmation: false,
            clarificationQuestion: readiness.clarificationQuestion ?? "Additional information is required before calculating.",
            chips: readiness.candidateAnswers,
            proposedTools: [],
          };
        }

        // Prefer instance-scoped facts for hash check and arg builder when an active instance exists.
        const factsForBuild: V2SystemFacts = activeInstance
          ? (activeInstance.facts as V2SystemFacts)
          : systemState.extractedFacts;
        const pendingHash = activeInstance
          ? activeInstance.confirmation.factsHash
          : systemState.confirmation.factsHash;
        const currentHash = hashExtractedFacts(factsForBuild);
        if (pendingHash && pendingHash !== currentHash) {
          return {
            action: "clarify",
            reason: "Facts changed since confirmation was presented; confirmation is stale.",
            requiresConfirmation: true,
            clarificationQuestion: "__REBUILD_CONFIRMATION__",
            chips: [],
            proposedTools: [],
          };
        }

        const built = cap.argBuilder(factsForBuild);
        if (!built.ok) {
          return {
            action: "clarify",
            reason: `Arg builder failed: ${built.warnings.join("; ")}`,
            requiresConfirmation: false,
            clarificationQuestion: `I could not build the assessment arguments: ${built.warnings.join("; ")}. Please review the entered findings.`,
            chips: ["Review findings"],
            proposedTools: [],
          };
        }

        const toolCall: ToolPlanCall = {
          name: built.toolName,
          args: built.args as Record<string, unknown>,
          status: "proposed",
          validation: { ok: true, message: "Validated structured V2 payload." },
        };
        return {
          action: "execute_tools",
          reason: "Confirmed structured V2 assessment; executing deterministic tool.",
          requiresConfirmation: false,
          proposedTools: [toolCall],
        };
      }

      // Unmigrated system — delegate to legacy which calls assess_* from conversation history.
      return {
        action: "delegate_legacy",
        reason: "Doctor confirmed extracted findings; delegating to legacy assessor to call assess_* tool.",
        requiresConfirmation: false,
        proposedTools: [
          {
            name: `assess_${primary}`,
            args: { routedSystems: [primary] },
            status: "proposed",
            validation: { ok: true, message: "Facts confirmed by doctor; ready for assessment tool call." },
          },
        ],
      };
    }

    if (isEditRequest(normalized)) {
      // User wants to edit — signal to chatServiceV2 to clear confirmation and re-enter slot loop.
      return {
        action: "clarify",
        reason: "Doctor requested edits to the confirmation summary; returning to slot collection.",
        requiresConfirmation: false,
        clarificationQuestion: "Of course — what would you like to change?",
        chips: ["Change side", "Change ROM values", "Change nerve finding", "No nerve deficit", "No amputation"],
        proposedTools: [],
      };
    }

    // Treat as a correction: re-extract values and rebuild confirmation.
    // chatServiceV2 will call buildFactPatch and update extractedValues.
    return {
      action: "clarify",
      reason: "Correction detected while confirmation was pending; updating facts and re-confirming.",
      requiresConfirmation: false,
      clarificationQuestion: "__REBUILD_CONFIRMATION__", // sentinel: chatServiceV2 rebuilds this
      chips: [],
      proposedTools: [],
    };
  }

  const selectingSystem = isSystemSelectionReply(normalized) && route.systems.length > 0;
  const allowLowConfidenceSelection = selectingSystem && state.pendingClarification !== null;

  if (route.operation === "clarify" && state.pendingClarification === null && isShortContinuationReply(normalized)) {
    return {
      action: "delegate_legacy",
      reason: "Short continuation reply detected; continue the active assessment flow instead of restarting routing.",
      requiresConfirmation: false,
      proposedTools: [
        {
          name: "assess_*",
          args: { routedSystems: route.systems },
          status: "proposed",
          validation: {
            ok: true,
            message: "Delegated to legacy conversational flow to resolve follow-up in existing context.",
          },
        },
      ],
    };
  }

  // Single unambiguous system gets a relaxed threshold to avoid asking
  // "which system?" when only one was plausibly detected. Multi-system routes
  // still need higher confidence because misrouting is more consequential.
  const confidenceThreshold = route.systems.length === 1 ? 0.4 : 0.55;
  if (route.operation === "clarify" || (route.confidence < confidenceThreshold && !allowLowConfidenceSelection)) {
    // Similar-term confirmation: when the router found no system but synonym
    // candidates exist for unresolved terms, ask a targeted "did you mean?"
    // instead of the generic system-picker.
    const candidates = route.candidateSystems ?? [];
    if (candidates.length > 0 && route.systems.length === 0) {
      const top = candidates[0];
      const topName = SYSTEM_DISPLAY_NAMES[top.system] ?? top.system;
      let question: string;
      let chips: string[];
      if (candidates.length === 1) {
        question = `You mentioned "${top.term}", which usually relates to **${topName}**. Should I proceed with a ${topName} assessment?`;
        chips = [`Yes — ${topName}`, "Choose another system"];
      } else {
        const list = candidates.slice(0, 3).map((c) => {
          const name = SYSTEM_DISPLAY_NAMES[c.system] ?? c.system;
          return `**${name}** (from "${c.term}")`;
        }).join(", ");
        question = `I see terms that may relate to multiple systems: ${list}. Which would you like to assess first?`;
        chips = candidates.slice(0, 4).map((c) => SYSTEM_DISPLAY_NAMES[c.system] ?? c.system);
      }
      return {
        action: "clarify",
        reason: `Similar-term confirmation: ${candidates.map((c) => `${c.term}→${c.system}`).join(", ")}`,
        requiresConfirmation: false,
        clarificationQuestion: question,
        chips,
        proposedTools: [],
      };
    }

    const question = normalized.unresolvedTerms.length > 0
      ? `I may be missing terms (${normalized.unresolvedTerms.join(", ")}). Which body system should I assess first?`
      : "Please clarify which GATIOD system you want to assess first (e.g., spine, lower limb, upper limb).";

    return {
      action: "clarify",
      reason: "Routing confidence below safe threshold.",
      requiresConfirmation: false,
      clarificationQuestion: question,
      proposedTools: [],
    };
  }

  if (route.operation === "global_cvc") {
    const subtotals = collectCalculatedSubtotals(state);
    if (subtotals.length < 2) {
      return {
        action: "clarify",
        reason: "Global CVC requires at least 2 computed system subtotals.",
        requiresConfirmation: false,
        clarificationQuestion: "I need at least two completed system assessments before running global CVC. Which system should we assess next?",
        proposedTools: [],
      };
    }

    return {
      action: "execute_tools",
      reason: "Sufficient completed system subtotals for global CVC.",
      requiresConfirmation: false,
      proposedTools: [
        {
          name: "assess_global_cvc",
          args: { systemSubtotals: subtotals },
          status: "proposed",
          validation: { ok: true, message: `Using ${subtotals.length} completed system subtotals.` },
        },
      ],
    };
  }

  if (route.operation === "lookup") {
    return {
      action: "execute_tools",
      reason: "Lookup intent detected; perform low-risk retrieval before assessment calls.",
      requiresConfirmation: false,
      proposedTools: [proposeLookupTool(normalized, grounding)],
    };
  }

  if (shouldDoLookupFirstForAssessment(route, grounding)) {
    // Slice-24 — skip lookup-first for structured_live systems. The
    // extractor's DBE auto-population (slice 23) already wrote
    // FK_DBE_SELECTIONS as a fact, and the structured readiness path
    // below will present the confirmation card. Without this skip, the
    // doctor's first turn returned a lookup-tool result ("Mapped
    // successfully") and the second-turn "Confirmed" had no
    // pendingConfirmation to act on — assessment never ran.
    const primary = route.systems[0];
    if (!primary || !isStructuredLiveSystem(primary)) {
      const top = grounding.ontologyMatches[0]!;
      return {
        action: "execute_tools",
        reason: `Assessment intent with high-confidence ${top.type} match; lookup-first grounding before full assessment.`,
        requiresConfirmation: false,
        proposedTools: [proposeLookupTool(normalized, grounding)],
      };
    }
  }

  // Before delegating to legacy: run the slot / confirmation decision.
  // Guard: skip when a pending clarification is still unresolved (user is still selecting a system).
  if (!state.pendingClarification && route.systems.length > 0) {
    const primarySystem = route.systems[0];
    const systemState = state.systems[primarySystem];

    // For structured_live systems bypass the old slot-signal path entirely and use the
    // readiness validator — slot signals are coarser than extractedFacts and can drive
    // the wrong clarification question (e.g. asking for left-ear AHL on a right-ear case).
    if (isStructuredLiveSystem(primarySystem)) {
      const cap = requireStructuredCapability(primarySystem);

      // Prefer instance-aware readiness when an active instance exists.
      const instanceValidator = V2_SYSTEM_REGISTRY[primarySystem].instanceReadinessValidator;
      const activeInstance = instanceValidator
        ? getInstances(state, primarySystem).filter((i) => i.status !== "calculated")
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        : undefined;
      const readiness: ReadinessResult = activeInstance && instanceValidator
        ? instanceValidator(activeInstance)
        : cap.readinessValidator(systemState);
      if (READINESS_SHADOW_ENABLED && primarySystem === "upper_limb" && !activeInstance && onShadowAudit) {
        runUpperLimbReadinessShadow(readiness, systemState, onShadowAudit);
      }

      if (!readiness.ready) {
        // Surface the pending-observation question from whichever source holds it.
        const firstObs =
          (activeInstance?.pendingObservations ?? []).concat(systemState.pendingObservations)[0];
        if (readiness.reason === "pending_observations" && firstObs) {
          return {
            action: "clarify",
            reason: "Pending observation requires resolution before proceeding.",
            requiresConfirmation: false,
            clarificationQuestion: firstObs.clarificationQuestion,
            chips: firstObs.candidateAnswers,
            proposedTools: [],
          };
        }

        return {
          action: "clarify",
          reason: `Readiness check failed: ${readiness.reason}`,
          requiresConfirmation: false,
          clarificationQuestion: readiness.clarificationQuestion ?? "Additional information is required before calculating.",
          chips: readiness.candidateAnswers,
          proposedTools: [],
        };
      }

      // All required facts present — present structured confirmation built from extractedFacts.
      // Fail-closed: if the confirmation builder cannot render (missing required
      // facts that readiness somehow let through), surface a clarification
      // listing the missing fields rather than presenting a soft message.
      const confirmResult = buildStructuredConfirmation(primarySystem, systemState.extractedFacts);
      if (!confirmResult.ok) {
        return {
          action: "clarify",
          reason: `Confirmation builder rejected facts: ${confirmResult.reason}`,
          requiresConfirmation: false,
          clarificationQuestion:
            `I cannot present a confirmation yet — required fields are missing: ${confirmResult.missingFields.join(", ")}. ` +
            `Please provide the missing details.`,
          proposedTools: [],
        };
      }
      return {
        action: "clarify",
        reason: "All required facts confirmed; presenting structured confirmation before calculation.",
        requiresConfirmation: true,
        clarificationQuestion: confirmResult.message,
        chips: ["Confirm and calculate", "Edit findings"],
        proposedTools: [],
      };
    }

    // Legacy slot-signal path for non-structured-live systems.
    const slotAction = decideSlotAction(primarySystem, systemState?.slotSignals ?? {});

    if (slotAction.type === "ASK") {
      return {
        action: "clarify",
        reason: `Missing required slot: ${slotAction.slotKey}`,
        requiresConfirmation: false,
        clarificationQuestion: slotAction.question,
        chips: slotAction.chips,
        proposedTools: [],
      };
    }

    if (slotAction.type === "CONFIRM") {
      const built = buildLegacyConfirmation(
        primarySystem,
        systemState?.extractedValues ?? {},
        systemState?.slotSignals ?? {}
      );
      if (!built.ok) {
        return {
          action: "clarify",
          reason: `Legacy confirmation builder rejected facts: ${built.reason}`,
          requiresConfirmation: false,
          clarificationQuestion:
            `I cannot present a confirmation yet — no findings have been extracted. ` +
            `Please describe the injury or assessment in more detail.`,
          proposedTools: [],
        };
      }
      return {
        action: "clarify",
        reason: "All required slots satisfied; presenting structured confirmation before calculation.",
        requiresConfirmation: true,
        clarificationQuestion: built.message,
        chips: ["Confirm and calculate", "Edit findings"],
        proposedTools: [],
      };
    }
  }

  return {
    action: "delegate_legacy",
    reason: "Assessment intent detected; hand off extraction/calculation to legacy assessor while v2 tracks routing and policy.",
    requiresConfirmation: true,
    proposedTools: [
      {
        name: "assess_*",
        args: { routedSystems: route.systems },
        status: "proposed",
        validation: {
          ok: true,
          message: "Assessment tool execution delegated to legacy flow that handles detailed confirmation protocol.",
        },
      },
    ],
  };
}
