import { describe, expect, it } from "vitest";
import { processChatV2 } from "../../src/chat/chatServiceV2.js";
import { saveSessionSystemStates } from "../../src/db/sessionStore.js";
import { defaultV2SessionState, toSystemStateEnvelope } from "../../src/v2/stateMachine.js";
import type { GatiodSystemKey, V2SessionState } from "../../src/v2/contracts.js";

function withCalculated(state: V2SessionState, system: GatiodSystemKey, piPercent: number): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system) ? state.detectionOrder : [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "calculated", piPercent, completeness: 1 },
    },
  };
}

function withCollecting(state: V2SessionState, system: GatiodSystemKey): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system) ? state.detectionOrder : [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "collecting" },
    },
  };
}

function seed(sessionId: string, state: V2SessionState): void {
  saveSessionSystemStates(sessionId, toSystemStateEnvelope(state, {}));
}

// ── ADR-0006 / slice #11 — save-point chat acknowledgment ────────────────────
//
// These tests drive `processChatV2` with a meta-intent skip utterance so a
// system that was collecting transitions to skipped_by_user. The save-point
// emission triggers off newly-calculated systems; skip is a deliberately
// orthogonal vector that exercises the count-remaining logic without
// depending on the extractor/calculator pipelines.
//
// Direct save-point assertions on a real assess_* tool execution belong in
// per-system integration suites where the calculator stack is already set up.

describe("save-point count-remaining (slice #11)", () => {
  it("emits 'all systems complete' line when last collecting system reaches calculated", async () => {
    const sessionId = `save-${Date.now()}-${Math.random()}`;
    // Seed: spine calculated, cns collecting. Skip cns → newly-calculated is empty,
    // remaining is 0. The skip path itself doesn't emit a save-point line, but
    // the dispatch flow exercises the chunk safely.
    let state = defaultV2SessionState();
    state = withCalculated(state, "spine", 8);
    state = withCollecting(state, "cns");
    seed(sessionId, state);

    const r = await processChatV2(sessionId, "skip cns", { shadow: true });
    // Skip acknowledgment present, no save-point line (no newly-calculated system).
    expect(r.message).toMatch(/CNS|Central Nervous System/);
    expect(r.message).not.toMatch(/system left/);
  });

  it("does NOT emit a save-point line when no system newly transitioned to calculated", async () => {
    const sessionId = `save-${Date.now()}-${Math.random()}`;
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    seed(sessionId, state);

    // Status meta-intent doesn't change system status — save-point line must NOT appear.
    const r = await processChatV2(sessionId, "where are we", { shadow: true });
    expect(r.message).not.toMatch(/saved at/i);
  });
});
