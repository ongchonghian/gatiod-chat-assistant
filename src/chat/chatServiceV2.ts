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
  applyStructuredExtraction,
  applyToolResults,
  coerceV2State,
  defaultV2SessionState,
  setPendingClarification,
  setPendingConfirmation,
  toSystemStateEnvelope,
  updateExtractedValues,
  updateSlotSignals,
  withRoute,
} from "../v2/stateMachine.js";
import { extractSignals, extractValues, mergeSignals } from "../v2/slotEvaluator.js";
import { applySignalClear, buildFactPatch, isConfirmation } from "../v2/factPatch.js";
import { buildConfirmationMessage } from "../v2/confirmationBuilder.js";
import { V2_SYSTEM_REGISTRY } from "../v2/systemRegistry.js";
import { tryResolvePendingObservation } from "../v2/pendingObservationResolver.js";
import { renderV2Failure } from "../v2/failureRenderer.js";
import { setConfirmationConfirmed, setConfirmationPending } from "../v2/stateMachine.js";

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

      if (pendingCap.mode === "structured_live" && pendingCap.readinessValidator) {
        const readiness = pendingCap.readinessValidator(resolvedState.systems[pendingSystem]);
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
      const confirmMsg = buildConfirmationMessage(pendingSystem, sysStateForConfirm.extractedValues, sysStateForConfirm.slotSignals);
      resolvedState = setConfirmationPending(resolvedState, pendingSystem, confirmMsg);
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

  if (primarySystem && !confirmationReply) {
    const cap = V2_SYSTEM_REGISTRY[primarySystem];
    if ((cap.mode === "structured_live" || cap.mode === "structured_shadow") && cap.extractor) {
      // Structured path: use the V2 extractor
      const extractionResult = cap.extractor(normalized, nextState.systems[primarySystem], grounding.ontologyMatches);
      if (extractionResult.warnings.length > 0) {
        logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_extraction_warning", eventData: { warnings: extractionResult.warnings } });
      }
      nextState = applyStructuredExtraction(nextState, primarySystem, extractionResult);
    } else {
      // Legacy path: use the signal/value extractors
      const incoming = extractSignals(normalized);
      const incomingValues = extractValues(normalized);
      const existing = nextState.systems[primarySystem].slotSignals ?? {};
      const merged = mergeSignals(existing, incoming);
      nextState = updateSlotSignals(nextState, primarySystem, merged);
      nextState = updateExtractedValues(nextState, primarySystem, incomingValues);
    }
  } else if (primarySystem && confirmationReply) {
    // Confirmation reply — skip extraction entirely (D8)
  } else if (primarySystem) {
    // No primary system branch — legacy extraction
    const incoming = extractSignals(normalized);
    const incomingValues = extractValues(normalized);
    const existing = nextState.systems[primarySystem].slotSignals ?? {};
    const merged = mergeSignals(existing, incoming);
    nextState = updateSlotSignals(nextState, primarySystem, merged);
    nextState = updateExtractedValues(nextState, primarySystem, incomingValues);
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
      // Rebuild the confirmation with updated values
      const updatedSystemState = nextState.systems[sys];
      clarification = buildConfirmationMessage(sys, updatedSystemState.extractedValues, updatedSystemState.slotSignals);
    }

    // Set or update pendingConfirmation when this is a confirmation-type clarification.
    if (policy.requiresConfirmation && primarySystem) {
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

    message = clarification;

  } else if (policy.action === "execute_tools") {
    // Clear pending confirmation on successful tool execution path.
    nextState = setPendingConfirmation(nextState, null);

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

    // For structured_live assess_* calls: use the deterministic renderer
    const assessCall = actual.find((c) => /^assess_(?!global_cvc)/.test(c.name) && c.status === "executed");
    if (assessCall && primarySystem) {
      const cap = V2_SYSTEM_REGISTRY[primarySystem];
      if (cap.mode === "structured_live" && cap.resultRenderer) {
        if (!assessCall.validation.ok) {
          const failure = renderV2Failure("tool_execution_failed", assessCall.validation.message);
          logAuditEvent({ sessionId, userId: opts?.userId, eventType: "v2_failure", eventData: { failureKind: "tool_execution_failed" } });
          message = failure.message;
        } else {
          nextState = setConfirmationConfirmed(nextState, primarySystem, opts?.userId);
          const rendered = cap.resultRenderer(assessCall.result, nextState.systems[primarySystem]);
          message = rendered.message;
        }
      } else {
        message = formatLookupExecutionMessage(actual, formatV2Message({
          policyReason: policy.reason,
          needsClarification: false,
          toolPlan: proposed,
          routeSummary: `${route.operation} (${route.systems.join(", ") || "none"})`,
        }));
      }
    } else {
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
    needsClarification: policy.action === "clarify",
    clarificationQuestion: policy.clarificationQuestion,
    suggestedChips: policy.chips,
    toolPlan: { proposed, actual },
    policy,
    shadowMode: shadow,
  };
}
