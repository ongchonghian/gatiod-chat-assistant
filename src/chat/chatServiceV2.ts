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
  setPendingGlobalCvcConfirmation,
  toSystemStateEnvelope,
  updateExtractedValues,
  updateSlotSignals,
  upsertInstance,
  withRoute,
} from "../v2/stateMachine.js";
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
 * After a system finishes calculating, look for OTHER systems whose facts were
 * collected from the same multi-system utterance but never got their turn to
 * be confirmed/calculated. Returns a handoff prompt for the next such system,
 * driving a "now let's do hearing" continuation rather than the chat going
 * silent after the first system. (REQ-B1.5)
 */
function buildNextSystemHandoff(
  state: V2SessionState,
  justCompleted: GatiodSystemKey
): NextSystemHandoff | undefined {
  for (const sys of SYSTEM_KEY_LIST) {
    if (sys === justCompleted) continue;
    const sysState = state.systems[sys];
    if (sysState.status === "calculated") continue;

    const hasFacts = Object.keys(sysState.extractedFacts).length > 0;
    const hasPendingObs = sysState.pendingObservations.length > 0;
    if (!hasFacts && !hasPendingObs) continue;

    const cap = V2_SYSTEM_REGISTRY[sys];
    const displayName = SYSTEM_DISPLAY_NAMES[sys];

    if (cap.mode === "structured_live" && cap.readinessValidator) {
      const readiness = cap.readinessValidator(sysState);

      if (readiness.ready) {
        // System is ready — present its confirmation right now so the doctor
        // can either confirm or edit without re-typing the original case.
        const confirmResult = buildStructuredConfirmation(sys, sysState.extractedFacts);
        if (!confirmResult.ok) {
          // Defense: readiness said ready but builder refused. Skip handoff for
          // this system rather than present a half-formed confirmation.
          continue;
        }
        const append =
          `**Continuing with ${displayName}.** I captured these findings from your earlier message:\n\n${confirmResult.message}`;
        return {
          system: sys,
          appendMessage: append,
          chips: ["Confirm and calculate", "Edit findings"],
          pendingConfirmation: true,
        };
      }

      if (readiness.reason === "pending_observations" && hasPendingObs) {
        const obs = sysState.pendingObservations[0];
        const append =
          `**Continuing with ${displayName}.** ${obs.clarificationQuestion}`;
        return {
          system: sys,
          appendMessage: append,
          chips: obs.candidateAnswers ?? [],
          pendingConfirmation: false,
        };
      }

      const q = readiness.clarificationQuestion ?? `What additional details do you have for ${displayName}?`;
      return {
        system: sys,
        appendMessage: `**Continuing with ${displayName}.** ${q}`,
        chips: readiness.candidateAnswers ?? [],
        pendingConfirmation: false,
      };
    }

    // Legacy (non-structured-live) system with collected work — surface it.
    return {
      system: sys,
      appendMessage:
        `I also captured findings for **${displayName}** from your earlier message. ` +
        `Would you like to assess that next?`,
      chips: [`Yes — assess ${displayName}`, "Skip for now"],
      pendingConfirmation: false,
    };
  }
  return undefined;
}

interface ProcessChatV2Options {
  userId?: string;
  claimId?: string;
  shadow?: boolean;
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
  const { raw, state: loadedState } = loadV2State(sessionId);

  const normalized = normalizeClinicalUtterance(userMessage);
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
    for (const targetSystem of extractionTargets) {
      const cap = V2_SYSTEM_REGISTRY[targetSystem];
      if ((cap.mode === "structured_live" || cap.mode === "structured_shadow") && cap.extractor) {
        const extractionResult = cap.extractor(normalized, nextState.systems[targetSystem], grounding.ontologyMatches);
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
        logAuditEvent({
          sessionId,
          userId: opts?.userId,
          eventType: "v2_global_cvc_executed",
          eventData: {
            globalPiPercent: ((globalCvcCall.result ?? {}) as Record<string, unknown>).globalPiPercent,
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
