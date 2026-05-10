// Unified claim plan derivation and next-step rendering.
//
// Slice B of the semantic consensus rollout (ADR-0003). Replaces the role of
// `buildNextSystemHandoff` in `chatServiceV2.ts` as the single orchestration
// entry point. The compact 2-system handoff message is one rendering mode of
// the unified plan; the structured 3+ system plan is another.
//
// Derivation priority (REQ-MS-PLAN-001):
//   1. claimComponentOverrides[system] === skipped_by_user  → skipped_by_user
//   2. claimComponentOverrides[system] === unsupported      → unsupported
//   3. claimComponentOverrides[system] === legacy_deferred  → legacy_deferred
//   4. systems[system].status === calculated                 → calculated
//   5. systems[system].confirmation.status === confirmed     → confirmed
//   6. systems[system].confirmation.status === pending       → confirmation_pending
//   7. pendingObservations.length > 0 OR readiness blocks    → needs_clarification
//   8. extractedFacts has entries / readiness ready          → ready_for_confirmation
//   9. claimComponentOverrides[system] === detected          → detected
//  10. extracted values exist (collecting)                   → detected
//  11. default                                                → idle
//
// Invariant (REQ-MS-PLAN-001):
//   No detected, accepted, deferred, unsupported, or skipped system may
//   disappear from the claim plan merely because it has no extracted facts.

import type {
  ClaimAssessmentComponent,
  ClaimComponentStatus,
  ClaimStep,
  GatiodSystemKey,
  V2SessionState,
  V2SystemState,
} from "./contracts.js";
import { V2_SYSTEM_REGISTRY } from "./systemRegistry.js";

const SYSTEM_KEYS: GatiodSystemKey[] = [
  "spine",
  "upper_limb",
  "lower_limb",
  "hearing",
  "visual",
  "respiratory",
  "renal",
  "gastro_digestive",
  "cns",
];

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

function hasExtractedFacts(sys: V2SystemState): boolean {
  return Object.keys(sys.extractedFacts ?? {}).length > 0;
}

function hasExtractedValues(sys: V2SystemState): boolean {
  return Object.keys(sys.extractedValues ?? {}).length > 0;
}

function deriveOneComponent(
  system: GatiodSystemKey,
  state: V2SessionState,
): ClaimAssessmentComponent {
  const sysState = state.systems[system];
  const override = state.claimComponentOverrides?.[system];
  const exclusion = state.globalCvcExclusions?.[system];

  const exclusionDecorations =
    exclusion && sysState?.status === "calculated"
      ? {
          excludedFromGlobalCvc: true,
          exclusionReason: exclusion.reason,
        }
      : {};

  // Priority 1–3 — terminal user/safety overrides.
  if (override?.status === "skipped_by_user") {
    return {
      system,
      status: "skipped_by_user",
      reason: override.reason,
      source: override.source,
      ...(typeof sysState?.piPercent === "number" ? { piPercent: sysState.piPercent } : {}),
      ...exclusionDecorations,
    };
  }
  if (override?.status === "unsupported") {
    return {
      system,
      status: "unsupported",
      reason: override.reason,
      source: override.source,
    };
  }
  if (override?.status === "legacy_deferred") {
    return {
      system,
      status: "legacy_deferred",
      reason: override.reason,
      source: override.source,
    };
  }

  // Priority 4 — calculated.
  if (sysState?.status === "calculated") {
    return {
      system,
      status: "calculated",
      ...(typeof sysState.piPercent === "number" ? { piPercent: sysState.piPercent } : {}),
      ...exclusionDecorations,
    };
  }

  // Priority 5 — confirmed (post-confirm, pre-tool).
  if (sysState?.confirmation?.status === "confirmed") {
    return { system, status: "confirmed" };
  }

  // Priority 6 — confirmation pending (card rendered, awaiting reply).
  if (
    sysState?.confirmation?.status === "pending" ||
    state.pendingConfirmation?.system === system
  ) {
    return { system, status: "confirmation_pending" };
  }

  // Priority 7 — needs clarification (pending observations).
  if (sysState && sysState.pendingObservations.length > 0) {
    const obs = sysState.pendingObservations[0];
    return {
      system,
      status: "needs_clarification",
      missingFields: obs.missingFields,
      pendingQuestion: obs.clarificationQuestion,
    };
  }

  // Priority 8 — ready for confirmation (facts present, readiness passes).
  if (sysState && hasExtractedFacts(sysState)) {
    const cap = V2_SYSTEM_REGISTRY[system];
    if (cap?.readinessValidator) {
      const readiness = cap.readinessValidator(sysState);
      if (readiness.ready) {
        return { system, status: "ready_for_confirmation" };
      }
      // Facts present but readiness blocks for a non-pending-observation reason.
      return {
        system,
        status: "needs_clarification",
        pendingQuestion: readiness.clarificationQuestion,
      };
    }
    return { system, status: "ready_for_confirmation" };
  }

  // Priority 9 — explicit "detected" override (semantic layer saw it but no
  // facts have been extracted yet).
  if (override?.status === "detected") {
    return {
      system,
      status: "detected",
      reason: override.reason,
      source: override.source,
    };
  }

  // Priority 10 — collecting extracted values without facts yet.
  if (sysState && hasExtractedValues(sysState)) {
    return { system, status: "detected" };
  }

  return { system, status: "idle" };
}

