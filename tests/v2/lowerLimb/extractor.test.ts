import { describe, expect, it } from "vitest";
import { extractLowerLimb } from "../../../src/v2/extractors/lowerLimb.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { NormalizedUtterance } from "../../../src/v2/contracts.js";

function utt(text: string): NormalizedUtterance {
  return {
    raw: text,
    normalizedText: text.toLowerCase(),
    tokens: text.split(/\s+/),
    mappedTokens: [],
    unresolvedTerms: [],
    confidence: 0.9,
  };
}

function emptySystemState() {
  return defaultV2SessionState().systems.lower_limb;
}

// ── Side extraction ───────────────────────────────────────────────────────────

describe("side extraction", () => {
  it("extracts left side", () => {
    const r = extractLowerLimb(utt("left knee flexion 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]?.value).toBe("left");
    expect(r.slotSignalsPatch.side).toBe(true);
  });

  it("extracts right side", () => {
    const r = extractLowerLimb(utt("right hip flexion 100 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]?.value).toBe("right");
  });

  it("warns for bilateral, does not extract side", () => {
    const r = extractLowerLimb(utt("bilateral knee 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]).toBeUndefined();
    expect(r.warnings.some((w) => /bilateral/i.test(w))).toBe(true);
  });
});

// ── ROM extraction ────────────────────────────────────────────────────────────

describe("ROM extraction", () => {
  it("extracts hip flexion", () => {
    const r = extractLowerLimb(utt("left hip flexion 80 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["hip"]?.measurements?.["flexion"]).toBe(80);
  });

  it("extracts knee flexion with degree symbol", () => {
    const r = extractLowerLimb(utt("left knee flexion 120°"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["knee"]?.measurements?.["flexion"]).toBe(120);
  });

  it("extracts ankle dorsiflexion", () => {
    const r = extractLowerLimb(utt("right ankle dorsiflexion 15 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["ankle"]?.measurements?.["dorsiflexion"]).toBe(15);
  });

  it("extracts ankle plantarflexion", () => {
    const r = extractLowerLimb(utt("right ankle plantarflexion 30 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["ankle"]?.measurements?.["plantarflexion"]).toBe(30);
  });

  it("extracts subtalar inversion", () => {
    const r = extractLowerLimb(utt("right subtalar inversion 20 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["subtalar"]?.measurements?.["inversion"]).toBe(20);
  });

  it("extracts hip multiple directions", () => {
    const r = extractLowerLimb(utt("left hip flexion 80 degrees extension 20 degrees abduction 30 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["hip"]?.measurements?.["flexion"]).toBe(80);
    expect(joints?.["hip"]?.measurements?.["extension"]).toBe(20);
    expect(joints?.["hip"]?.measurements?.["abduction"]).toBe(30);
  });

  it("marks ankylosis flag", () => {
    const r = extractLowerLimb(utt("left knee ankylosed at flexion 30 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { isAnkylosed: boolean; measurements: Record<string, number> }>;
    expect(joints?.["knee"]?.isAnkylosed).toBe(true);
    expect(joints?.["knee"]?.measurements?.["flexion"]).toBe(30);
  });

  it("creates pending observation for bare angle with known joint", () => {
    const r = extractLowerLimb(utt("left knee 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["rom_joints"]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("rom_measurement");
    expect(r.pendingObservationsToAdd[0].parsed["joint"]).toBe("knee");
    expect(r.pendingObservationsToAdd[0].parsed["angle"]).toBe(90);
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Flexion");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Flexion Contracture");
  });

  it("creates pending observation for bare angle with no joint", () => {
    const r = extractLowerLimb(utt("90 degrees"), emptySystemState());
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].parsed["joint"]).toBeUndefined();
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Hip");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Knee");
  });
});

// ── Nerve extraction ──────────────────────────────────────────────────────────

describe("nerve extraction", () => {
  it("extracts fully described sciatic nerve", () => {
    const r = extractLowerLimb(utt("left sciatic nerve motor total"), emptySystemState());
    const nerves = r.extractedFactsPatch["nerve_selections"]?.value as { nerveKey: string; deficitType: string; lossType: string }[];
    expect(nerves).toHaveLength(1);
    expect(nerves[0].nerveKey).toBe("sciatic");
    expect(nerves[0].deficitType).toBe("motor");
    expect(nerves[0].lossType).toBe("total");
  });

  it("creates pending observation for nerve without deficit/loss type", () => {
    const r = extractLowerLimb(utt("left common peroneal nerve injury"), emptySystemState());
    expect(r.extractedFactsPatch["nerve_selections"]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("nerve_deficit");
    expect(r.pendingObservationsToAdd[0].parsed["nerveKey"]).toBe("common_peroneal");
  });

  it("negation extracts empty nerve selections", () => {
    const r = extractLowerLimb(utt("no nerve injury"), emptySystemState());
    expect(r.extractedFactsPatch["nerve_selections"]?.value).toEqual([]);
    expect(r.slotSignalsPatch.nerve_present).toBe(false);
  });

  it("extracts tibial nerve sensory partial", () => {
    const r = extractLowerLimb(utt("right tibial nerve sensory partial"), emptySystemState());
    const nerves = r.extractedFactsPatch["nerve_selections"]?.value as { nerveKey: string }[];
    expect(nerves[0].nerveKey).toBe("tibial");
  });
});

// ── Shortening extraction ─────────────────────────────────────────────────────

describe("shortening extraction", () => {
  it("extracts shortening with cm value", () => {
    const r = extractLowerLimb(utt("leg shortening of 2.5 cm"), emptySystemState());
    expect(r.extractedFactsPatch["shortening_cm"]?.value).toBe(2.5);
    expect(r.displayValuesPatch["shortening_cm"]).toBe("2.5cm");
  });

  it("extracts shortening with integer cm value", () => {
    const r = extractLowerLimb(utt("shortening 3 cm"), emptySystemState());
    expect(r.extractedFactsPatch["shortening_cm"]?.value).toBe(3);
  });

  it("creates pending observation for shortening without cm value", () => {
    const r = extractLowerLimb(utt("there is leg shortening"), emptySystemState());
    expect(r.extractedFactsPatch["shortening_cm"]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].parsed["type"]).toBe("shortening");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("1 cm");
  });

  it("does not create shortening fact when shortening keyword absent", () => {
    const r = extractLowerLimb(utt("left knee flexion 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["shortening_cm"]).toBeUndefined();
  });
});

// ── Amputation extraction ─────────────────────────────────────────────────────

describe("leg amputation extraction", () => {
  it("extracts above knee amputation", () => {
    const r = extractLowerLimb(utt("left above knee amputation"), emptySystemState());
    expect(r.extractedFactsPatch["leg_amputation"]?.value).toBe("above_knee");
    expect(r.slotSignalsPatch.amputation_present).toBe(true);
  });

  it("extracts below knee amputation", () => {
    const r = extractLowerLimb(utt("right below knee amputation"), emptySystemState());
    expect(r.extractedFactsPatch["leg_amputation"]?.value).toBe("below_knee");
  });

  it("extracts Syme amputation", () => {
    const r = extractLowerLimb(utt("left syme's amputation"), emptySystemState());
    expect(r.extractedFactsPatch["leg_amputation"]?.value).toBe("syme");
  });

  it("extracts transmetatarsal amputation", () => {
    const r = extractLowerLimb(utt("right transmetatarsal amputation"), emptySystemState());
    expect(r.extractedFactsPatch["leg_amputation"]?.value).toBe("transmetatarsal");
  });

  it("negation extracts none for leg amputation", () => {
    const r = extractLowerLimb(utt("no amputation"), emptySystemState());
    expect(r.extractedFactsPatch["leg_amputation"]?.value).toBe("none");
    expect(r.slotSignalsPatch.amputation_present).toBe(false);
  });
});

// ── ROM-from-nerve gate ───────────────────────────────────────────────────────

describe("ROM-from-nerve gate", () => {
  it("extracts rom due to nerve", () => {
    const r = extractLowerLimb(utt("rom from nerve"), emptySystemState());
    expect(r.extractedFactsPatch["rom_from_nerve"]?.value).toBe(true);
    expect(r.slotSignalsPatch.rom_from_nerve).toBe(true);
  });

  it("extracts independent rom", () => {
    const r = extractLowerLimb(utt("rom is independent of nerve"), emptySystemState());
    expect(r.extractedFactsPatch["rom_from_nerve"]?.value).toBe(false);
  });
});

// ── No other findings ─────────────────────────────────────────────────────────

describe("no other findings", () => {
  it("zero-fills nerve, leg amputation, toe amputations, shortening and dbe", () => {
    const r = extractLowerLimb(utt("left knee flexion 90 degrees, no other findings"), emptySystemState());
    expect((r.extractedFactsPatch["nerve_selections"]?.value as unknown[]).length).toBe(0);
    expect(r.extractedFactsPatch["leg_amputation"]?.value).toBe("none");
    expect(r.extractedFactsPatch["shortening_cm"]?.value).toBe(0);
    expect((r.extractedFactsPatch["dbe_selections"]?.value as unknown[]).length).toBe(0);
    const toes = r.extractedFactsPatch["toe_amputations"]?.value as Record<string, string>;
    expect(toes["great"]).toBe("none");
    expect(toes["fifth"]).toBe("none");
  });
});
