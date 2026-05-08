import type {
  GroundingResult,
  NormalizedUtterance,
  PolicyDecision,
  RouteDecision,
  ToolPlanCall,
  V2SessionState,
} from "./contracts.js";
import { collectCalculatedSubtotals } from "./stateMachine.js";
import { decideSlotAction } from "./dialoguePolicy.js";
import { isConfirmation, isEditRequest } from "./factPatch.js";
import { buildConfirmationMessage } from "./confirmationBuilder.js";

const SYSTEM_SELECTION_PATTERN = /\b(spine|upper\s+limb|lower\s+limb|respiratory|renal|gastro|digestive|hearing|cns|visual)\b/i;
const CONTINUATION_REPLY_PATTERN = /^(no|yes|y|n|ok|okay|confirmed|proceed|continue|none)$/i;

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
  state: V2SessionState
): PolicyDecision {
  // ── Confirmation / correction handling ──────────────────────────────────
  // When V2 has presented a structured confirmation, intercept the response
  // before routing to resolve it deterministically.
  if (state.pendingConfirmation) {
    const primary = state.pendingConfirmation.system;

    if (isConfirmation(normalized)) {
      // User confirmed — delegate to legacy which will call assess_* from conversation history.
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

  if (route.operation === "clarify" || (route.confidence < 0.55 && !allowLowConfidenceSelection)) {
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
    const top = grounding.ontologyMatches[0]!;
    return {
      action: "execute_tools",
      reason: `Assessment intent with high-confidence ${top.type} match; lookup-first grounding before full assessment.`,
      requiresConfirmation: false,
      proposedTools: [proposeLookupTool(normalized, grounding)],
    };
  }

  // Before delegating to legacy: run the slot / confirmation decision.
  // Guard: skip when a pending clarification is still unresolved (user is still selecting a system).
  if (!state.pendingClarification && route.systems.length > 0) {
    const primarySystem = route.systems[0];
    const systemState = state.systems[primarySystem];
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
      const confirmMsg = buildConfirmationMessage(
        primarySystem,
        systemState?.extractedValues ?? {},
        systemState?.slotSignals ?? {}
      );
      return {
        action: "clarify",
        reason: "All required slots satisfied; presenting structured confirmation before calculation.",
        requiresConfirmation: true,
        clarificationQuestion: confirmMsg,
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
