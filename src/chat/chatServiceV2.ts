import { handleToolCall } from "../tools/toolHandlers.js";
import { processChat } from "./chatService.js";
import { loadSession, saveSessionSystemStates } from "../db/sessionStore.js";
import { logAuditEvent } from "../db/auditLog.js";
import type { ChatV2Response, GatiodSystemKey, ToolPlanCall, V2SessionState } from "../v2/contracts.js";
import { normalizeClinicalUtterance } from "../v2/normalizer.js";
import { retrieveGrounding } from "../v2/hybridRetriever.js";
import { routeUtterance } from "../v2/router.js";
import { makePolicyDecision } from "../v2/policyEngine.js";
import {
  applyInstanceFactsPatch,
  applyStructuredExtraction,
  applyToolResults,
  coerceV2State,
  defaultV2SessionState,
  getInstanceById,
  getInstances,
  setPendingClarification,
  setPendingConfirmation,
  setPendingExtractorComparison,
  setPendingGlobalCvcConfirmation,
  setPendingSlotCorrection,
  toSystemStateEnvelope,
  updateExtractedValues,
  updateSlotSignals,
  upsertInstance,
  withRoute,
} from "../v2/stateMachine.js";
import {
  buildComparisonOffer,
  buildSlotCorrectionOffer,
  isComparisonEnabled,
  mergeExtractionResults,
  resolveComparisonChoice,
} from "../v2/slotSchemas/extractorComparison.js";
import {
  canCreateInstance,
  parseInstanceId,
} from "../v2/assessmentInstanceRules.js";
import type { V2AssessmentInstance } from "../v2/contracts.js";
import { extractSignals, extractValues, mergeSignals } from "../v2/slotEvaluator.js";
import { applySignalClear, buildFactPatch, isConfirmation } from "../v2/factPatch.js";
import { buildGlobalCvcOffer, renderGlobalCvcResult, shouldOfferGlobalCvc } from "../v2/globalCvc.js";
import { buildLegacyConfirmation, buildStructuredConfirmation } from "../v2/confirmationBuilder.js";
import { V2_SYSTEM_REGISTRY, isStructuredLiveSystem } from "../v2/systemRegistry.js";
import { tryResolvePendingObservation } from "../v2/pendingObservationResolver.js";
import { buildNextClaimStep } from "../v2/claimPlan.js";
import { randomUUID } from "crypto";
import type { PendingObservation, ReadinessResult } from "../v2/contracts.js";

/**
 * When a readiness validator declares an `expectedAnswer` for the missing
 * field, write a PendingObservation onto the system state so the next
 * turn's reply is graduated by the generic resolver in
 * `pendingObservationResolver.ts` instead of going through normal extraction
 * (which doesn't know what the doctor is answering). Issue #12, RC-5.
 */
export function writeReadinessAsPendingObservation(
  state: V2SessionState,
  system: GatiodSystemKey,
  readiness: ReadinessResult,
  sourceText: string,
): V2SessionState {
  if (!readiness.expectedAnswer) return state;
  const sysState = state.systems[system];
  // Don't duplicate if there's already a pending observation for the same
  // factKey (re-asking the same readiness question is normal).
  const factKey = readiness.expectedAnswer.factKey;
  const alreadyPending = sysState.pendingObservations.some(
    (po) => po.expectedAnswer?.factKey === factKey,
  );
  if (alreadyPending) return state;

  const obs: PendingObservation = {
    id: `po-readiness-${randomUUID()}`,
    system,
    type: classifyReadinessObsType(system),
    sourceText,
    parsed: { subtype: factKey },
    missingFields: readiness.missingFields ?? [factKey],
    clarificationQuestion: readiness.clarificationQuestion ?? "Please provide the missing field.",
    candidateAnswers: readiness.candidateAnswers,
    expectedAnswer: readiness.expectedAnswer,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...sysState,
        pendingObservations: [...sysState.pendingObservations, obs],
      },
    },
  };
}

function classifyReadinessObsType(system: GatiodSystemKey): PendingObservation["type"] {
  switch (system) {
    case "renal":
      return "renal_value";
    case "respiratory":
      return "respiratory_value";
    case "spine":
      return "spine_category";
    case "hearing":
      return "hearing_value";
    default:
      return "other";
  }
}
import {
  runConsensusOrchestrator,
  type ConsensusOrchestratorResult,
} from "../v2/consensusOrchestrator.js";
import type { SemanticModelClient } from "../v2/semanticInterpreter.js";
import { renderV2Failure } from "../v2/failureRenderer.js";
import { applyInstanceToolResult, setConfirmationConfirmed, setConfirmationPending, setInstanceConfirmationPending } from "../v2/stateMachine.js";
import { buildTraceForSystem } from "../v2/systemTraceAdapters.js";

