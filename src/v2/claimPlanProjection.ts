/**
 * Claim plan projection — pure transform from `V2SessionState` to
 * `ClaimPlanView`. The single source of truth for what the claim plan
 * sub-header (slice #02 of the multi-system claim completion PRD) renders
 * at any moment.
 *
 * Deep module by design: every consumer (chat API envelope, frontend
 * sub-header, future status meta-intent handler in ADR-0007) reads from this
 * function. No business logic lives in React; the view is computed once on
 * the server per response.
 *
 * See:
 *   - docs/adr/0006-claim-submission-state-transition.md
 *   - docs/adr/0007-meta-intents-deterministic-routing.md
 *   - src/v2/CONTEXT.md "Claim plan sub-header"
 */

import type {
  ClaimPlanView,
  GatiodSystemKey,
  SubmitState,
  SystemPillStatus,
  SystemPillView,
  V2AssessmentInstance,
  V2SessionState,
} from "./contracts.js";
import { V2_SYSTEM_REGISTRY } from "./systemRegistry.js";
import { combineMultipleValuesChart } from "../engine/cvcCalculator.js";

/**
 * Systems where the top-level slot path key is a side (`"left"` / `"right"`).
 * Only these systems can produce a meaningful `sideBreakdown`. Spine uses
 * region keys, hearing uses ear keys (handled in a later slice if needed),
 * single-organ systems have no per-side concept.
 */
const SIDE_HIERARCHICAL_SYSTEMS = new Set<GatiodSystemKey>(["upper_limb", "lower_limb"]);

const SYSTEM_LABELS: Record<GatiodSystemKey, string> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro-Digestive",
  hearing: "Hearing",
  cns: "CNS",
  visual: "Visual",
};

/**
 * A system is "terminal" — and therefore not blocking Submit — when it has
 * reached `calculated` or been explicitly skipped by the doctor. Matches
 * ADR-0006 §3 (Eligibility rule).
 */
function isTerminalForSubmit(state: V2SessionState, system: GatiodSystemKey): boolean {
  if (state.claimComponentOverrides[system]?.status === "skipped_by_user") return true;
  return state.systems[system]?.status === "calculated";
}

function pillStatusFor(state: V2SessionState, system: GatiodSystemKey): SystemPillStatus {
  if (state.claimComponentOverrides[system]?.status === "skipped_by_user") {
    return "skipped_by_user";
  }
  return state.systems[system]?.status ?? "idle";
}

function isLegacyMode(system: GatiodSystemKey): boolean {
  return V2_SYSTEM_REGISTRY[system]?.mode !== "structured_live";
}

/**
 * Build per-side breakdown for hierarchical-by-side systems (upper_limb,
 * lower_limb). Only counts CALCULATED instances; collecting / pending
 * instances are ignored. Returns undefined when fewer than two distinct
 * sides have calculated values — i.e. unilateral claims and same-side
 * multi-joint claims should NOT show the L+R badge.
 *
 * Multi-instance same-side combines via CVC, matching the system's
 * combinationMethod for limbs. This keeps the per-side number consistent
 * with what the system-level subtotal would compute on that side alone.
 */
function computeSideBreakdown(
  system: GatiodSystemKey,
  instances: V2AssessmentInstance[] | undefined,
): SystemPillView["sideBreakdown"] {
  if (!SIDE_HIERARCHICAL_SYSTEMS.has(system) || !instances || instances.length < 2) {
    return undefined;
  }
  const bySide: { left: number[]; right: number[] } = { left: [], right: [] };
  for (const inst of instances) {
    if (inst.status !== "calculated" || typeof inst.piPercent !== "number") continue;
    const head = inst.slotPath[0];
    if (head === "left") bySide.left.push(inst.piPercent);
    else if (head === "right") bySide.right.push(inst.piPercent);
  }
  if (bySide.left.length === 0 || bySide.right.length === 0) return undefined;
  return {
    left: combineMultipleValuesChart(bySide.left),
    right: combineMultipleValuesChart(bySide.right),
  };
}

function computeSubmitState(
  state: V2SessionState,
  blockingSystems: GatiodSystemKey[],
): SubmitState {
  // Submitted claims hide the chip entirely; the locked badge takes its place.
  if (state.claimSubmittedAt) return { visible: false };
  // Nothing detected yet → no chip.
  if (state.detectionOrder.length === 0) return { visible: false };
  // Any non-terminal system blocks Submit. ADR-0006 §3.
  if (blockingSystems.length > 0) return { visible: false, blockingSystems };
  return { visible: true };
}

export function projectClaimPlan(state: V2SessionState): ClaimPlanView {
  const pills: SystemPillView[] = state.detectionOrder.map((system) => {
    const status = pillStatusFor(state, system);
    const subtotalPercent =
      status === "calculated" ? (state.systems[system]?.piPercent ?? null) : null;
    const sideBreakdown = computeSideBreakdown(system, state.instancesBySystem[system]);
    return {
      system,
      label: SYSTEM_LABELS[system],
      status,
      subtotalPercent,
      ...(sideBreakdown ? { sideBreakdown } : {}),
      isLegacyMode: isLegacyMode(system),
    };
  });

  const blockingSystems = state.detectionOrder.filter(
    (system) => !isTerminalForSubmit(state, system),
  );

  const submitState = computeSubmitState(state, blockingSystems);
  const nextSystem = blockingSystems[0];

  return {
    systems: pills,
    submitState,
    ...(nextSystem ? { nextSystem } : {}),
    isSubmitted: Boolean(state.claimSubmittedAt),
    ...(state.claimSubmittedAt ? { submittedAt: state.claimSubmittedAt } : {}),
  };
}
