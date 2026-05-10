// Global CVC (Combined Values Chart) orchestration helpers — Q4 of the
// V2 grilling session. Uses a derived soft queue rather than a persistent
// MultiSystemAssessmentQueue: state already records each system's piPercent
// after a successful assess_*, so we read directly from `state.systems[*]`.
// The "offer-then-combine" UX is enforced by storing a snapshot of the
// component values at offer time; if the doctor edits a finding before
// confirming, the snapshot diverges from the current state and the offer
// is re-presented with the new values.
import type {
  GatiodSystemKey,
  GlobalCvcExclusion,
  PendingGlobalCvcConfirmation,
  V2SessionState,
} from "./contracts.js";
import { combineMultipleValuesChart } from "../engine/cvcCalculator.js";
import { setGlobalCvcExclusion } from "./stateMachine.js";

export interface CalculatedSystemPi {
  system: GatiodSystemKey;
  piPercent: number;
}

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
 * Snapshot of every system that has produced a positive PI% via a successful
 * assess_* tool execution. A system whose facts changed after calculation
 * has piPercent === null (cleared by applyStructuredExtraction), so it does
 * not appear here. This is the soft queue.
 *
 * Systems explicitly excluded by the doctor via `globalCvcExclusions`
 * (REQ-GC-EXCLUSION-001) are filtered out — their PI% remains valid in
 * V2SystemState for audit, but they do not contribute to Global CVC.
 */
export function getCalculatedSystems(state: V2SessionState): CalculatedSystemPi[] {
  const out: CalculatedSystemPi[] = [];
  const exclusions = state.globalCvcExclusions ?? {};
  for (const [key, sys] of Object.entries(state.systems)) {
    const system = key as GatiodSystemKey;
    if (exclusions[system]) continue;
    if (
      sys.status === "calculated" &&
      typeof sys.piPercent === "number" &&
      sys.piPercent > 0
    ) {
      out.push({ system, piPercent: sys.piPercent });
    }
  }
  // Largest first — matches CVC convention.
  out.sort((a, b) => b.piPercent - a.piPercent);
  return out;
}

/**
 * The assistant should offer a Global CVC combination when:
 *   - at least 2 systems have calculated PI values, and
 *   - no global CVC offer is already pending (avoid double-prompting).
 */
export function shouldOfferGlobalCvc(state: V2SessionState): boolean {
  if (state.pendingGlobalCvcConfirmation) return false;
  return getCalculatedSystems(state).length >= 2;
}

export interface GlobalCvcOffer {
  appendMessage: string;
  chips: string[];
  snapshot: PendingGlobalCvcConfirmation;
}

/**
 * Build the post-handoff offer message and the corresponding pending
 * confirmation snapshot. The snapshot is what verifyGlobalCvcSnapshot will
 * compare against at confirmation time to detect stale offers.
 */
export function buildGlobalCvcOffer(state: V2SessionState): GlobalCvcOffer | null {
  const components = getCalculatedSystems(state);
  if (components.length < 2) return null;

  const lines = components.map(
    (c) => `- ${SYSTEM_LABELS[c.system]}: ${formatPercent(c.piPercent)}`,
  );

  const appendMessage =
    `Completed system assessments:\n${lines.join("\n")}\n\n` +
    `Calculate combined GATIOD PI% using the Combined Values Chart?`;

  const snapshot: PendingGlobalCvcConfirmation = {
    status: "pending",
    componentSystems: components.map((c) => c.system),
    componentValues: components.map((c) => c.piPercent),
    createdAt: new Date().toISOString(),
  };

  return {
    appendMessage,
    chips: ["Combine", "Add another system", "Edit a finding"],
    snapshot,
  };
}

export interface SnapshotVerification {
  ok: boolean;
  /** Systems whose current piPercent diverges from the snapshot. */
  divergedSystems: GatiodSystemKey[];
  /** Systems removed since offer (e.g. facts edited → piPercent cleared). */
  missingSystems: GatiodSystemKey[];
  /** Systems newly calculated since offer. */
  addedSystems: GatiodSystemKey[];
}

/**
 * Compare the snapshot taken at offer time against the current state. If any
 * component changed, the snapshot is stale and the offer must be re-presented
 * with the new values before combining.
 */