const SYSTEM_DISPLAY_NAMES: Record<GatiodSystemKey, string> = {
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

const SYSTEM_KEY_LIST: GatiodSystemKey[] = [
  "spine", "upper_limb", "lower_limb", "hearing", "visual",
  "respiratory", "renal", "gastro_digestive", "cns",
];

interface NextSystemHandoff {
  system: GatiodSystemKey;
  appendMessage: string;
  chips: string[];
  pendingConfirmation: boolean;
}

/**
 * Translate the unified ClaimStep returned by `buildNextClaimStep` into the
 * legacy `NextSystemHandoff` shape used by the post-calc rendering path.
 *
 * After a system finishes calculating, the unified claim plan picks the next
 * actionable component across all known signals (extracted facts, pending
 * observations, claim component overrides — including detected/legacy_deferred
 * /unsupported overrides set by the consensus orchestrator). Issue #12 / RC-1.
 *
 * Exported for unit testing — the live calculation path consumes it through
 * the post-calc handoff branch below.
 */
export function buildNextSystemHandoff(
  state: V2SessionState,
  justCompleted: GatiodSystemKey
): NextSystemHandoff | undefined {
  const step = buildNextClaimStep(state, { justCompleted });
  if (!step) return undefined;

  switch (step.kind) {
    case "confirm_system": {
      const sysState = state.systems[step.system];
      const displayName = SYSTEM_DISPLAY_NAMES[step.system];
      const confirmResult = buildStructuredConfirmation(step.system, sysState.extractedFacts);
      if (!confirmResult.ok) {
        // Defense: claim plan flagged ready but builder refused. Skip rather
        // than present a half-formed confirmation.
        return undefined;
      }
      return {
        system: step.system,
        appendMessage: `**Continuing with ${displayName}.** I captured these findings from your earlier message:\n\n${confirmResult.message}`,
        chips: ["Confirm and calculate", "Edit findings"],
        pendingConfirmation: true,
      };
    }
    case "clarify_system": {
      const sysState = state.systems[step.system];
      const obs = sysState.pendingObservations[0];
      const chips = obs?.candidateAnswers ?? [];
      return {
        system: step.system,
        appendMessage: step.message,
        chips,
        pendingConfirmation: false,
      };
    }
    case "legacy_deferred":
    case "unsupported": {
      const displayName = SYSTEM_DISPLAY_NAMES[step.system];
      return {
        system: step.system,
        appendMessage: step.message,
        chips: step.chips ?? [`Use legacy for ${displayName}`, `Skip ${displayName}`],
        pendingConfirmation: false,
      };
    }
    case "claim_plan": {
      const recommended =
        step.components.find(
          (c) => c.status === "ready_for_confirmation" || c.status === "confirmation_pending",
        ) ??
        step.components.find(
          (c) => c.status === "needs_clarification" || c.status === "detected",
        );
      if (!recommended) return undefined;
      const ready =
        recommended.status === "ready_for_confirmation" ||
        recommended.status === "confirmation_pending";
      if (ready) {
        const sysState = state.systems[recommended.system];
        const confirmResult = buildStructuredConfirmation(recommended.system, sysState.extractedFacts);
        if (!confirmResult.ok) return undefined;
        const displayName = SYSTEM_DISPLAY_NAMES[recommended.system];
        return {
          system: recommended.system,
          appendMessage: `${step.message}\n\n**Continuing with ${displayName}.** I captured these findings from your earlier message:\n\n${confirmResult.message}`,
          chips: ["Confirm and calculate", "Edit findings"],
          pendingConfirmation: true,
        };
      }
      return {
        system: recommended.system,
        appendMessage: step.message,
        chips: step.chips ?? [],
        pendingConfirmation: false,
      };
    }
    case "offer_global_cvc":
      // Global-CVC offer is handled by the dedicated `shouldOfferGlobalCvc`
      // branch below; the post-calc handoff itself returns undefined.
      return undefined;
  }
}

interface ProcessChatV2Options {
  userId?: string;
  claimId?: string;
  shadow?: boolean;
  /** Optional injected semantic model client. When omitted, the consensus
   *  orchestrator falls back to the lazy default — currently only the
   *  Gemini-backed client (constructed at first invocation when the
   *  feature flag is on). Tests pass a stub. */
  semanticModelClient?: SemanticModelClient;
}

/** Issue #12 / RC-3: in the chat path, the consensus orchestrator runs by
 *  default. An explicit `SEMANTIC_CONSENSUS_ENABLED=false` (or `=0`) acts
 *  as an emergency kill-switch. Same for the interpreter flag. Tests that
 *  call `runConsensusOrchestrator` directly are unaffected because the
 *  orchestrator's own env-var defaults are still missing→off. */
function isConsensusKillSwitched(): boolean {
  const flag = process.env.SEMANTIC_CONSENSUS_ENABLED;
  return flag === "false" || flag === "0";
}
function isInterpreterKillSwitched(): boolean {
  const flag = process.env.SEMANTIC_INTERPRETER_ENABLED;
  return flag === "false" || flag === "0";
}

/** Lazily-constructed default model client. Built only when the consensus
 *  orchestrator is actually invoked AND the feature flag is on, so the
 *  GEMINI_API_KEY check never runs for tests with flags off. */
let _defaultSemanticClient: SemanticModelClient | undefined;
function getDefaultSemanticClient(): SemanticModelClient | undefined {
  if (_defaultSemanticClient) return _defaultSemanticClient;
  try {
    // Dynamic require avoids loading the Gemini SDK at module-init time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../v2/geminiSemanticModelClient.js") as {
      GeminiSemanticModelClient: new () => SemanticModelClient;
    };
    _defaultSemanticClient = new mod.GeminiSemanticModelClient();
    return _defaultSemanticClient;
  } catch {
    // Missing API key or SDK error — return undefined; orchestrator will
    // passthrough rather than error.
    return undefined;
  }
}

function mapLegacyToolCalls(toolCalls: { name: string; result: unknown }[] | undefined): ToolPlanCall[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls.map((tc) => {
    const result = tc.result as { success?: boolean; data?: unknown; error?: string };
    const ok = Boolean(result?.success);
    return {
      name: tc.name,
      args: {},
      status: ok ? "executed" : "failed",
      validation: {
        ok,
        message: ok ? "Executed by legacy flow." : result?.error ?? "Legacy call failed",
      },
      result: result?.data ?? result,
    } as ToolPlanCall;
  });
}

function formatV2Message(base: {
  policyReason: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  toolPlan: ToolPlanCall[];
  routeSummary: string;
  legacyMessage?: string;
}): string {
  if (base.legacyMessage) return base.legacyMessage;
  if (base.needsClarification) return base.clarificationQuestion ?? "Please clarify the target system.";
  if (base.toolPlan.length > 0) {
    return `Route: ${base.routeSummary}. Policy: ${base.policyReason}. Proposed tool(s): ${base.toolPlan.map((t) => t.name).join(", ")}.`;
  }
  return `Route: ${base.routeSummary}. Policy: ${base.policyReason}.`;
}

function formatLookupExecutionMessage(executed: ToolPlanCall[], fallback: string): string {
  if (executed.length !== 1) return fallback;
  const call = executed[0];
  if (call.status !== "executed") return fallback;

  const data = (call.result ?? {}) as Record<string, unknown>;
  if (call.name === "lookup_lower_dbe_condition" || call.name === "lookup_dbe_condition") {
    const exact = Boolean(data.exactMatch);
    if (exact) {
      const label = String(data.label ?? "Matched condition");
      const minPercent = typeof data.minPercent === "number" ? data.minPercent : null;
      const maxPercent = typeof data.maxPercent === "number" ? data.maxPercent : null;
      const range = (minPercent !== null && maxPercent !== null) ? `${minPercent}%` + (minPercent === maxPercent ? "" : `–${maxPercent}%`) : "the mapped PI range";
      return `Mapped successfully: **${label}** (${range}). I can include this in the lower-limb DBE stream. Please confirm if you want me to proceed and share any additional lower-limb findings (amputation, ROM, neurological, or shortening).`;
    }
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    if (suggestions.length > 0) {
      const top = suggestions.slice(0, 3).map((s) => String((s as Record<string, unknown>).label ?? "")).filter(Boolean);
      if (top.length > 0) {
        return `I found likely DBE matches: ${top.join("; ")}. Please tell me which one applies.`;
      }
    }
  }

  if (call.name === "lookup_lower_nerve" || call.name === "lookup_nerve") {
    const nerve = String(data.nerve ?? "Nerve");
    const pct = typeof data.adjustedPercent === "number" ? data.adjustedPercent : null;
    return pct !== null
      ? `Mapped nerve finding: **${nerve}** (estimated ${pct}%). Please confirm deficit type/loss type if you want to refine this.`
      : fallback;
  }

  return fallback;
}

function loadV2State(sessionId: string): { raw: Record<string, unknown>; state: V2SessionState } {
  const loaded = loadSession(sessionId);
  const rawSystemState = (loaded?.systemStates ?? {}) as Record<string, unknown>;
  const state = loaded ? coerceV2State(rawSystemState) : defaultV2SessionState();
  return { raw: rawSystemState, state };
}

