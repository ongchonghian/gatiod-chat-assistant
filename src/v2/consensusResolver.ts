// Deterministic consensus resolver (REQ-SC-RESOLVE-001, REQ-SC-RESOLVE-002).
//
// When `state.pendingConsensus` is set, this resolver classifies the doctor's
// reply into one of six branches without an LLM call:
//
//   1. rejected              — start over
//   2. legacy_requested      — explicit legacy handoff for one system
//   3. skipped_system        — skip a system the doctor never wants assessed
//   4. accepted_system_first — accept all + focus one system
//   5. edit_requested        — edit the proposal (or supply edit text)
//   6. accepted_all          — proceed with the whole interpretation
//   7. unresolved            — fallback; re-render consensus choices
//
// Priority order is fixed so specific actions win over generic affirmation:
// "Yes, but start with hearing" → accepted_system_first.
// "Looks good except CNS is wrong" → edit_requested.
// "Proceed with legacy for CNS" → legacy_requested.
//
// When `pendingConsensus.awaiting === "edit_instruction"`, the entire reply
// is treated as the doctor's edit text (will be passed to the semantic
// re-interpreter in Slice E). The classifier is bypassed in that mode.
//
// The resolver only produces state transitions and audit events. The
// extractionPlan field (with NormalizedUtterance + ExtractionContext) is
// populated when the wider chatServiceV2 integration lands in Slice F — at
// that point the resolver also has access to the full SemanticInterpretation
// (currently only the candidate-system keys are persisted).

import type {
  ClaimComponentOverride,
  ConsensusResolutionAction,
  ConsensusResolutionResult,
  GatiodSystemKey,
  PendingConsensus,
  SemanticCandidateFinding,
  V2SessionState,
} from "./contracts.js";
import {
  setClaimComponentOverride,
  setPendingConsensus,
} from "./stateMachine.js";
import { detectExplicitSystemSelection } from "./systemSelection.js";
import { V2_SYSTEM_REGISTRY } from "./systemRegistry.js";
import {
  buildSelectedSpineScopeFromPendingConsensus,
  detectSpineScopesFromText,
} from "./spineScope.js";

export interface ConsensusResolverInput {
  state: V2SessionState;
  /** Lower-cased text of the doctor's reply, before normalization. */
  replyText: string;
}

const REJECT_PATTERNS: ReadonlyArray<RegExp> = [
  /\breject\b/,
  /\bstart\s+over\b/,
  /\bstart\s+again\b/,
  /\bcancel\b/,
  /\bnot\s+correct\b/,
  /\bthat'?s\s+wrong\b/,
  /\bnone\s+of\s+(this|that|these|those)\b/,
  /\bdiscard\b/,
];

const LEGACY_PATTERNS: ReadonlyArray<RegExp> = [
  /\buse\s+legacy\b/,
  /\blegacy\s+(mode|flow|path)\b/,
  /\b(handle|assess|do)\s+\w+\s+in\s+legacy\b/,
  /\blegacy\s+for\b/,
  /\bin\s+legacy\s+mode\b/,
];

const SKIP_PATTERNS: ReadonlyArray<RegExp> = [
  /\bskip\b/,
  /\bdo\s+not\s+(assess|evaluate)\b/,
  /\bdon'?t\s+(assess|evaluate)\b/,
  /\bexclude\s+\w+\s+(for\s+now|from\s+the\s+claim)\b/,
  /\bnot\s+(assessing|evaluating)\b/,
];

const SYSTEM_FIRST_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfirst\b/,
  /\bstart\s+with\b/,
  /\bbegin\s+with\b/,
  /\bdo\s+\w+\s+first\b/,
  /\bassess\s+\w+\s+first\b/,
];

const EDIT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bedit\b/,
  /\bchange\b/,
  /\bmodify\b/,
  /\bcorrect\s+the\b/,
  /\bwrong\b/,
  /\bactually\b/,
  /\binstead\b/,
  /\bnot\s+\w+\s+but\b/,
];

const ACCEPT_PATTERNS: ReadonlyArray<RegExp> = [
  /^proceed\b/,
  /^yes\b/,
  /^ok(?:ay)?\b/,
  /\blooks\s+good\b/,
  /\bgo\s+ahead\b/,
  /\bcontinue\b/,
  /\bsounds\s+(good|right)\b/,
  /\bcorrect\b/,
];