export function verifyGlobalCvcSnapshot(
  state: V2SessionState,
  snapshot: PendingGlobalCvcConfirmation,
): SnapshotVerification {
  const current = getCalculatedSystems(state);
  const currentMap = new Map(current.map((c) => [c.system, c.piPercent]));
  const snapshotMap = new Map(
    snapshot.componentSystems.map((s, i) => [s, snapshot.componentValues[i]] as const),
  );

  const divergedSystems: GatiodSystemKey[] = [];
  const missingSystems: GatiodSystemKey[] = [];
  for (const [system, snapVal] of snapshotMap) {
    const currentVal = currentMap.get(system);
    if (currentVal === undefined) {
      missingSystems.push(system);
    } else if (currentVal !== snapVal) {
      divergedSystems.push(system);
    }
  }

  const addedSystems: GatiodSystemKey[] = [];
  for (const [system] of currentMap) {
    if (!snapshotMap.has(system)) addedSystems.push(system);
  }

  return {
    ok: divergedSystems.length === 0 && missingSystems.length === 0 && addedSystems.length === 0,
    divergedSystems,
    missingSystems,
    addedSystems,
  };
}

/**
 * Vanilla CVC combination (no caps, no exclusions). Matches the engine's
 * `combineMultipleValuesChart`. Caps and exclusions are an explicit
 * follow-up; see CONTEXT.md → Pending implementation checkpoints.
 */
export function combineCalculatedSystemPis(values: CalculatedSystemPi[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0].piPercent;
  const sorted = [...values].sort((a, b) => b.piPercent - a.piPercent);
  return combineMultipleValuesChart(sorted.map((v) => v.piPercent));
}

interface GlobalCvcToolResult {
  globalPiPercent?: number;
  cvcInputs?: number[];
  details?: { system: string; piPercent: number }[];
}

/**
 * Render the deterministic Global CVC result message. The phrasing is locked
 * to the no-tool-no-PI guard (`System-generated GATIOD PI%: X%` is reserved
 * for successful assess_* evidence — `assess_global_cvc` qualifies).
 */
export function renderGlobalCvcResult(result: unknown): string {
  const r = (result ?? {}) as GlobalCvcToolResult;
  const globalPi = typeof r.globalPiPercent === "number" ? r.globalPiPercent : 0;
  const inputs = Array.isArray(r.cvcInputs) ? r.cvcInputs : [];
  const details = Array.isArray(r.details) ? r.details : [];

  const inputLines = details
    .map((d) => `- ${SYSTEM_LABELS[d.system as GatiodSystemKey] ?? d.system}: ${formatPercent(d.piPercent)}`)
    .join("\n");

  const calcLine =
    inputs.length === 2
      ? `${formatPercent(inputs[0])} combined with ${formatPercent(inputs[1])} → ${formatPercent(globalPi)}`
      : `${inputs.map(formatPercent).join(" combined with ")} → ${formatPercent(globalPi)}`;

  return [
    `**Combined GATIOD PI%: ${formatPercent(globalPi)}**`,
    "",
    "CVC inputs:",
    inputLines,
    "",
    "Calculation:",
    calcLine,
    "",
    `**System-generated GATIOD PI%: ${formatPercent(globalPi)}**`,
  ].join("\n");
}

