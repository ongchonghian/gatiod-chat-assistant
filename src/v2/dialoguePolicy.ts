import type { GatiodSystemKey, SlotSignals, V2SystemState } from "./contracts.js";
import { getMissingSlots } from "./slotEvaluator.js";

export type SlotAction =
  | { type: "ASK"; slotKey: string; question: string; chips: string[] }
  | { type: "CONFIRM" }
  | { type: "PROCEED" };

/**
 * Given the accumulated slot signals for a system, decide the next step:
 * - ASK: a required slot is still missing — return its question + chips
 * - CONFIRM: all required slots are satisfied — ready for confirmation
 * - PROCEED: no system-specific slot control needed (e.g. unknown system)
 */
export function decideSlotAction(
  system: GatiodSystemKey,
  signals: Partial<SlotSignals>
): SlotAction {
  const missing = getMissingSlots(system, signals);
  if (missing.length === 0) return { type: "CONFIRM" };
  const next = missing[0];
  return { type: "ASK", slotKey: next.key, question: next.question, chips: next.chips };
}

/**
 * Convenience wrapper that reads signals from a V2SystemState.
 */
export function decideSlotActionFromState(
  system: GatiodSystemKey,
  systemState: V2SystemState
): SlotAction {
  return decideSlotAction(system, systemState.slotSignals ?? {});
}
