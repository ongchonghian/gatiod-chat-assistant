import { describe, expect, it } from "vitest";
import { tryResolvePendingObservation } from "../../../src/v2/pendingObservationResolver.js";
import {
  defaultV2SessionState,
  applyStructuredExtraction,
} from "../../../src/v2/stateMachine.js";
import type { NormalizedUtterance } from "../../../src/v2/contracts.js";

function nowIso() { return new Date().toISOString(); }

function utt(text: string): NormalizedUtterance {
  return {
    raw: text,
    normalizedText: text.toLowerCase(),
    tokens: text.split(/\s+/),
    mappedTokens: [],
    unresolvedTerms: [],
    confidence: 1.0,
  };
}

// ── ROM measurement resolution ────────────────────────────────────────────────

describe("tryResolvePendingObservation — rom_measurement", () => {
  function stateWithRomObs() {
    const obs = {
      id: "obs-rom1",
      system: "upper_limb" as const,
      type: "rom_measurement" as const,
      sourceText: "90 degrees",
      parsed: { joint: "shoulder", angle: 90, isAnkylosed: false },
      missingFields: ["direction"],
      clarificationQuestion: "Which shoulder movement does 90° apply to?",
      candidateAnswers: ["Flexion", "Extension", "Abduction"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return applyStructuredExtraction(defaultV2SessionState(), "upper_limb", {
      extractedFactsPatch: {},
      pendingObservationsToAdd: [obs],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    });
  }

  it("resolves when user replies with matching direction chip", () => {
    const state = stateWithRomObs();
    const result = tryResolvePendingObservation(state, "upper_limb", utt("Flexion"));
    expect(result.resolved).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.state.systems.upper_limb.pendingObservations).toHaveLength(0);
    const joints = result.state.systems.upper_limb.extractedFacts["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["shoulder"]?.measurements?.["flexion"]).toBe(90);
  });

  it("blocks when reply does not match any direction", () => {
    const state = stateWithRomObs();
    const result = tryResolvePendingObservation(state, "upper_limb", utt("yes"));
    expect(result.resolved).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.clarificationQuestion).toContain("shoulder");
  });

  it("resolves case-insensitively", () => {
    const state = stateWithRomObs();
    const result = tryResolvePendingObservation(state, "upper_limb", utt("FLEXION"));
    expect(result.resolved).toBe(true);
  });
});

// ── Nerve deficit resolution ──────────────────────────────────────────────────

describe("tryResolvePendingObservation — nerve_deficit", () => {
  function stateWithNerveObs() {
    const obs = {
      id: "obs-nerve1",
      system: "upper_limb" as const,
      type: "nerve_deficit" as const,
      sourceText: "median nerve",
      parsed: { nerveKey: "median_below" },
      missingFields: ["deficitType", "lossType"],
      clarificationQuestion: "For the median nerve: sensory, motor, or combined? Total or partial?",
      candidateAnswers: ["Sensory partial", "Motor total", "Combined partial"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return applyStructuredExtraction(defaultV2SessionState(), "upper_limb", {
      extractedFactsPatch: {},
      pendingObservationsToAdd: [obs],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    });
  }

  it("resolves combined partial from chip reply", () => {
    const state = stateWithNerveObs();
    const result = tryResolvePendingObservation(state, "upper_limb", utt("Combined partial"));
    expect(result.resolved).toBe(true);
    const nerves = result.state.systems.upper_limb.extractedFacts["nerve_selections"]?.value as { deficitType: string; lossType: string }[];
    expect(nerves[0].deficitType).toBe("combined");
    expect(nerves[0].lossType).toBe("partial");
  });

  it("blocks when reply has neither deficit nor loss type", () => {
    const state = stateWithNerveObs();
    const result = tryResolvePendingObservation(state, "upper_limb", utt("yes please"));
    expect(result.resolved).toBe(false);
    expect(result.blocked).toBe(true);
  });
});

// ── No pending observations ───────────────────────────────────────────────────

describe("tryResolvePendingObservation — no observations", () => {
  it("returns resolved: false, blocked: false when no pending observations", () => {
    const state = defaultV2SessionState();
    const result = tryResolvePendingObservation(state, "upper_limb", utt("flexion"));
    expect(result.resolved).toBe(false);
    expect(result.blocked).toBe(false);
  });
});