function formatPercent(v: number): string {
  // Match the engine's existing display style (whole numbers when integer,
  // one decimal otherwise).
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

// ── P1-B: Global CVC exclusion handling (REQ-GC-EXCLUSION-001) ─────────────
//
// `excludeFromGlobalCvc` and `reincludeInGlobalCvc` are the higher-level
// helpers callers should use when the doctor decides to omit a calculated
// system from the combined PI% (or restore it). Both:
//   1. Update `state.globalCvcExclusions` correctly.
//   2. Stale any pending CVC offer that included the affected system.
//   3. Return the audit-event payload so the caller can log it as
//      `v2_global_cvc_component_excluded` / `v2_global_cvc_component_reincluded`.
//
// Stale rule: any change to which calculated systems are CVC-eligible
// invalidates the snapshot's `componentSystems` and `componentValues`. The
// safe behaviour is to drop the offer; the next turn re-evaluates whether
// to re-offer.

export type GlobalCvcExclusionChangeKind = "excluded" | "reincluded";

export interface GlobalCvcExclusionAuditPayload {
  kind: GlobalCvcExclusionChangeKind;
  system: GatiodSystemKey;
  piPercent: number | null;
  reason?: string;
  /** Snapshot of the pending CVC offer that was staled, if any. */
  previousSnapshot?: {
    componentSystems: GatiodSystemKey[];
    componentValues: number[];
  };
  /** True when the change actually removed an offer (not just changed
   *  exclusion). Useful for telemetry. */
  staleOfferDropped: boolean;
}

export interface GlobalCvcExclusionChangeResult {
  state: V2SessionState;
  auditEvent: {
    eventType: "v2_global_cvc_component_excluded" | "v2_global_cvc_component_reincluded";
    payload: GlobalCvcExclusionAuditPayload;
  };
}

function staleSnapshotIfAffected(
  state: V2SessionState,
  affectedSystem: GatiodSystemKey,
): {
  state: V2SessionState;
  previousSnapshot?: GlobalCvcExclusionAuditPayload["previousSnapshot"];
  dropped: boolean;
} {
  const pending = state.pendingGlobalCvcConfirmation;
  if (!pending) {
    return { state, dropped: false };
  }
  // Any change to exclusions invalidates the snapshot when the affected
  // system was either in the offer (now excluded) or could be added (now
  // reincluded). The offer's componentSystems is the authoritative list.
  const affected = pending.componentSystems.includes(affectedSystem);
  if (!affected) {
    // Re-inclusion of a system the offer already excluded should still
    // re-offer because the eligible set grew. Treat any exclusion-list
    // change as cause to drop.
  }
  const previousSnapshot = {
    componentSystems: [...pending.componentSystems],
    componentValues: [...pending.componentValues],
  };
  return {
    state: { ...state, pendingGlobalCvcConfirmation: null },
    previousSnapshot,
    dropped: true,
  };
}

/**
 * Exclude an already-calculated system from Global CVC. Stales any pending
 * offer. Caller should log the returned audit event.
 *
 * Pre-condition: the system should be `calculated` (PI% > 0). The helper
 * does not enforce this — REQ-GC-EXCLUSION-001 disallows excluding a
 * non-calculated system, and the consensus resolver's "skip" handler
 * already redirects pre-calculation skips to `claimComponentOverrides`.
 */
export function excludeFromGlobalCvc(
  state: V2SessionState,
  system: GatiodSystemKey,
  options: {
    excludedAt?: string;
    excludedBy?: string;
    reason?: string;
  } = {},
): GlobalCvcExclusionChangeResult {
  const exclusion: GlobalCvcExclusion = {
    excludedAt: options.excludedAt ?? new Date().toISOString(),
    excludedBy: options.excludedBy,
    reason: options.reason,
    source: "user_choice",
  };
  let nextState = setGlobalCvcExclusion(state, system, exclusion);
  const stale = staleSnapshotIfAffected(nextState, system);
  nextState = stale.state;

  const piPercent = state.systems[system]?.piPercent ?? null;
  return {
    state: nextState,
    auditEvent: {
      eventType: "v2_global_cvc_component_excluded",
      payload: {
        kind: "excluded",
        system,
        piPercent,
        reason: options.reason,
        previousSnapshot: stale.previousSnapshot,
        staleOfferDropped: stale.dropped,
      },
    },
  };
}

/**
 * Re-include a previously excluded system in Global CVC. Stales any pending
 * offer because the eligible set just grew.
 */
export function reincludeInGlobalCvc(
  state: V2SessionState,
  system: GatiodSystemKey,
): GlobalCvcExclusionChangeResult {
  let nextState = setGlobalCvcExclusion(state, system, null);
  const stale = staleSnapshotIfAffected(nextState, system);
  nextState = stale.state;

  const piPercent = state.systems[system]?.piPercent ?? null;
  return {
    state: nextState,
    auditEvent: {
      eventType: "v2_global_cvc_component_reincluded",
      payload: {
        kind: "reincluded",
        system,
        piPercent,
        previousSnapshot: stale.previousSnapshot,
        staleOfferDropped: stale.dropped,
      },
    },
  };
}