/**
 * Compute the claim assessment plan from session state. Returns one component
 * per GATIOD system; idle systems are included so callers can filter.
 */
export function deriveClaimAssessmentComponents(
  state: V2SessionState,
): ClaimAssessmentComponent[] {
  return SYSTEM_KEYS.map((sys) => deriveOneComponent(sys, state));
}

/** Active components are everything that isn't idle. */
export function deriveActiveClaimComponents(
  state: V2SessionState,
): ClaimAssessmentComponent[] {
  return deriveClaimAssessmentComponents(state).filter((c) => c.status !== "idle");
}

const ACTIONABLE_STATUSES: readonly ClaimComponentStatus[] = [
  "ready_for_confirmation",
  "needs_clarification",
  "confirmation_pending",
  "detected",
];

/** Lower number = higher priority in step picking. */
const STATUS_PRIORITY: Record<ClaimComponentStatus, number> = {
  confirmation_pending: 0,
  ready_for_confirmation: 1,
  needs_clarification: 2,
  detected: 3,
  confirmed: 4,
  calculated: 5,
  legacy_deferred: 6,
  unsupported: 7,
  skipped_by_user: 8,
  idle: 9,
};

interface BuildNextClaimStepOptions {
  /** When set, bias the picker away from this just-completed system so the
   *  flow advances rather than re-confirming the same system. Mirrors the
   *  pre-existing `buildNextSystemHandoff` parameter. */
  justCompleted?: GatiodSystemKey;
  /** Optional explicit focus from the consensus resolver. When set, the
   *  step picker prefers this system if it is actionable. */
  focusSystem?: GatiodSystemKey;
}

function pickNextActionable(
  components: ClaimAssessmentComponent[],
  opts: BuildNextClaimStepOptions,
): ClaimAssessmentComponent | undefined {
  const candidates = components.filter(
    (c) => c.system !== opts.justCompleted && ACTIONABLE_STATUSES.includes(c.status),
  );
  if (candidates.length === 0) return undefined;

  if (opts.focusSystem) {
    const focused = candidates.find((c) => c.system === opts.focusSystem);
    if (focused) return focused;
  }
  return candidates.sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
  )[0];
}

function shouldOfferGlobalCvc(state: V2SessionState): boolean {
  if (state.pendingGlobalCvcConfirmation) return false;
  let positive = 0;
  const exclusions = state.globalCvcExclusions ?? {};
  for (const sys of SYSTEM_KEYS) {
    if (exclusions[sys]) continue;
    const s = state.systems[sys];
    if (s?.status === "calculated" && typeof s.piPercent === "number" && s.piPercent > 0) {
      positive += 1;
    }
  }
  return positive >= 2;
}

function renderClaimPlanLines(components: ClaimAssessmentComponent[]): string[] {
  return components.map((c) => {
    const name = SYSTEM_DISPLAY_NAMES[c.system];
    switch (c.status) {
      case "calculated": {
        const pi = typeof c.piPercent === "number" ? `${c.piPercent}%` : "calculated";
        const tail = c.excludedFromGlobalCvc ? " (excluded from combined PI)" : "";
        return `- **${name}**: ${pi}${tail}`;
      }
      case "ready_for_confirmation":
        return `- **${name}**: ready for confirmation`;
      case "confirmation_pending":
        return `- **${name}**: awaiting confirmation`;
      case "confirmed":
        return `- **${name}**: confirmed, awaiting calculation`;
      case "needs_clarification":
        return `- **${name}**: needs clarification${c.pendingQuestion ? ` — ${c.pendingQuestion}` : ""}`;
      case "detected":
        return `- **${name}**: detected${c.reason ? ` — ${c.reason}` : ""}`;
      case "legacy_deferred":
        return `- **${name}**: legacy/deferred${c.reason ? ` — ${c.reason}` : ""}`;
      case "unsupported":
        return `- **${name}**: unsupported${c.reason ? ` — ${c.reason}` : ""}`;
      case "skipped_by_user":
        return `- **${name}**: skipped`;
      case "idle":
      default:
        return `- **${name}**: idle`;
    }
  });
}

