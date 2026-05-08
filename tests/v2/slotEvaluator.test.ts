import { describe, expect, it } from "vitest";
import { extractSignals, mergeSignals, getMissingSlots } from "../../src/v2/slotEvaluator.js";
import type { NormalizedUtterance } from "../../src/v2/contracts.js";

function utterance(text: string): NormalizedUtterance {
  return {
    raw: text,
    normalizedText: text,
    tokens: text.split(/\s+/),
    mappedTokens: [],
    unresolvedTerms: [],
    confidence: 0.9,
  };
}

// ---------------------------------------------------------------------------
// extractSignals
// ---------------------------------------------------------------------------

describe("extractSignals", () => {
  it("detects ROM presence from degree values", () => {
    const s = extractSignals(utterance("shoulder flexion 90°"));
    expect(s.rom_present).toBe(true);
  });

  it("detects side from left keyword", () => {
    const s = extractSignals(utterance("left shoulder flexion 90°"));
    expect(s.side).toBe(true);
  });

  it("detects joint from shoulder keyword", () => {
    const s = extractSignals(utterance("shoulder abduction 60°"));
    expect(s.rom_joint).toBe(true);
  });

  it("detects rom_measurements from degree value", () => {
    const s = extractSignals(utterance("flexion 45°"));
    expect(s.rom_measurements).toBe(true);
  });

  it("satisfies ankylosis_flag for non-zero degree (implies restricted motion)", () => {
    const s = extractSignals(utterance("elbow flexion 30°"));
    expect(s.ankylosis_flag).toBe(true);
  });

  it("does NOT satisfy ankylosis_flag for a 0° value with no fixity keyword", () => {
    const s = extractSignals(utterance("elbow 0 degrees"));
    // HAS_NON_ZERO_DEGREE requires leading [1-9]; 0 should not match
    expect(s.ankylosis_flag).toBeFalsy();
  });

  it("satisfies ankylosis_flag for 'fixed at' keyword (joint is clearly ankylosed)", () => {
    const s = extractSignals(utterance("elbow fixed at 0°"));
    expect(s.ankylosis_flag).toBe(true);
  });

  it("detects explicit ankylosis keyword", () => {
    const s = extractSignals(utterance("elbow ankylosed"));
    expect(s.ankylosis_flag).toBe(true);
  });

  it("detects nerve presence from nerve name", () => {
    const s = extractSignals(utterance("median nerve injury"));
    expect(s.nerve_present).toBe(true);
  });

  it("detects nerve_details only when nerve + deficit type both present", () => {
    const withDeficit = extractSignals(utterance("median nerve sensory partial loss"));
    expect(withDeficit.nerve_details).toBe(true);

    const withoutDeficit = extractSignals(utterance("median nerve injury"));
    expect(withoutDeficit.nerve_details).toBeFalsy();
  });

  it("detects amputation presence", () => {
    const s = extractSignals(utterance("below knee amputation"));
    expect(s.amputation_present).toBe(true);
  });

  it("detects spine region", () => {
    const s = extractSignals(utterance("L4/L5 disc herniation lumbar"));
    expect(s.region).toBe(true);
  });

  it("detects spinal cord neurological signal", () => {
    const s = extractSignals(utterance("cauda equina syndrome"));
    expect(s.spine_neuro_present).toBe(true);
  });

  it("detects shortening in centimetres", () => {
    const s = extractSignals(utterance("leg length discrepancy 2 cm"));
    expect(s.shortening_present).toBe(true);
    expect(s.shortening_cm).toBe(true);
  });

  it("detects hearing path from NID keyword", () => {
    const s = extractSignals(utterance("noise-induced deafness left ear AHL 45 dB"));
    expect(s.path).toBe(true);
    expect(s.leftEarAhl).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mergeSignals — monotonic accumulation
// ---------------------------------------------------------------------------

describe("mergeSignals", () => {
  it("carries forward signals from previous turns", () => {
    const turn1 = extractSignals(utterance("left shoulder"));
    const turn2 = extractSignals(utterance("flexion 90°"));
    const merged = mergeSignals(turn1, turn2);
    expect(merged.side).toBe(true);
    expect(merged.rom_present).toBe(true);
    expect(merged.rom_measurements).toBe(true);
  });

  it("never clears a signal once set", () => {
    const existing = { side: true as const };
    const incoming = {}; // no new signals
    const merged = mergeSignals(existing, incoming);
    expect(merged.side).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMissingSlots — upper limb
// ---------------------------------------------------------------------------

describe("getMissingSlots — upper_limb", () => {
  it("asks for side first when nothing is known", () => {
    const missing = getMissingSlots("upper_limb", {});
    expect(missing[0]?.key).toBe("side");
  });

  it("asks for finding_type when side is known but no finding detected", () => {
    const missing = getMissingSlots("upper_limb", { side: true });
    expect(missing[0]?.key).toBe("finding_type");
  });

  it("asks for rom_joint when ROM is present but no joint named", () => {
    const missing = getMissingSlots("upper_limb", { side: true, finding_type: true, rom_present: true });
    expect(missing[0]?.key).toBe("rom_joint");
  });

  it("asks for rom_measurements when joint is known but no angle given", () => {
    const missing = getMissingSlots("upper_limb", {
      side: true, finding_type: true, rom_present: true, rom_joint: true,
    });
    expect(missing[0]?.key).toBe("rom_measurements");
  });

  it("asks for ankylosis_flag when ROM present but not clarified", () => {
    const missing = getMissingSlots("upper_limb", {
      side: true, finding_type: true, rom_present: true, rom_joint: true, rom_measurements: true,
    });
    expect(missing[0]?.key).toBe("ankylosis_flag");
  });

  it("has no missing slots when all basic ROM slots are satisfied", () => {
    const missing = getMissingSlots("upper_limb", {
      side: true,
      finding_type: true,
      rom_present: true,
      rom_joint: true,
      rom_measurements: true,
      ankylosis_flag: true,
    });
    expect(missing).toHaveLength(0);
  });

  it("asks for nerve_details when nerve detected but type/loss not specified", () => {
    const missing = getMissingSlots("upper_limb", {
      side: true,
      finding_type: true,
      nerve_present: true,
    });
    expect(missing.some((m) => m.key === "nerve_details")).toBe(true);
  });

  it("asks rom_from_nerve when both ROM and nerve present", () => {
    const missing = getMissingSlots("upper_limb", {
      side: true,
      finding_type: true,
      rom_present: true,
      rom_joint: true,
      rom_measurements: true,
      ankylosis_flag: true,
      nerve_present: true,
      nerve_details: true,
    });
    expect(missing[0]?.key).toBe("rom_from_nerve");
  });

  it("returns chips for each missing slot", () => {
    const missing = getMissingSlots("upper_limb", {});
    expect(missing[0]?.chips.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getMissingSlots — spine
// ---------------------------------------------------------------------------

describe("getMissingSlots — spine", () => {
  it("asks for region first", () => {
    const missing = getMissingSlots("spine", {});
    expect(missing[0]?.key).toBe("region");
  });

  it("asks for diagnosis_category after region is known", () => {
    const missing = getMissingSlots("spine", { region: true });
    expect(missing[0]?.key).toBe("diagnosis_category");
  });

  it("asks for severity_key after diagnosis_category is known", () => {
    const missing = getMissingSlots("spine", { region: true, diagnosis_category: true });
    expect(missing[0]?.key).toBe("severity_key");
  });

  it("asks for fracture_height_loss when fracture is present", () => {
    const missing = getMissingSlots("spine", {
      region: true, diagnosis_category: true, severity_key: true, fracture_present: true,
    });
    expect(missing[0]?.key).toBe("fracture_height_loss");
  });

  it("asks for bladder_bowel when spinal neuro present", () => {
    const missing = getMissingSlots("spine", {
      region: true, diagnosis_category: true, severity_key: true, spine_neuro_present: true,
    });
    expect(missing.some((m) => m.key === "bladder_bowel")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMissingSlots — lower limb
// ---------------------------------------------------------------------------

describe("getMissingSlots — lower_limb", () => {
  it("asks for side first", () => {
    const missing = getMissingSlots("lower_limb", {});
    expect(missing[0]?.key).toBe("side");
  });

  it("asks for shortening_cm when shortening is present without measurement", () => {
    const missing = getMissingSlots("lower_limb", {
      side: true, finding_type: true, shortening_present: true,
    });
    expect(missing.some((m) => m.key === "shortening_cm")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMissingSlots — full workflow simulation
// ---------------------------------------------------------------------------

describe("full upper limb ROM workflow via signal accumulation", () => {
  it("resolves all slots across multiple turns", () => {
    // Turn 1: "Left shoulder flexion 90°"
    let signals = extractSignals(utterance("Left shoulder flexion 90°"));
    // Has: side, rom_present, rom_joint, rom_measurements, ankylosis_flag (non-zero)
    // finding_type is satisfied because rom detected
    expect(getMissingSlots("upper_limb", signals)).toHaveLength(0);
  });

  it("asks for finding_type when only side is known after turn 1", () => {
    const t1 = extractSignals(utterance("left shoulder"));
    const missing = getMissingSlots("upper_limb", t1);
    // side ✓, rom_joint ✓ but finding_type still missing (no ROM/nerve/amp/dbe)
    expect(missing[0]?.key).toBe("finding_type");
  });

  it("progresses through slots across turns correctly", () => {
    // Turn 1: side only
    const t1 = extractSignals(utterance("left wrist"));
    let accumulated = t1;
    let missing = getMissingSlots("upper_limb", accumulated);
    expect(missing[0]?.key).toBe("finding_type");

    // Turn 2: finding type — ROM restriction (mention ROM keyword)
    const t2 = extractSignals(utterance("ROM restriction flexion 40°"));
    accumulated = mergeSignals(accumulated, t2);
    missing = getMissingSlots("upper_limb", accumulated);
    // side ✓, finding_type ✓ (rom detected), rom_joint ✓ (wrist from t1),
    // rom_measurements ✓ (40°), ankylosis_flag ✓ (non-zero)
    expect(missing).toHaveLength(0);
  });
});