function anyMatch(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Reduce a list of detected systems to the subset that appears in the
 * pending consensus's candidate systems. The doctor may not jump to a system
 * the interpretation never proposed — REQ-SC-RESOLVE-001.
 */
function constrainToCandidates(
  detected: GatiodSystemKey[],
  candidates: GatiodSystemKey[],
): GatiodSystemKey[] {
  const set = new Set(candidates);
  return detected.filter((s) => set.has(s));
}

function buildLegacyOverridesForCandidates(
  candidates: GatiodSystemKey[],
  source: ClaimComponentOverride["source"],
  now: string,
): Partial<Record<GatiodSystemKey, ClaimComponentOverride>> {
  const out: Partial<Record<GatiodSystemKey, ClaimComponentOverride>> = {};
  for (const sys of candidates) {
    const cap = V2_SYSTEM_REGISTRY[sys];
    if (cap?.mode === "legacy") {
      out[sys] = {
        status: "legacy_deferred",
        reason: `${sys} is currently handled by legacy assessment mode.`,
        source,
        createdAt: now,
        updatedAt: now,
      };
    }
  }
  return out;
}

function applyOverrideMap(
  state: V2SessionState,
  overrides: Partial<Record<GatiodSystemKey, ClaimComponentOverride>>,
): V2SessionState {
  let next = state;
  for (const [sys, ov] of Object.entries(overrides)) {
    if (ov) {
      next = setClaimComponentOverride(next, sys as GatiodSystemKey, ov);
    }
  }
  return next;
}

function makeResult(args: {
  resolved: boolean;
  action: ConsensusResolutionAction;
  state: V2SessionState;
  message?: string;
  chips?: string[];
  stopPipeline?: boolean;
  targetSystem?: GatiodSystemKey;
  selectedScope?: ConsensusResolutionResult["selectedScope"];
  auditEvent?: ConsensusResolutionResult["auditEvent"];
}): ConsensusResolutionResult {
  return {
    resolved: args.resolved,
    action: args.action,
    state: args.state,
    targetSystem: args.targetSystem,
    selectedScope: args.selectedScope,
    response:
      args.message !== undefined
        ? {
            message: args.message,
            chips: args.chips,
            stopPipeline: args.stopPipeline ?? true,
          }
        : undefined,
    auditEvent: args.auditEvent,
  };
}

/**
 * Resolve a doctor reply against the current pendingConsensus.
 *
 * Returns `resolved: false` with `action: "unresolved"` when the reply does
 * not deterministically map to one of the six branches — the caller should
 * re-render the consensus choices and stop the pipeline.
 *
 * Returns `resolved: true` with a state transition for every other branch.
 * The `extractionPlan` field is left undefined here — Slice F populates it
 * once the resolver has access to the full SemanticInterpretation and the
 * NormalizedUtterance for the original source text.
 */
export function tryResolvePendingConsensus(
  input: ConsensusResolverInput,
): ConsensusResolutionResult {
  const { state, replyText } = input;
  const pending = state.pendingConsensus;

  if (!pending) {
    return makeResult({
      resolved: false,
      action: "unresolved",
      state,
    });
  }

  const lower = replyText.trim().toLowerCase();
  const now = new Date().toISOString();

  // ── Edit-instruction mode ─────────────────────────────────────────────────
  // When the previous turn asked the doctor "what should I change?", the
  // entire reply is treated as the edit instruction. The classifier is
  // bypassed; downstream code (Slice E) re-runs the semantic interpreter.
  if (pending.awaiting === "edit_instruction") {
    const auditEvent = {
      eventType: "semantic_interpretation_edited",
      payload: {
        interpretationId: pending.interpretationId,
        editInstruction: replyText,
      },
    };
    return makeResult({
      resolved: true,
      action: "edit_requested",
      state,
      auditEvent,
    });
  }

  // ── Priority 1 — rejected ─────────────────────────────────────────────────
  if (anyMatch(lower, REJECT_PATTERNS)) {
    const next = setPendingConsensus(state, null);
    return makeResult({
      resolved: true,
      action: "rejected",
      state: next,
      message:
        "Understood. Please provide the findings again, or choose the GATIOD system to assess.",
      stopPipeline: true,
      auditEvent: {
        eventType: "semantic_interpretation_rejected",
        payload: { interpretationId: pending.interpretationId },
      },
    });
  }

  // ── Priority 2 — legacy_requested ─────────────────────────────────────────
  if (anyMatch(lower, LEGACY_PATTERNS)) {
    const detected = detectExplicitSystemSelection(replyText);
    const targets = constrainToCandidates(detected, pending.candidateSystems);
    if (targets.length === 0) {
      return makeResult({
        resolved: false,
        action: "unresolved",
        state,
        message:
          "Which system should I handle in legacy mode? Please name one of: " +
          pending.candidateSystems.join(", ") +
          ".",
        chips: pending.candidateSystems.map((s) => `Use legacy for ${s}`),
        stopPipeline: true,
      });
    }
    const target = targets[0];
    let next = setPendingConsensus(state, null);
    next = setClaimComponentOverride(next, target, {
      status: "legacy_deferred",
      reason: "Doctor explicitly chose legacy handling.",
      source: "user_choice",
      createdAt: now,
      updatedAt: now,
    });
    return makeResult({
      resolved: true,
      action: "legacy_requested",
      state: next,
      auditEvent: {
        eventType: "semantic_legacy_fallback_requested",
        payload: { interpretationId: pending.interpretationId, system: target },
      },
    });
  }

  // ── Priority 3 — skipped_system ───────────────────────────────────────────
  if (anyMatch(lower, SKIP_PATTERNS)) {
    const detected = detectExplicitSystemSelection(replyText);
    const targets = constrainToCandidates(detected, pending.candidateSystems);
    if (targets.length === 0) {
      return makeResult({
        resolved: false,
        action: "unresolved",
        state,
        message:
          "Which system should I skip? Please name one of: " +
          pending.candidateSystems.join(", ") +
          ".",
        chips: pending.candidateSystems.map((s) => `Skip ${s}`),
        stopPipeline: true,
      });
    }
    const target = targets[0];
    let next = state;
    // Skipping does not clear the entire consensus — the doctor may still
    // proceed with the remaining systems. We only mark the targeted system
    // and keep pendingConsensus intact for the remaining systems.
    const sysState = state.systems[target];
    if (sysState?.status === "calculated") {
      // Already calculated — REQ-GC-EXCLUSION-001: this is exclusion, not
      // skip. Caller should use setGlobalCvcExclusion instead. Surface the
      // mismatch deterministically.
      return makeResult({
        resolved: false,
        action: "unresolved",
        state,
        message:
          `${target} has already been calculated. To remove it from the combined PI%, use 'exclude from combined PI' instead of skip.`,
        chips: [`Exclude ${target} from combined PI`, "Keep included"],
        stopPipeline: true,
      });
    }
    next = setClaimComponentOverride(next, target, {
      status: "skipped_by_user",
      reason: "Doctor chose to skip this component.",
      source: "user_choice",
      createdAt: now,
      updatedAt: now,
    });
    // Remove the skipped system from pendingConsensus.candidateSystems.
    const remainingCandidates = pending.candidateSystems.filter((s) => s !== target);
    if (remainingCandidates.length === 0) {
      next = setPendingConsensus(next, null);
    } else {
      next = setPendingConsensus(next, {
        ...pending,
        candidateSystems: remainingCandidates,
      });
    }
    return makeResult({
      resolved: true,
      action: "skipped_system",
      state: next,
      auditEvent: {
        eventType: "v2_component_skipped_by_user",
        payload: { interpretationId: pending.interpretationId, system: target },
      },
    });
  }

  // ── Priority 4 — accepted_system_first ────────────────────────────────────
  if (anyMatch(lower, SYSTEM_FIRST_PATTERNS)) {
    const detected = detectExplicitSystemSelection(replyText);
    // For spine multi-scope proposals, try resolving from spine-scope chip labels
    // (e.g. "Assess Cervical spine first") even if detectExplicitSystemSelection
    // returns an empty list.
    let targets = constrainToCandidates(detected, pending.candidateSystems);
    if (
      targets.length === 0 &&
      pending.candidateSystems.includes("spine") &&
      detectSpineScopesFromText(replyText).length > 0
    ) {
      targets = ["spine"];
    }
    if (targets.length === 0) {
      return makeResult({
        resolved: false,
        action: "unresolved",
        state,
        message:
          "Which system should I assess first? Please name one of: " +
          pending.candidateSystems.join(", ") +
          ".",
        chips: pending.candidateSystems.map((s) => `Assess ${s} first`),
        stopPipeline: true,
      });
    }
    const focusSystem = targets[0];
    let next = setPendingConsensus(state, null);
    // Apply legacy_deferred overrides for legacy candidates.
    next = applyOverrideMap(
      next,
      buildLegacyOverridesForCandidates(pending.candidateSystems, "semantic_consensus", now),
    );
    // Apply detected overrides for non-target structured candidates (ADR-0003 §4).
    // "detected" means "accepted but not extracted this turn" — buildNextClaimStep
    // routes the doctor to them on subsequent turns.
    for (const sys of pending.candidateSystems) {
      if (sys === focusSystem) continue;
      const cap = V2_SYSTEM_REGISTRY[sys];
      if (!cap || cap.mode === "legacy") continue; // already handled as legacy_deferred above
      const systemFindings = (pending.candidateFindings ?? []).filter(
        (f: SemanticCandidateFinding) => f.system === sys,
      );
      next = setClaimComponentOverride(next, sys, {
        status: "detected",
        reason: `Accepted via semantic consensus; extraction deferred until the doctor's turn for ${sys}.`,
        source: "semantic_consensus",
        sourceText: pending.sourceText,
        interpretationId: pending.interpretationId,
        sourceHash: pending.sourceHash,
        acceptedFindings: systemFindings.length > 0 ? systemFindings : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Resolve selectedScope for spine proposals (used by spine extractor for scoped extraction).
    const selectedScope =
      focusSystem === "spine"
        ? buildSelectedSpineScopeFromPendingConsensus(pending, replyText)
        : undefined;
    return {
      resolved: true,
      action: "accepted_system_first",
      state: next,
      targetSystem: focusSystem,
      selectedScope,
      auditEvent: {
        eventType: "semantic_interpretation_accepted",
        payload: {
          interpretationId: pending.interpretationId,
          focusSystem,
          candidateSystems: pending.candidateSystems,
        },
      },
    };
  }

  // ── Priority 5 — edit_requested ───────────────────────────────────────────
  if (anyMatch(lower, EDIT_PATTERNS)) {
    let next = setPendingConsensus(state, {
      ...pending,
      awaiting: "edit_instruction",
    });
    return makeResult({
      resolved: true,
      action: "edit_requested",
      state: next,
      message: "What should I change in the interpretation?",
      chips: [],
      stopPipeline: true,
      auditEvent: {
        eventType: "semantic_interpretation_edited",
        payload: {
          interpretationId: pending.interpretationId,
          stage: "awaiting_instruction",
        },
      },
    });
  }

  // ── Priority 6 — accepted_all ─────────────────────────────────────────────
  if (anyMatch(lower, ACCEPT_PATTERNS)) {
    let next = setPendingConsensus(state, null);
    next = applyOverrideMap(
      next,
      buildLegacyOverridesForCandidates(pending.candidateSystems, "semantic_consensus", now),
    );
    // Write detected overrides for every structured candidate — fan-out model
    // (ADR-0003 §4). buildNextClaimStep extracts one system per turn.
    for (const sys of pending.candidateSystems) {
      const cap = V2_SYSTEM_REGISTRY[sys];
      if (!cap || cap.mode === "legacy") continue;
      const systemFindings = (pending.candidateFindings ?? []).filter(
        (f: SemanticCandidateFinding) => f.system === sys,
      );
      next = setClaimComponentOverride(next, sys, {
        status: "detected",
        reason: "Accepted via semantic consensus.",
        source: "semantic_consensus",
        sourceText: pending.sourceText,
        interpretationId: pending.interpretationId,
        sourceHash: pending.sourceHash,
        acceptedFindings: systemFindings.length > 0 ? systemFindings : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
    return makeResult({
      resolved: true,
      action: "accepted_all",
      state: next,
      auditEvent: {
        eventType: "semantic_interpretation_accepted",
        payload: {
          interpretationId: pending.interpretationId,
          candidateSystems: pending.candidateSystems,
        },
      },
    });
  }

  // ── Priority 7 — unresolved ───────────────────────────────────────────────
  return makeResult({
    resolved: false,
    action: "unresolved",
    state,
    message:
      "Please choose how to proceed with the interpretation.",
    chips: ["Proceed", "Edit interpretation", "Choose system first", "Reject"],
    stopPipeline: true,
  });
}