/**
 * Pick the next user-facing step for the claim. Returns `undefined` when
 * nothing actionable remains (caller should consider Global CVC offer or
 * end-of-claim summary).
 *
 * Rendering modes:
 *   - 1-2 active components → compact single-system step (`confirm_system`,
 *     `clarify_system`, `legacy_deferred`, `unsupported`).
 *   - 3+ active components  → `claim_plan` step with a structured list and a
 *     recommended next action.
 *   - ≥2 calculated positive subtotals and no remaining actionable component
 *     → `offer_global_cvc`.
 */
export function buildNextClaimStep(
  state: V2SessionState,
  opts: BuildNextClaimStepOptions = {},
): ClaimStep | undefined {
  const components = deriveActiveClaimComponents(state);
  const actionable = pickNextActionable(components, opts);
  const totalActive = components.length;

  // No actionable system left — consider Global CVC offer.
  if (!actionable) {
    if (shouldOfferGlobalCvc(state)) {
      return {
        kind: "offer_global_cvc",
        message: "Combine the calculated systems into a final GATIOD PI%?",
        chips: ["Combine", "Add another system", "Edit a finding"],
      };
    }
    return undefined;
  }

  // Helper to build a compact step for a single system.
  const buildSingleSystemStep = (component: ClaimAssessmentComponent): ClaimStep => {
    const name = SYSTEM_DISPLAY_NAMES[component.system];
    switch (component.status) {
      case "ready_for_confirmation":
      case "confirmation_pending":
        return {
          kind: "confirm_system",
          system: component.system,
          message: `Continuing with **${name}** — please confirm the captured findings.`,
          chips: ["Confirm and calculate", "Edit findings"],
        };
      case "needs_clarification":
        return {
          kind: "clarify_system",
          system: component.system,
          message: `Continuing with **${name}**. ${
            component.pendingQuestion ?? "Please provide the missing details."
          }`,
        };
      case "detected":
        return {
          kind: "clarify_system",
          system: component.system,
          message: `**${name}** was detected but has no extracted findings yet. Please provide the clinical details.`,
        };
      case "legacy_deferred":
        return {
          kind: "legacy_deferred",
          system: component.system,
          message: `**${name}** is currently handled by legacy assessment mode${
            component.reason ? ` — ${component.reason}` : ""
          }.`,
          chips: [`Use legacy for ${name}`, `Skip ${name}`],
        };
      case "unsupported":
        return {
          kind: "unsupported",
          system: component.system,
          message: `**${name}** cannot be assessed under structured V2${
            component.reason ? ` — ${component.reason}` : ""
          }.`,
          chips: [`Skip ${name}`, `Use legacy for ${name}`],
        };
      default:
        return {
          kind: "clarify_system",
          system: component.system,
          message: `Continuing with **${name}**.`,
        };
    }
  };

  // Compact mode for 1-2 active components — preserves the existing UX.
  if (totalActive <= 2) {
    return buildSingleSystemStep(actionable);
  }

  // Structured plan mode for 3+ active components.
  const planLines = renderClaimPlanLines(components);
  const recommendedName = SYSTEM_DISPLAY_NAMES[actionable.system];
  const message =
    `I detected ${totalActive} GATIOD assessment areas:\n\n${planLines.join("\n")}\n\n` +
    `**Recommended next step:** ${recommendedName} — ${
      actionable.status === "ready_for_confirmation"
        ? "confirm captured findings"
        : actionable.status === "needs_clarification"
          ? "answer the pending clarification"
          : actionable.status === "detected"
            ? "provide clinical details"
            : "continue assessment"
    }.`;

  return {
    kind: "claim_plan",
    message,
    chips: [
      `Continue with ${recommendedName}`,
      "Choose system",
      "Resolve missing details",
    ],
    components,
  };
}
