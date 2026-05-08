import { describe, expect, it } from "vitest";
import {
  defaultV2SessionState,
  applyStructuredExtraction,
  hashExtractedFacts,
  invalidateConfirmation,
  setConfirmationPending,
  setConfirmationConfirmed,
  graduateObservation,
} from "../../../src/v2/stateMachine.js";
import type { ExtractedFact, V2SystemFacts } from "../../../src/v2/contracts.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T): ExtractedFact<T> {
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex", createdAt: nowIso(), updatedAt: nowIso() };
}

// ── hashExtractedFacts ────────────────────────────────────────────────────────

describe("hashExtractedFacts", () => {
  it("produces a 16-char hex string", () => {
    const hash = hashExtractedFacts({ side: fact("left") });
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("is deterministic for same facts", () => {
    const facts: V2SystemFacts = { side: fact("left"), rom_from_nerve: fact(false) };
    expect(hashExtractedFacts(facts)).toBe(hashExtractedFacts(facts));
  });

  it("differs for different facts", () => {
    expect(hashExtractedFacts({ side: fact("left") })).not.toBe(hashExtractedFacts({ side: fact("right") }));
  });
});

// ── applyStructuredExtraction ─────────────────────────────────────────────────

describe("applyStructuredExtraction", () => {
  it("applies fact patch and slot signals", () => {
    const state = defaultV2SessionState();
    const result = {
      extractedFactsPatch: { side: fact("left") },
      pendingObservationsToAdd: [],
      pendingObservationsToResolve: [],
      slotSignalsPatch: { side: true as const },
      displayValuesPatch: { side: "left" },
      warnings: [],
    };
    const next = applyStructuredExtraction(state, "upper_limb", result);
    expect(next.systems.upper_limb.extractedFacts["side"]?.value).toBe("left");
    expect(next.systems.upper_limb.slotSignals.side).toBe(true);
    expect(next.systems.upper_limb.extractedValues["side"]).toBe("left");
  });

  it("adds pending observations", () => {
    const state = defaultV2SessionState();
    const obs = {
      id: "obs1",
      system: "upper_limb" as const,
      type: "rom_measurement" as const,
      sourceText: "90 degrees",
      parsed: { joint: "shoulder", angle: 90 },
      missingFields: ["direction"],
      clarificationQuestion: "Which direction?",
      candidateAnswers: ["Flexion"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const result = {
      extractedFactsPatch: {},
      pendingObservationsToAdd: [obs],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    };
    const next = applyStructuredExtraction(state, "upper_limb", result);
    expect(next.systems.upper_limb.pendingObservations).toHaveLength(1);
  });

  it("invalidates confirmation when facts change", () => {
    let state = defaultV2SessionState();
    // Manually set confirmation to "pending"
    state = {
      ...state,
      systems: {
        ...state.systems,
        upper_limb: {
          ...state.systems.upper_limb,
          confirmation: { status: "pending", factsHash: "abc123" },
        },
      },
    };
    const result = {
      extractedFactsPatch: { side: fact("right") },
      pendingObservationsToAdd: [],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    };
    const next = applyStructuredExtraction(state, "upper_limb", result);
    expect(next.systems.upper_limb.confirmation.status).toBe("stale");
    expect(next.systems.upper_limb.piPercent).toBeNull();
  });
});

// ── invalidateConfirmation ────────────────────────────────────────────────────

describe("invalidateConfirmation", () => {
  it("sets confirmation to stale and clears piPercent", () => {
    let state = defaultV2SessionState();
    state = {
      ...state,
      systems: {
        ...state.systems,
        upper_limb: {
          ...state.systems.upper_limb,
          confirmation: { status: "confirmed", factsHash: "abc" },
          piPercent: 8,
        },
      },
    };
    const next = invalidateConfirmation(state, "upper_limb");
    expect(next.systems.upper_limb.confirmation.status).toBe("stale");
    expect(next.systems.upper_limb.piPercent).toBeNull();
  });

  it("is a no-op when confirmation is not_confirmed", () => {
    const state = defaultV2SessionState();
    const next = invalidateConfirmation(state, "upper_limb");
    expect(next).toBe(state);
  });
});

// ── setConfirmationPending / setConfirmationConfirmed ─────────────────────────

describe("confirmation lifecycle", () => {
  it("pending includes factsHash derived from current extractedFacts", () => {
    let state = defaultV2SessionState();
    state = applyStructuredExtraction(state, "upper_limb", {
      extractedFactsPatch: { side: fact("left") },
      pendingObservationsToAdd: [],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    });
    const next = setConfirmationPending(state, "upper_limb", "Summary: left, shoulder flexion 90°.");
    expect(next.systems.upper_limb.confirmation.status).toBe("pending");
    expect(next.systems.upper_limb.confirmation.factsHash).toHaveLength(16);
  });

  it("confirmed sets confirmedAt and keeps factsHash", () => {
    let state = defaultV2SessionState();
    state = setConfirmationPending(state, "upper_limb", "summary");
    const next = setConfirmationConfirmed(state, "upper_limb", "user-123");
    expect(next.systems.upper_limb.confirmation.status).toBe("confirmed");
    expect(next.systems.upper_limb.confirmation.confirmedBy).toBe("user-123");
    expect(next.systems.upper_limb.confirmation.confirmedAt).toBeTruthy();
  });
});

// ── graduateObservation ───────────────────────────────────────────────────────

describe("graduateObservation", () => {
  it("removes the observation and adds facts", () => {
    let state = defaultV2SessionState();
    const obs = {
      id: "obs1",
      system: "upper_limb" as const,
      type: "rom_measurement" as const,
      sourceText: "90 degrees",
      parsed: { joint: "shoulder", angle: 90 },
      missingFields: ["direction"],
      clarificationQuestion: "Which direction?",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state = applyStructuredExtraction(state, "upper_limb", {
      extractedFactsPatch: {},
      pendingObservationsToAdd: [obs],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    });
    expect(state.systems.upper_limb.pendingObservations).toHaveLength(1);

    const patch: V2SystemFacts = { rom_joints: fact({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }) };
    const next = graduateObservation(state, "upper_limb", "obs1", patch);
    expect(next.systems.upper_limb.pendingObservations).toHaveLength(0);
    expect(next.systems.upper_limb.extractedFacts["rom_joints"]).toBeDefined();
  });
});