export async function processChatV2(
  sessionId: string,
  userMessage: string,
  opts?: ProcessChatV2Options
): Promise<ChatV2Response> {
  const shadow = Boolean(opts?.shadow);
  const { raw, state: initialLoadedState } = loadV2State(sessionId);

  // `loadedState` and `normalized` may be substituted by the consensus
  // orchestrator (Slice F): when the doctor accepts a semantic interpretation,
  // extraction runs against `pendingConsensus.sourceText`, not the doctor's
  // "Proceed" reply.
  let loadedState: V2SessionState = initialLoadedState;
  let normalized = normalizeClinicalUtterance(userMessage);
  let effectiveUserMessage: string = userMessage;
  // Captured from the consensus orchestrator when the doctor accepts a
  // semantic interpretation. Threaded through to deterministic extractors
  // (REQ-MS-EXTRACT-001). Read-only and ephemeral — must not be persisted
  // into V2SystemState.
  let activeExtractionContext: import("../v2/contracts.js").ExtractionContext | undefined;
  logAuditEvent({
    sessionId,
    userId: opts?.userId,
    eventType: "v2_normalization",
    eventData: {
      confidence: normalized.confidence,
      unresolvedTerms: normalized.unresolvedTerms,
      mappedTokenCount: normalized.mappedTokens.length,
    },
  });

  // ── ADR-0004: per-turn extraction control sets ─────────────────────────────
  // skipExtractionSystems: systems whose facts are already applied this turn
  //   (comparison choice resolved) — skip the extraction loop for them.
  // suppressShadowForSystems: systems where shadow should not run this turn
  //   (prevents the comparison dialog re-triggering after "Both wrong").
  const skipExtractionSystems = new Set<GatiodSystemKey>();
  const suppressShadowForSystems = new Set<GatiodSystemKey>();

  // ── ADR-0004 Gate 1: pending slot correction ───────────────────────────────
  // The doctor chose "Both wrong" on the previous turn and is now re-stating
  // the correct values. Clear the correction marker so the primary extractor
  // runs normally this turn. Shadow is suppressed to avoid re-triggering the
  // comparison dialog for this system.
  {
    const pendingCorrection = loadedState.pendingSlotCorrection;
    if (pendingCorrection) {
      loadedState = setPendingSlotCorrection(loadedState, null);
      suppressShadowForSystems.add(pendingCorrection.system);
      logAuditEvent({
        sessionId,
        userId: opts?.userId,
        eventType: "v2_extractor_comparison_resolved",
        eventData: {
          system: pendingCorrection.system,
          choice: "correction_utterance",
          correctionId: pendingCorrection.id,
        },
      });
      // Fall through — primary extractor re-runs on doctor's correction message.
    }
  }

  // ── ADR-0004 Gate 2: pending extractor comparison ─────────────────────────
  // The doctor is choosing which extractor output is accurate. Resolve the
  // choice and either apply the chosen result (Use A / Use B / Both correct)
  // or enter field-by-field correction (Both wrong). In all cases return early
  // after this block so the pending-observation gate sees the correct state.
  {
    const pendingComparison = loadedState.pendingExtractorComparison;
    if (pendingComparison) {
      const choice = resolveComparisonChoice(userMessage, pendingComparison);

      if (!choice) {
        // Unrecognised reply — re-present the comparison message.
        const enveloped = toSystemStateEnvelope(loadedState, raw);
        saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
        const compGrounding = retrieveGrounding(normalized.normalizedText);
        const compRoute = routeUtterance(normalized, compGrounding, loadedState);
        return {
          sessionId,
          message: pendingComparison.message,
          route: compRoute,
          grounding: compGrounding,
          needsClarification: true,
          clarificationQuestion: pendingComparison.message,
          suggestedChips: pendingComparison.chips,
          toolPlan: { proposed: [], actual: [] },
          policy: {
            action: "clarify",
            reason: "extractor_comparison_pending",
            requiresConfirmation: false,
            clarificationQuestion: pendingComparison.message,
            chips: pendingComparison.chips,
            proposedTools: [],
          },
          shadowMode: shadow,
        };
      }

      logAuditEvent({
        sessionId,
        userId: opts?.userId,
        eventType: "v2_extractor_comparison_resolved",
        eventData: {
          comparisonId: pendingComparison.id,
          system: pendingComparison.system,
          choice,
          hasConflicts: pendingComparison.hasConflicts,
        },
      });

      if (choice === "both_wrong") {
        // Doctor rejected both outputs — ask them to re-state the correct values.
        const slotCorrection = buildSlotCorrectionOffer(pendingComparison);
        const newState = setPendingSlotCorrection(
          setPendingExtractorComparison(loadedState, null),
          slotCorrection,
        );
        const enveloped = toSystemStateEnvelope(newState, raw);
        saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
        const corrGrounding = retrieveGrounding(normalized.normalizedText);
        const corrRoute = routeUtterance(normalized, corrGrounding, newState);
        return {
          sessionId,
          message: slotCorrection.message,
          route: corrRoute,
          grounding: corrGrounding,
          needsClarification: true,
          clarificationQuestion: slotCorrection.message,
          suggestedChips: [],
          toolPlan: { proposed: [], actual: [] },
          policy: {
            action: "clarify",
            reason: "awaiting_slot_correction",
            requiresConfirmation: false,
            clarificationQuestion: slotCorrection.message,
            chips: [],
            proposedTools: [],
          },
          shadowMode: shadow,
        };
      }

      // "use_primary" | "use_shadow" | "both_correct" — apply the chosen result.
      const chosenResult =
        choice === "use_shadow"
          ? pendingComparison.shadowResult
          : choice === "both_correct"
            ? mergeExtractionResults(
                pendingComparison.primaryResult,
                pendingComparison.shadowResult,
              )
            : pendingComparison.primaryResult;

      // Apply to state. Any PendingObservations generated by this result will
      // be picked up by the pending-observation gate below.
      loadedState = applyStructuredExtraction(
        loadedState,
        pendingComparison.system,
        chosenResult,
      );
      loadedState = setPendingExtractorComparison(loadedState, null);
      // Skip re-extraction and suppress shadow for this system this turn.
      skipExtractionSystems.add(pendingComparison.system);
      suppressShadowForSystems.add(pendingComparison.system);
      // For structured_live systems: if the readiness validator fails after
      // applying the chosen extraction (e.g. side is still missing), proactively
      // write the failing condition as a pending observation. Without this the
      // pending-observation gate below has nothing to intercept on the next turn
      // and the laterality reply ("Left") falls through to the policy engine.
      {
        const resolvedCap = V2_SYSTEM_REGISTRY[pendingComparison.system];
        if (resolvedCap.mode === "structured_live" && resolvedCap.readinessValidator) {
          const readiness = resolvedCap.readinessValidator(
            loadedState.systems[pendingComparison.system],
          );
          if (!readiness.ready && readiness.expectedAnswer) {
            loadedState = writeReadinessAsPendingObservation(
              loadedState,
              pendingComparison.system,
              readiness,
              pendingComparison.sourceText,
            );
          }
        }
      }
      // Substitute the chip text with the original clinical utterance so the
      // pending-observation gate and policy engine see clinical input rather
      // than "Use B (LLM)" / "Use A (live)" (which produce unresolved terms).
      effectiveUserMessage = pendingComparison.sourceText;
      normalized = normalizeClinicalUtterance(pendingComparison.sourceText);
      // Fall through — pending-observation gate + policy engine handle next step.
    }
  }

  // ── V2-007a: pending-observation resolver gate ─────────────────────────────
  // Must run before grounding/route — short replies like "Flexion" lack context
  // to route correctly. Resolve against the pending observation first.
  const pendingSystem: GatiodSystemKey | undefined =
    loadedState.pendingConfirmation?.system ??
    (Object.entries(loadedState.systems) as [GatiodSystemKey, typeof loadedState.systems[GatiodSystemKey]][])
      .find(([, s]) => s.pendingObservations.length > 0)?.[0];

  if (pendingSystem && loadedState.systems[pendingSystem].pendingObservations.length > 0) {
    const resolution = tryResolvePendingObservation(loadedState, pendingSystem, normalized);
    if (resolution.auditEvent) {
      logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_pending_observation", eventData: resolution.auditEvent });
    }
    if (resolution.blocked) {
      // Re-ask with chips — don't proceed to grounding/route
      const clarification = resolution.clarificationQuestion ?? "Please answer the clarification to continue.";
      const enveloped = toSystemStateEnvelope(loadedState, raw);
      saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
      const grounding = retrieveGrounding(normalized.normalizedText);
      const route = routeUtterance(normalized, grounding, loadedState);
      return {
        sessionId,
        message: clarification,
        route,
        grounding,
        needsClarification: true,
        clarificationQuestion: clarification,
        suggestedChips: resolution.candidateAnswers,
        toolPlan: { proposed: [], actual: [] },
        policy: { action: "clarify", reason: "pending_observation_unresolved", requiresConfirmation: false, clarificationQuestion: clarification, chips: resolution.candidateAnswers, proposedTools: [] },
        shadowMode: shadow,
      };
    }
    if (resolution.resolved) {
      const grounding = retrieveGrounding(normalized.normalizedText);
      const route = routeUtterance(normalized, grounding, resolution.state);

      // If there are still pending observations, re-ask the next one.
      const remaining = resolution.state.systems[pendingSystem].pendingObservations;
      if (remaining.length > 0) {
        const enveloped = toSystemStateEnvelope(resolution.state, raw);
        saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
        const next = remaining[0];
        return {
          sessionId,
          message: next.clarificationQuestion,
          route,
          grounding,
          needsClarification: true,
          clarificationQuestion: next.clarificationQuestion,
          suggestedChips: next.candidateAnswers,
          toolPlan: { proposed: [], actual: [] },
          policy: { action: "clarify", reason: "next_pending_observation", requiresConfirmation: false, clarificationQuestion: next.clarificationQuestion, chips: next.candidateAnswers, proposedTools: [] },
          shadowMode: shadow,
        };
      }

      // No more pending observations — run the readiness validator before presenting confirmation.
      // This branch MUST set pendingConfirmation so the next "confirm" reply is intercepted by
      // the policy engine's confirmation-handling block (policyEngine.ts:80). Without it the
      // router produces operation:"clarify" for a bare "confirm" message and the policy falls
      // through to the generic "which system?" question.
      const pendingCap = V2_SYSTEM_REGISTRY[pendingSystem];
      let resolvedState = resolution.state;

      // Compute active instance once; used for both readiness check and confirmation snapshot.
      const activeInstanceForObs = pendingCap.instanceReadinessValidator
        ? getInstances(resolvedState, pendingSystem)
            .filter((i) => i.status !== "calculated")
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        : undefined;

      if (pendingCap.mode === "structured_live" && (pendingCap.readinessValidator || pendingCap.instanceReadinessValidator)) {
        const readiness =
          activeInstanceForObs && pendingCap.instanceReadinessValidator
            ? pendingCap.instanceReadinessValidator(activeInstanceForObs)
            : pendingCap.readinessValidator!(resolvedState.systems[pendingSystem]);
        if (!readiness.ready) {
          const clarification = readiness.clarificationQuestion ?? "Additional information is required before calculating.";
          resolvedState = writeReadinessAsPendingObservation(
            resolvedState,
            pendingSystem,
            readiness,
            userMessage,
          );
          resolvedState = { ...resolvedState, pendingClarification: clarification, pendingConfirmation: null };
          const enveloped = toSystemStateEnvelope(resolvedState, raw);
          saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
          logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_shadow_result", eventData: { shadow, proposed: [], actual: [], needsClarification: true } });
          return {
            sessionId,
            message: clarification,
            route,
            grounding,
            needsClarification: true,
            clarificationQuestion: clarification,
            suggestedChips: readiness.candidateAnswers,
            toolPlan: { proposed: [], actual: [] },
            policy: { action: "clarify", reason: "readiness_check_failed_after_obs_resolve", requiresConfirmation: false, clarificationQuestion: clarification, chips: readiness.candidateAnswers, proposedTools: [] },
            shadowMode: shadow,
          };
        }
      }

      // Readiness passed — present structured confirmation and commit pendingConfirmation to
      // session state so the doctor's "confirm" reply is handled by the policy engine.
      const sysStateForConfirm = resolvedState.systems[pendingSystem];
      // For structured_live systems read directly from extractedFacts so display keys
      // (right_ear_ahl, left_ear_ahl, etc.) don't mismatch the confirmation builder.
      let confirmMsg: string;
      if (isStructuredLiveSystem(pendingSystem)) {
        const built = buildStructuredConfirmation(pendingSystem, sysStateForConfirm.extractedFacts);
        if (!built.ok) {
          // Fail-closed: surface the missing fields rather than presenting a card.
          const fallback =
            `I cannot present a confirmation yet — required fields are missing: ${built.missingFields.join(", ")}. ` +
            `Please provide the missing details.`;
          resolvedState = setPendingClarification(resolvedState, fallback);
          const enveloped = toSystemStateEnvelope(resolvedState, raw);
          saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
          logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_shadow_result", eventData: { shadow, proposed: [], actual: [], needsClarification: true } });
          return {
            sessionId,
            message: fallback,
            route,
            grounding,
            needsClarification: true,
            clarificationQuestion: fallback,
            toolPlan: { proposed: [], actual: [] },
            policy: { action: "clarify", reason: `Confirmation builder rejected facts: ${built.reason}`, requiresConfirmation: false, clarificationQuestion: fallback, proposedTools: [] },
            shadowMode: shadow,
          };
        }
        confirmMsg = built.message;
      } else {
        const legacyResult = buildLegacyConfirmation(
          pendingSystem,
          sysStateForConfirm.extractedValues,
          sysStateForConfirm.slotSignals,
        );
        if (!legacyResult.ok) {
          const fallback =
            `I cannot present a confirmation yet — no findings have been extracted. ` +
            `Please describe the injury or assessment in more detail.`;
          resolvedState = setPendingClarification(resolvedState, fallback);
          const enveloped = toSystemStateEnvelope(resolvedState, raw);
          saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
          logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_shadow_result", eventData: { shadow, proposed: [], actual: [], needsClarification: true } });
          return {
            sessionId,
            message: fallback,
            route,
            grounding,
            needsClarification: true,
            clarificationQuestion: fallback,
            toolPlan: { proposed: [], actual: [] },
            policy: { action: "clarify", reason: `Legacy confirmation builder rejected facts: ${legacyResult.reason}`, requiresConfirmation: false, clarificationQuestion: fallback, proposedTools: [] },
            shadowMode: shadow,
          };
        }
        confirmMsg = legacyResult.message;
      }
      resolvedState = setConfirmationPending(resolvedState, pendingSystem, confirmMsg);
      if (activeInstanceForObs) {
        resolvedState = setInstanceConfirmationPending(resolvedState, activeInstanceForObs.instanceId, confirmMsg);
      }
      resolvedState = setPendingConfirmation(resolvedState, {
        system: pendingSystem,
        summary: confirmMsg,
        createdAt: new Date().toISOString(),
      });
      resolvedState = { ...resolvedState, pendingClarification: null };

      const enveloped = toSystemStateEnvelope(resolvedState, raw);
      saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
      logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_shadow_result", eventData: { shadow, proposed: [], actual: [], needsClarification: true } });
      return {
        sessionId,
        message: confirmMsg,
        route,
        grounding,
        needsClarification: true,
        clarificationQuestion: confirmMsg,
        suggestedChips: ["Confirm and calculate", "Edit findings"],
        toolPlan: { proposed: [], actual: [] },
        policy: { action: "clarify", reason: "observation_resolved_pending_confirmation", requiresConfirmation: true, clarificationQuestion: confirmMsg, chips: ["Confirm and calculate", "Edit findings"], proposedTools: [] },
        shadowMode: shadow,
      };
    }
  }

  // ── Consensus orchestrator (Slice F) ──────────────────────────────────────
  // Single entry point combining the semantic gate, deterministic consensus
  // resolver, and the LLM-driven interpreter. Returns one of three signals:
  //   - "respond"     → pipeline stops, return canned response
  //   - "substitute"  → accepted consensus; re-normalize and continue
  //   - "passthrough" → no consensus activity; existing pipeline runs as-is
  // Both feature flags must be on (SEMANTIC_CONSENSUS_ENABLED and
  // SEMANTIC_INTERPRETER_ENABLED) to produce anything other than passthrough,
  // so default-CI behaviour is unchanged.
  const orchestratorResult: ConsensusOrchestratorResult = await runConsensusOrchestrator({
    state: loadedState,
    replyText: effectiveUserMessage,
    normalized,
    modelClient: opts?.semanticModelClient ?? getDefaultSemanticClient(),
    forceConsensusEnabled: !isConsensusKillSwitched(),
    forceInterpreterEnabled: !isInterpreterKillSwitched(),
  });

  for (const audit of orchestratorResult.auditEvents) {
    // Audit event types are forward-declared in auditLog.ts (Slice C).
    logAuditEvent({
      sessionId,
      userId: opts?.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventType: audit.eventType as any,
      eventData: audit.payload,
    });
  }

  if (orchestratorResult.kind === "respond") {
    const enveloped = toSystemStateEnvelope(orchestratorResult.state, raw);
    saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
    return {
      sessionId,
      message: orchestratorResult.message,
      route: { operation: "clarify", systems: [], confidence: 0, reasons: [orchestratorResult.policyReason] },
      grounding: { citations: [], ontologyMatches: [] },
      needsClarification: orchestratorResult.needsClarification,
      clarificationQuestion: orchestratorResult.needsClarification
        ? orchestratorResult.message
        : undefined,
      suggestedChips: orchestratorResult.chips,
      toolPlan: { proposed: [], actual: [] },
      policy: {
        action: "clarify",
        reason: orchestratorResult.policyReason,
        requiresConfirmation: false,
        clarificationQuestion: orchestratorResult.message,
        chips: orchestratorResult.chips,
        proposedTools: [],
      },
      shadowMode: shadow,
    };
  }

  if (orchestratorResult.kind === "substitute") {
    // Doctor accepted the interpretation. Continue extraction against the
    // original source text, not the "Proceed" reply.
    loadedState = orchestratorResult.state;
    effectiveUserMessage = orchestratorResult.sourceText;
    normalized = normalizeClinicalUtterance(orchestratorResult.sourceText);
    // Slice G — thread the read-only extraction context to the deterministic
    // extractors via the optional 4th StructuredExtractor parameter
    // (REQ-MS-EXTRACT-001). Spine uses `selectedScope.sourceSpans` to narrow
    // multi-region input (REQ-SC-SPINE-001 / REQ-SC-SPINE-002).
    activeExtractionContext = orchestratorResult.extractionContext;
  }
  // "passthrough" → continue with existing normalized + state as today.

  const grounding = retrieveGrounding(normalized.normalizedText);
  const route = routeUtterance(normalized, grounding, loadedState);
  logAuditEvent({
    sessionId,
    userId: opts?.userId,
    eventType: "v2_route",
    eventData: {
      operation: route.operation,
      systems: route.systems,
      confidence: route.confidence,
      reasons: route.reasons,
    },
  });

  let nextState = withRoute(loadedState, route);

  // Determine the primary system (prefer pending confirmation's system if active)
  const primarySystem: GatiodSystemKey | undefined =
    loadedState.pendingConfirmation?.system ?? route.systems[0];

  // ── V2-007b: extraction-skip on confirmation reply ─────────────────────────
  const confirmationReply = Boolean(loadedState.pendingConfirmation) && isConfirmation(normalized);

  // Multi-system extraction: when the router detects multiple systems in one
  // utterance, run each system's extractor against the same utterance. The
  // primary system (route.systems[0] or pendingConfirmation.system) drives
  // the conversational flow; secondary systems have their facts persisted so
  // they're ready when the doctor moves on to them.
  // (REQ-B1) Without this loop, only route.systems[0] would have its facts
  // extracted — a multi-system query like "femoral fracture and lumbar disc
  // prolapse" would lose the spine facts entirely.
  const extractionTargets: GatiodSystemKey[] = [];
  if (primarySystem) {
    extractionTargets.push(primarySystem);
    for (const sys of route.systems) {
      if (!extractionTargets.includes(sys)) extractionTargets.push(sys);
    }
  }

  if (extractionTargets.length > 0 && !confirmationReply) {
    // Whether a comparison offer was stored this turn. Once true, subsequent
    // shadow-capable systems fall back to calibration-only logging to avoid
    // presenting multiple comparison dialogs in a single turn.
    let comparisonStoredThisTurn = false;

    for (const targetSystem of extractionTargets) {
      // Skip systems whose facts were already applied by Gate 2 this turn
      // (doctor resolved a pending comparison choice).
      if (skipExtractionSystems.has(targetSystem)) continue;

      const cap = V2_SYSTEM_REGISTRY[targetSystem];
      if ((cap.mode === "structured_live" || cap.mode === "structured_shadow") && cap.extractor) {
        // Run primary extractor and (optionally) shadow extractor concurrently.
        // ADR-0004: shadow is suppressed when:
        //   - suppressShadowForSystems contains this system (post-"Both wrong" turn).
        //   - A comparison offer is already stored for another system this turn.
        //   - LLM_EXTRACTOR_COMPARISON_ENABLED is not set (calibration-only mode).
        const runShadow =
          Boolean(cap.shadowExtractor) &&
          !suppressShadowForSystems.has(targetSystem) &&
          !comparisonStoredThisTurn;

        const [extractionResult, shadowResult] = await Promise.all([
          Promise.resolve(cap.extractor(
            normalized,
            nextState.systems[targetSystem],
            grounding.ontologyMatches,
            activeExtractionContext,
          )),
          runShadow
            ? Promise.resolve(cap.shadowExtractor!(
                normalized,
                nextState.systems[targetSystem],
                grounding.ontologyMatches,
                activeExtractionContext,
              )).catch((err: unknown) => {
                logAuditEvent({
                  sessionId,
                  userId: opts?.userId,
                  eventType: "v2_shadow_extraction_failed",
                  eventData: { system: targetSystem, error: String(err) },
                });
                return null;
              })
            : Promise.resolve(null),
        ]);

        // ── ADR-0004: comparison gate ──────────────────────────────────────────
        // When the comparison UI is enabled and the shadow extractor produced a
        // result, store a PendingExtractorComparison and skip applying the
        // primary result this turn — the doctor must choose first.
        // Skip the comparison when both extractors produced nothing — there is
        // nothing to compare and the dialog would just block the pipeline.
        const bothEmpty =
          shadowResult != null &&
          Object.keys(extractionResult.extractedFactsPatch).length === 0 &&
          extractionResult.pendingObservationsToAdd.length === 0 &&
          Object.keys(shadowResult.extractedFactsPatch).length === 0 &&
          shadowResult.pendingObservationsToAdd.length === 0;
        if (shadowResult && isComparisonEnabled() && !bothEmpty) {
          const comparison = buildComparisonOffer(
            targetSystem,
            normalized.raw,
            extractionResult,
            shadowResult,
          );
          nextState = setPendingExtractorComparison(nextState, comparison);
          logAuditEvent({
            sessionId,
            userId: opts?.userId,
            eventType: "v2_extractor_comparison_shown",
            eventData: {
              comparisonId: comparison.id,
              system: targetSystem,
              hasConflicts: comparison.hasConflicts,
              primaryKeys: Object.keys(extractionResult.extractedFactsPatch),
              shadowKeys: Object.keys(shadowResult.extractedFactsPatch),
            },
          });
          comparisonStoredThisTurn = true;
          continue; // Primary result not applied — doctor must choose a side.
        }

        // ── Shadow calibration logging (comparison disabled or secondary system)
        if (shadowResult) {
          const primaryKeys = Object.keys(extractionResult.extractedFactsPatch).sort();
          const shadowKeys  = Object.keys(shadowResult.extractedFactsPatch).sort();
          logAuditEvent({
            sessionId,
            userId: opts?.userId,
            eventType: "v2_shadow_extraction",
            eventData: {
              system: targetSystem,
              primaryExtractedKeys: primaryKeys,
              shadowExtractedKeys:  shadowKeys,
              agreedKeys:           primaryKeys.filter((k) => shadowKeys.includes(k)),
              primaryPendingCount:  extractionResult.pendingObservationsToAdd.length,
              shadowPendingCount:   shadowResult.pendingObservationsToAdd.length,
              shadowWarnings:       shadowResult.warnings,
            },
          });
        }

        if (extractionResult.warnings.length > 0) {
          logAuditEvent({
            sessionId,
            userId: opts?.userId,
            eventType: "v2_extraction_warning",
            eventData: { system: targetSystem, warnings: extractionResult.warnings },
          });
        }
        if (extractionResult.auditEvents && extractionResult.auditEvents.length > 0) {
          for (const ev of extractionResult.auditEvents) {
            // The extractor declares its event types as plain strings to keep
            // contracts.ts free of an auditLog import. AuditEventType union is
            // the source of truth — adding a new extractor event requires
            // adding it there too.
            logAuditEvent({
              sessionId,
              userId: opts?.userId,
              eventType: ev.eventType as Parameters<typeof logAuditEvent>[0]["eventType"],
              eventData: { system: targetSystem, ...ev.payload },
            });
          }
        }

        if (extractionResult.instanceId) {
          const { systemKey, slotKeys } = parseInstanceId(extractionResult.instanceId);
          if (!getInstanceById(nextState, extractionResult.instanceId)) {
            const existingIds = getInstances(nextState, systemKey).map((i) => i.instanceId);
            const validation = canCreateInstance(systemKey, slotKeys, existingIds);
            if (validation.allowed) {
              const now = new Date().toISOString();
              const newInstance: V2AssessmentInstance = {
                instanceId: extractionResult.instanceId,
                system: systemKey,
                slotPath: slotKeys,
                facts: {},
                pendingObservations: [],
                confirmation: { status: "not_confirmed" },
                status: "collecting",
                piPercent: null,
                trace: null,
                updatedAt: now,
              };
              nextState = upsertInstance(nextState, newInstance);
            } else {
              logAuditEvent({
                sessionId,
                userId: opts?.userId,
                eventType: "v2_extraction_warning",
                eventData: { system: targetSystem, warnings: [`Instance creation blocked: ${validation.reason}`] },
              });
            }
          }
          nextState = applyInstanceFactsPatch(nextState, extractionResult.instanceId, extractionResult);
          nextState = applyStructuredExtraction(nextState, targetSystem, extractionResult);
        } else {
          nextState = applyStructuredExtraction(nextState, targetSystem, extractionResult);
        }
      } else {
        const incoming = extractSignals(normalized);
        const incomingValues = extractValues(normalized);
        const existing = nextState.systems[targetSystem].slotSignals ?? {};
        const merged = mergeSignals(existing, incoming);
        nextState = updateSlotSignals(nextState, targetSystem, merged);
        nextState = updateExtractedValues(nextState, targetSystem, incomingValues);
      }
    }

    if (extractionTargets.length > 1) {
      logAuditEvent({
        sessionId,
        userId: opts?.userId,
        eventType: "v2_multi_system_extraction",
        eventData: {
          systems: extractionTargets,
          primarySystem,
          routeConfidence: route.confidence,
        },
      });
    }
  }

  // ── ADR-0004: comparison stored — stop pipeline until doctor chooses ───────
  // The extraction loop built a PendingExtractorComparison for at least one
  // system. Save state and return the comparison message. The policy engine
  // and tool execution are bypassed — they run on the doctor's NEXT turn after
  // Gate 2 resolves the comparison and applies the chosen result.
  if (nextState.pendingExtractorComparison) {
    const comparison = nextState.pendingExtractorComparison;
    const enveloped = toSystemStateEnvelope(nextState, raw);
    saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });
    return {
      sessionId,
      message: comparison.message,
      route,
      grounding,
      needsClarification: false,
      suggestedChips: comparison.chips,
      toolPlan: { proposed: [], actual: [] },
      policy: {
        action: "clarify",
        reason: "extractor_comparison_pending",
        requiresConfirmation: false,
        chips: comparison.chips,
        proposedTools: [],
      },
      shadowMode: shadow,
    };
  }

  // ── Slice H — semantic-attributed pending observations ────────────────────
  // After the extraction loop finishes, scan accepted semantic findings for
  // disagreements: systems that were accepted by the doctor but produced
  // neither facts nor pending observations. Each disagreement becomes a
  // semantic_mapping_gap pending observation with attribution and emits a
  // semantic_to_structured_extraction_failed audit event (REQ-SC-DISAGREE-001).
  if (activeExtractionContext && activeExtractionContext.acceptedFindings.length > 0) {
    const { detectSemanticDisagreements, buildSemanticGapObservation, buildDisagreementAuditPayload } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../v2/semanticAttribution.js") as typeof import("../v2/semanticAttribution.js");
    const disagreements = detectSemanticDisagreements(activeExtractionContext, nextState);
    for (const disagreement of disagreements) {
      const observation = buildSemanticGapObservation(
        disagreement,
        activeExtractionContext.consensusId,
      );
      // Attach the observation to the relevant system without overwriting any
      // existing pending observations (defence: detector excludes systems
      // that already have pending observations, but the post-extraction loop
      // may have produced others concurrently).
      nextState = {
        ...nextState,
        systems: {
          ...nextState.systems,
          [disagreement.system]: {
            ...nextState.systems[disagreement.system],
            pendingObservations: [
              ...nextState.systems[disagreement.system].pendingObservations,
              observation,
            ],
          },
        },
      };
      logAuditEvent({
        sessionId,
        userId: opts?.userId,
        eventType: "semantic_to_structured_extraction_failed",
        eventData: {
          ...buildDisagreementAuditPayload(
            activeExtractionContext.consensusId,
            disagreement,
            observation.id,
          ),
        } as Record<string, unknown>,
      });
    }
  }

  const policy = makePolicyDecision(route, normalized, grounding, nextState);
  logAuditEvent({
    sessionId,
    userId: opts?.userId,
    eventType: "v2_policy",
    eventData: {
      action: policy.action,
      reason: policy.reason,
      requiresConfirmation: policy.requiresConfirmation,
      proposedToolCount: policy.proposedTools.length,
    },
  });

  const proposed = policy.proposedTools;
  const actual: ToolPlanCall[] = [];
  let message = "";
  // Multi-system handoff overlay — populated when a system finishes
  // calculating and we want to chain into the next system the doctor
  // mentioned in the original utterance. (REQ-B1.5)
  let handoff: NextSystemHandoff | undefined;
  // Set when the post-handoff path auto-offers a Global CVC combine. Carries
  // the chips and message into the response composition without conflating
  // with the system-handoff overlay.
  let globalCvcOfferChips: string[] | undefined;
  let globalCvcOfferMessage: string | undefined;

  if (policy.action === "clarify") {
    let clarification = policy.clarificationQuestion ?? "Please clarify the target system.";

    // Handle the "rebuild confirmation" sentinel: apply correction + rebuild confirmation.
    if (clarification === "__REBUILD_CONFIRMATION__" && loadedState.pendingConfirmation) {
      const sys = loadedState.pendingConfirmation.system;
      const systemState = nextState.systems[sys];
      const patch = buildFactPatch(
        normalized,
        systemState.extractedValues,
        systemState.slotSignals
      );
      nextState = updateExtractedValues(nextState, sys, patch.updatedValues);
      if (patch.signalsToClear.length > 0) {
        const clearedSignals = applySignalClear(nextState.systems[sys].slotSignals, patch.signalsToClear);
        nextState = updateSlotSignals(nextState, sys, clearedSignals);
      }
      // Rebuild the confirmation with updated values. Fail-closed: if the
      // correction made the structured facts insufficient, surface the
      // missing fields rather than re-rendering an invalid confirmation.
      const updatedSystemState = nextState.systems[sys];
      if (isStructuredLiveSystem(sys)) {
        const built = buildStructuredConfirmation(sys, updatedSystemState.extractedFacts);
        clarification = built.ok
          ? built.message
          : `I cannot present a confirmation yet — required fields are missing: ${built.missingFields.join(", ")}. ` +
            `Please provide the missing details.`;
      } else {
        const built = buildLegacyConfirmation(
          sys,
          updatedSystemState.extractedValues,
          updatedSystemState.slotSignals,
        );
        clarification = built.ok
          ? built.message
          : `I cannot present a confirmation yet — no findings have been extracted. ` +
            `Please describe the injury or assessment in more detail.`;
      }
    }

    // Set or update pendingConfirmation when this is a confirmation-type clarification.
    if (policy.requiresConfirmation && primarySystem) {
      // For structured_live systems also snapshot the factsHash so the policy engine can
      // detect stale confirmations (facts changed between presentation and confirmation).
      if (isStructuredLiveSystem(primarySystem)) {
        nextState = setConfirmationPending(nextState, primarySystem, clarification);
        // Snapshot the active instance's confirmation so policyEngine hash-check uses instance facts.
        const activeForConfirm = V2_SYSTEM_REGISTRY[primarySystem].instanceReadinessValidator
          ? getInstances(nextState, primarySystem)
              .filter((i) => i.status !== "calculated")
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
          : undefined;
        if (activeForConfirm) {
          nextState = setInstanceConfirmationPending(nextState, activeForConfirm.instanceId, clarification);
        }
      }
      nextState = setPendingConfirmation(nextState, {
        system: primarySystem,
        summary: clarification,
        createdAt: new Date().toISOString(),
      });
    } else if (!policy.requiresConfirmation) {
      // Non-confirmation clarification — clear any pending confirmation.
      nextState = setPendingConfirmation(nextState, null);
      nextState = setPendingClarification(nextState, clarification);
    }

    // ── Pending global CVC offer side-effects ────────────────────────────
    if (policy.pendingGlobalCvcSnapshot) {
      // Stale-re-offer path: refresh the snapshot to current component values.
      nextState = setPendingGlobalCvcConfirmation(nextState, policy.pendingGlobalCvcSnapshot);
    } else if (policy.clearPendingGlobalCvc) {
      // Doctor pivoted away from the offer (Add another system / Edit a finding).
      nextState = setPendingGlobalCvcConfirmation(nextState, null);
    }

    message = clarification;

  } else if (policy.action === "execute_tools") {
    // Clear pending confirmation on successful tool execution path.
    nextState = setPendingConfirmation(nextState, null);

    // Capture the active instance ID now (before state mutations) for post-execution update.
    const activeInstanceIdForExec = primarySystem && V2_SYSTEM_REGISTRY[primarySystem].instanceReadinessValidator
      ? getInstances(nextState, primarySystem)
          .filter((i) => i.status !== "calculated")
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.instanceId
      : undefined;

    for (const call of proposed) {
      const execResult = handleToolCall(call.name, call.args);
      const ok = Boolean(execResult.success);
      actual.push({
        ...call,
        status: ok ? "executed" : "failed",
        validation: {
          ok,
          message: ok ? "Tool executed successfully." : execResult.error ?? "Tool execution failed.",
        },
        result: execResult.data,
      });
    }

    nextState = applyToolResults(nextState, actual);

    // ── Global CVC execution (Q4) ─────────────────────────────────────────
    // assess_global_cvc has its own deterministic renderer and is not tied
    // to a single system. Handle it before the per-system renderer below.
    const globalCvcCall = actual.find((c) => c.name === "assess_global_cvc");
    if (globalCvcCall) {
      if (globalCvcCall.status === "executed" && globalCvcCall.validation.ok) {
        message = renderGlobalCvcResult(globalCvcCall.result);
        nextState = setPendingGlobalCvcConfirmation(nextState, null);
        nextState = setPendingClarification(nextState, "");
        // Issue #12, RC-7: emit a component-level trace alongside the
        // single-number global PI. Without this, three scenarios (XSC-00086,
        // XSC-00109, XSC-00258) produced wrong combined PIs with no way to
        // separate "wrong component subtotal" from "wrong CVC formula".
        const cvcResult = (globalCvcCall.result ?? {}) as Record<string, unknown>;
        const componentTrace: Array<{
          system: GatiodSystemKey;
          piPercent: number | null;
          factsHash?: string;
          factKeys: string[];
        }> = [];
        for (const sys of SYSTEM_KEY_LIST) {
          const sysState = nextState.systems[sys];
          if (sysState.status !== "calculated") continue;
          componentTrace.push({
            system: sys,
            piPercent: sysState.piPercent,
            factsHash: sysState.confirmation?.factsHash,
            factKeys: Object.keys(sysState.extractedFacts ?? {}),
          });
        }
        logAuditEvent({
          sessionId,
          userId: opts?.userId,
          eventType: "v2_global_cvc_executed",
          eventData: {
            globalPiPercent: cvcResult.globalPiPercent,
            cvcInputs: Array.isArray(cvcResult.cvcInputs) ? cvcResult.cvcInputs : undefined,
            componentTrace,
            assessCallArgs: globalCvcCall.args,
          },
        });
      } else {
        const failure = renderV2Failure("tool_execution_failed", globalCvcCall.validation.message);
        logAuditEvent({
          sessionId,
          userId: opts?.userId,
          eventType: "v2_failure",
          eventData: { failureKind: "tool_execution_failed", tool: "assess_global_cvc" },
        });
        message = failure.message;
      }
    }

    // For structured_live assess_* calls: use the deterministic renderer
    const assessCall = actual.find((c) => /^assess_(?!global_cvc)/.test(c.name) && c.status === "executed");
    if (!globalCvcCall && assessCall && primarySystem) {
      const cap = V2_SYSTEM_REGISTRY[primarySystem];
      if (cap.mode === "structured_live" && cap.resultRenderer) {
        if (!assessCall.validation.ok) {
          const failure = renderV2Failure("tool_execution_failed", assessCall.validation.message);
          logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_failure", eventData: { failureKind: "tool_execution_failed" } });
          message = failure.message;
        } else {
          nextState = setConfirmationConfirmed(nextState, primarySystem, opts?.userId);
          // Persist the PI result, trace, and mark the active instance as calculated.
          if (activeInstanceIdForExec) {
            const resultObj = (assessCall.result ?? {}) as Record<string, unknown>;
            const pi =
              typeof resultObj.finalPercent === "number" ? resultObj.finalPercent
              : typeof resultObj.finalPi === "number" ? resultObj.finalPi
              : typeof resultObj.selectedPi === "number" ? resultObj.selectedPi
              : null;
            if (pi !== null) {
              const trace = buildTraceForSystem(primarySystem, assessCall.args, assessCall.result, {
                instanceId: activeInstanceIdForExec,
                level: "spoke",
              });
              nextState = applyInstanceToolResult(nextState, activeInstanceIdForExec, pi, trace);
            }
          }
          const rendered = cap.resultRenderer(assessCall.result, nextState.systems[primarySystem]);
          message = rendered.message;

          // ── Multi-system handoff ─────────────────────────────────────────
          // After this system completes, look for another system whose facts
          // were captured from the same utterance and pivot into it. Without
          // this the chat goes silent on multi-system inputs after the first
          // system finishes — the user's reported regression.
          handoff = buildNextSystemHandoff(nextState, primarySystem);
          if (handoff) {
            message = `${message}\n\n---\n\n${handoff.appendMessage}`;

            if (handoff.pendingConfirmation) {
              nextState = setConfirmationPending(nextState, handoff.system, handoff.appendMessage);
              const activeForHandoff = V2_SYSTEM_REGISTRY[handoff.system].instanceReadinessValidator
                ? getInstances(nextState, handoff.system)
                    .filter((i) => i.status !== "calculated")
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
                : undefined;
              if (activeForHandoff) {
                nextState = setInstanceConfirmationPending(nextState, activeForHandoff.instanceId, handoff.appendMessage);
              }
              nextState = setPendingConfirmation(nextState, {
                system: handoff.system,
                summary: handoff.appendMessage,
                createdAt: new Date().toISOString(),
              });
            } else {
              nextState = setPendingClarification(nextState, handoff.appendMessage);
            }

            logAuditEvent({
              sessionId,
              userId: opts?.userId,
              eventType: "v2_multi_system_extraction",
              eventData: {
                event: "handoff",
                fromSystem: primarySystem,
                toSystem: handoff.system,
                pendingConfirmation: handoff.pendingConfirmation,
              },
            });
          } else if (shouldOfferGlobalCvc(nextState)) {
            // ── Global CVC offer (Q4) ────────────────────────────────────────
            // No further system to hand off to, but ≥2 systems have calculated.
            // Offer the deterministic combine step. ADR D4-style snapshot is
            // stored on the session so a later edit of either component
            // invalidates the offer at confirm time.
            const offer = buildGlobalCvcOffer(nextState);
            if (offer) {
              message = `${message}\n\n---\n\n${offer.appendMessage}`;
              globalCvcOfferMessage = offer.appendMessage;
              globalCvcOfferChips = offer.chips;
              nextState = setPendingGlobalCvcConfirmation(nextState, offer.snapshot);
              nextState = setPendingClarification(nextState, offer.appendMessage);
              logAuditEvent({
                sessionId,
                userId: opts?.userId,
                eventType: "v2_global_cvc_offered",
                eventData: {
                  componentSystems: offer.snapshot.componentSystems,
                  componentValues: offer.snapshot.componentValues,
                },
              });
            }
          }
        }
      } else {
        message = formatLookupExecutionMessage(actual, formatV2Message({
          policyReason: policy.reason,
          needsClarification: false,
          toolPlan: proposed,
          routeSummary: `${route.operation} (${route.systems.join(", ") || "none"})`,
        }));
      }
    } else if (!globalCvcCall) {
      message = formatLookupExecutionMessage(actual, formatV2Message({
        policyReason: policy.reason,
        needsClarification: false,
        toolPlan: proposed,
        routeSummary: `${route.operation} (${route.systems.join(", ") || "none"})`,
      }));
    }

  } else {
    // delegate_legacy: clear pending confirmation (doctor confirmed; legacy will calculate).
    nextState = setPendingConfirmation(nextState, null);

    if (shadow) {
      message = formatV2Message({
        policyReason: policy.reason,
        needsClarification: false,
        toolPlan: proposed,
        routeSummary: `${route.operation} (${route.systems.join(", ") || "none"})`,
      });
    } else {
      const legacy = await processChat(sessionId, userMessage, { userId: opts?.userId, claimId: opts?.claimId });
      actual.push(...mapLegacyToolCalls(legacy.toolCalls));
      nextState = applyToolResults(nextState, actual);
      message = legacy.message;
    }
  }

  const enveloped = toSystemStateEnvelope(nextState, raw);
  saveSessionSystemStates(sessionId, enveloped, { userId: opts?.userId, claimId: opts?.claimId });

  logAuditEvent({
    sessionId,
    userId: opts?.userId,
    eventType: shadow ? "v2_shadow_result" : "v2_tool_plan",
    eventData: {
      shadow,
      proposed: proposed.map((t) => t.name),
      actual: actual.map((t) => ({ name: t.name, status: t.status, ok: t.validation.ok })),
      needsClarification: policy.action === "clarify",
    },
  });

  return {
    sessionId,
    message,
    route,
    grounding,
    needsClarification: handoff || globalCvcOfferMessage ? true : policy.action === "clarify",
    clarificationQuestion: handoff
      ? handoff.appendMessage
      : globalCvcOfferMessage ?? policy.clarificationQuestion,
    suggestedChips: handoff
      ? handoff.chips
      : globalCvcOfferChips ?? policy.chips,
    toolPlan: { proposed, actual },
    policy,
    shadowMode: shadow,
  };
}
