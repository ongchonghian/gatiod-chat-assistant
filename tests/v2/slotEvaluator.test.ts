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

// ---------------------------------------------------------------------------
// Policy fixes — §1 CNS Section B, §2 Visual diplopia, §3 Gastro, §4 Renal
// ---------------------------------------------------------------------------

describe("§1 — CNS Section B component signal (correct components)", () => {
  it("detects olfaction", () => {
    expect(extractSignals(utterance("olfactory impairment")).section_b_component).toBe(true);
  });
  it("detects facial nerve", () => {
    expect(extractSignals(utterance("facial nerve palsy")).section_b_component).toBe(true);
  });
  it("detects equilibrium", () => {
    expect(extractSignals(utterance("equilibrium dysfunction")).section_b_component).toBe(true);
  });
  it("detects swallowing", () => {
    expect(extractSignals(utterance("difficulty swallowing")).section_b_component).toBe(true);
  });
  it("detects station/gait", () => {
    expect(extractSignals(utterance("gait disturbance")).section_b_component).toBe(true);
  });
  it("detects respiration / breathing", () => {
    expect(extractSignals(utterance("neurological breathing impairment")).section_b_component).toBe(true);
  });
  it("does NOT fire on old spine-only terms (bladder, bowel, spasms)", () => {
    expect(extractSignals(utterance("bladder dysfunction")).section_b_component).toBeFalsy();
    expect(extractSignals(utterance("bowel incontinence")).section_b_component).toBeFalsy();
    expect(extractSignals(utterance("spasms present")).section_b_component).toBeFalsy();
  });
  it("slot policy chips are the correct CNS components", () => {
    // evaluateCondition "section_b_present AND component_missing" checks s.cns_section
    const missing = getMissingSlots("cns", { cns_section: true, section_b_component: false });
    const componentSlot = missing.find((m) => m.key === "section_b_component");
    expect(componentSlot?.chips).toContain("Olfaction");
    expect(componentSlot?.chips).toContain("Facial nerve");
    expect(componentSlot?.chips).toContain("Equilibrium");
    expect(componentSlot?.chips).toContain("Swallowing");
    expect(componentSlot?.chips).toContain("Station/gait");
    expect(componentSlot?.chips).toContain("Respiration");
    expect(componentSlot?.chips).not.toContain("Bladder");
    expect(componentSlot?.chips).not.toContain("Bowel");
  });
});

describe("§2 — Visual diplopia zone signal (zone-based, not monocular/binocular)", () => {
  it("detects diplopia keyword", () => {
    expect(extractSignals(utterance("diplopia present")).diplopiaId).toBe(true);
  });
  it("detects uncorrectable", () => {
    expect(extractSignals(utterance("uncorrectable diplopia")).diplopiaId).toBe(true);
  });
  it("detects central 30 zone", () => {
    expect(extractSignals(utterance("central 30 degrees")).diplopiaId).toBe(true);
  });
  it("detects 30 to 60 zone", () => {
    expect(extractSignals(utterance("30 to 60 degrees")).diplopiaId).toBe(true);
  });
  it("detects beyond 60 zone", () => {
    expect(extractSignals(utterance("beyond 60 degrees")).diplopiaId).toBe(true);
  });
  it("does NOT fire on old monocular/binocular terms alone", () => {
    expect(extractSignals(utterance("monocular vision issue")).diplopiaId).toBeFalsy();
    expect(extractSignals(utterance("binocular coordination")).diplopiaId).toBeFalsy();
  });
  it("slot policy chips are zone-based not monocular/binocular", () => {
    const missing = getMissingSlots("visual", { leftEye: true, rightEye: true });
    const dipSlot = missing.find((m) => m.key === "diplopiaId");
    expect(dipSlot?.chips).toContain("No diplopia");
    expect(dipSlot?.chips).toContain("Uncorrectable");
    expect(dipSlot?.chips).toContain("Central 30°");
    expect(dipSlot?.chips).toContain("30–60°");
    expect(dipSlot?.chips).toContain("Beyond 60°");
    expect(dipSlot?.chips).not.toContain("Monocular");
    expect(dipSlot?.chips).not.toContain("Binocular");
  });
});

describe("§3 — Gastro-digestive subSystem signal (all 4 subsystems)", () => {
  it("detects upper GI (oesophagus)", () => {
    expect(extractSignals(utterance("oesophageal disease")).subSystem).toBe(true);
  });
  it("detects upper GI (stomach)", () => {
    expect(extractSignals(utterance("stomach ulcer")).subSystem).toBe(true);
  });
  it("detects upper GI (duodenal)", () => {
    expect(extractSignals(utterance("duodenal injury")).subSystem).toBe(true);
  });
  it("detects herniation", () => {
    expect(extractSignals(utterance("inguinal hernia")).subSystem).toBe(true);
  });
  it("still detects existing colon/liver terms", () => {
    expect(extractSignals(utterance("colonic disease")).subSystem).toBe(true);
    expect(extractSignals(utterance("liver disease")).subSystem).toBe(true);
  });
  it("slot policy chips include all 4 subsystems", () => {
    const missing = getMissingSlots("gastro_digestive", {});
    const subSlot = missing.find((m) => m.key === "subSystem");
    expect(subSlot?.chips).toContain("Upper GI");
    expect(subSlot?.chips).toContain("Colon/rectum/anus");
    expect(subSlot?.chips).toContain("Liver/biliary");
    expect(subSlot?.chips).toContain("Hernia");
    expect(subSlot?.chips).not.toContain("Colonic/rectal/anal");
  });
});

describe("§4 — Renal inputs signal (no eGFR, creatinine clearance instead)", () => {
  it("detects serum creatinine", () => {
    expect(extractSignals(utterance("serum creatinine 120 µmol")).renal_inputs).toBe(true);
  });
  it("detects creatinine clearance", () => {
    expect(extractSignals(utterance("creatinine clearance 45 ml/min")).renal_inputs).toBe(true);
  });
  it("detects CKD stage", () => {
    expect(extractSignals(utterance("CKD stage 3")).renal_inputs).toBe(true);
  });
  it("detects clinical severity", () => {
    expect(extractSignals(utterance("clinical severity incompletely controlled")).renal_inputs).toBe(true);
  });
  it("does NOT fire on eGFR alone (engine has no eGFR field)", () => {
    expect(extractSignals(utterance("eGFR 45")).renal_inputs).toBeFalsy();
    expect(extractSignals(utterance("GFR result")).renal_inputs).toBeFalsy();
  });
  it("slot policy question and chips reference creatinine clearance not eGFR", () => {
    const missing = getMissingSlots("renal", {});
    const renalSlot = missing.find((m) => m.key === "renal_inputs");
    expect(renalSlot?.question).not.toMatch(/eGFR/i);
    expect(renalSlot?.chips).toContain("Creatinine clearance");
    expect(renalSlot?.chips).not.toContain("Provide eGFR");
  });
});
