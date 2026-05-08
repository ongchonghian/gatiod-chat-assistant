import { describe, expect, it } from "vitest";
import { extractUpperLimb } from "../../../src/v2/extractors/upperLimb.js";
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
  return defaultV2SessionState().systems.upper_limb;
}

// ── Side extraction ───────────────────────────────────────────────────────────

describe("side extraction", () => {
  it("extracts left side", () => {
    const r = extractUpperLimb(utt("left shoulder flexion 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]?.value).toBe("left");
    expect(r.slotSignalsPatch.side).toBe(true);
  });

  it("extracts right side", () => {
    const r = extractUpperLimb(utt("right elbow flexion 120 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]?.value).toBe("right");
  });

  it("does not extract side from bilateral", () => {
    const r = extractUpperLimb(utt("bilateral shoulder 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]).toBeUndefined();
    expect(r.warnings.some((w) => /bilateral/i.test(w))).toBe(true);
  });
});

// ── ROM extraction ────────────────────────────────────────────────────────────

describe("ROM extraction", () => {
  it("extracts direction+angle pair for shoulder flexion", () => {
    const r = extractUpperLimb(utt("left shoulder flexion 90 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["shoulder"]?.measurements?.["flexion"]).toBe(90);
  });

  it("extracts multiple direction+angle pairs for same joint", () => {
    const r = extractUpperLimb(utt("left shoulder flexion 90 degrees abduction 60 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["shoulder"]?.measurements?.["flexion"]).toBe(90);
    expect(joints?.["shoulder"]?.measurements?.["abduction"]).toBe(60);
  });

  it("creates pending observation for bare angle with known joint", () => {
    const r = extractUpperLimb(utt("left shoulder 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["rom_joints"]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("rom_measurement");
    expect(r.pendingObservationsToAdd[0].missingFields).toContain("direction");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Flexion");
  });

  it("creates pending observation for bare angle with no joint", () => {
    const r = extractUpperLimb(utt("90 degrees"), emptySystemState());
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].missingFields).toContain("joint");
  });

  it("marks joint as ankylosed when ankylosis keyword present", () => {
    const r = extractUpperLimb(utt("left shoulder ankylosed flexion 0 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { isAnkylosed: boolean }>;
    expect(joints?.["shoulder"]?.isAnkylosed).toBe(true);
  });

  it("extracts elbow flexion", () => {
    const r = extractUpperLimb(utt("right elbow flexion 120 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["elbow"]?.measurements?.["flexion"]).toBe(120);
  });

  it("extracts wrist extension", () => {
    const r = extractUpperLimb(utt("left wrist extension 30 degrees"), emptySystemState());
    const joints = r.extractedFactsPatch["rom_joints"]?.value as Record<string, { measurements: Record<string, number> }>;
    expect(joints?.["wrist"]?.measurements?.["extension"]).toBe(30);
  });
});

// ── Nerve extraction ─────────────────────────────────────────────────────────

describe("nerve extraction", () => {
  it("extracts complete nerve finding (nerve + deficit type + loss type)", () => {
    const r = extractUpperLimb(utt("median nerve combined partial deficit"), emptySystemState());
    const nerves = r.extractedFactsPatch["nerve_selections"]?.value as { nerveKey: string; deficitType: string; lossType: string }[];
    expect(nerves).toHaveLength(1);
    expect(nerves[0].nerveKey).toContain("median");
    expect(nerves[0].deficitType).toBe("combined");
    expect(nerves[0].lossType).toBe("partial");
  });

  it("creates pending observation for nerve without deficit type", () => {
    const r = extractUpperLimb(utt("median nerve injury"), emptySystemState());
    expect(r.extractedFactsPatch["nerve_selections"]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("nerve_deficit");
    expect(r.pendingObservationsToAdd[0].missingFields).toContain("deficitType");
  });

  it("sets nerve_selections to empty array when nerve explicitly negated", () => {
    const r = extractUpperLimb(utt("no nerve deficit"), emptySystemState());
    const nerves = r.extractedFactsPatch["nerve_selections"]?.value as unknown[];
    expect(nerves).toHaveLength(0);
    expect(r.slotSignalsPatch.nerve_present).toBe(false);
  });
});

// ── ROM-from-nerve gate ───────────────────────────────────────────────────────

describe("rom_from_nerve gate", () => {
  it("sets rom_from_nerve true when 'due to nerve'", () => {
    const r = extractUpperLimb(utt("the ROM restriction is due to nerve lesion"), emptySystemState());
    expect(r.extractedFactsPatch["rom_from_nerve"]?.value).toBe(true);
  });

  it("sets rom_from_nerve false when 'independent'", () => {
    const r = extractUpperLimb(utt("independent ROM restriction"), emptySystemState());
    expect(r.extractedFactsPatch["rom_from_nerve"]?.value).toBe(false);
  });
});

// ── Amputation extraction ─────────────────────────────────────────────────────

describe("amputation extraction", () => {
  it("extracts above-elbow amputation", () => {
    const r = extractUpperLimb(utt("above elbow amputation right arm"), emptySystemState());
    expect(r.extractedFactsPatch["arm_amputation"]?.value).toBe("above_elbow");
  });

  it("extracts below-elbow amputation", () => {
    const r = extractUpperLimb(utt("below elbow amputation"), emptySystemState());
    expect(r.extractedFactsPatch["arm_amputation"]?.value).toBe("below_elbow");
  });

  it("sets arm_amputation to 'none' when negated", () => {
    const r = extractUpperLimb(utt("no amputation"), emptySystemState());
    expect(r.extractedFactsPatch["arm_amputation"]?.value).toBe("none");
  });
});

// ── "No other findings" ───────────────────────────────────────────────────────

describe("no other findings", () => {
  it("zero-fills nerve, amputation, and DBE when 'no other findings'", () => {
    const r = extractUpperLimb(utt("no other findings"), emptySystemState());
    expect((r.extractedFactsPatch["nerve_selections"]?.value as unknown[]).length).toBe(0);
    expect(r.extractedFactsPatch["arm_amputation"]?.value).toBe("none");
    expect((r.extractedFactsPatch["dbe_selections"]?.value as unknown[]).length).toBe(0);
  });
});

// ── Extraction method provenance ──────────────────────────────────────────────

describe("extraction provenance", () => {
  it("marks facts extracted by regex", () => {
    const r = extractUpperLimb(utt("left shoulder flexion 90 degrees"), emptySystemState());
    expect(r.extractedFactsPatch["side"]?.extractionMethod).toBe("regex");
    expect(r.extractedFactsPatch["rom_joints"]?.extractionMethod).toBe("regex");
  });
});
