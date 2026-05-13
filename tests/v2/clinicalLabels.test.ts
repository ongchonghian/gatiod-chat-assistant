import { describe, expect, it } from "vitest";
import { factKeyLabel, factValueDisplay } from "../../src/v2/clinicalLabels.js";

// ── Scaffold: factKeyLabel fallback ──────────────────────────────────────────

describe("factKeyLabel — fallback", () => {
  it("returns a non-empty string for an unknown key", () => {
    const label = factKeyLabel("spine", "some_unknown_key");
    expect(label).toBeTruthy();
  });

  it("title-cases the fallback (no raw underscores)", () => {
    const label = factKeyLabel("spine", "spine_region");
    expect(label).not.toContain("_");
    expect(label[0]).toBe(label[0].toUpperCase());
  });

  it("does not throw for an unknown system", () => {
    expect(() => factKeyLabel("unknown_system" as never, "some_key")).not.toThrow();
  });
});

// ── Scaffold: factValueDisplay fallback ───────────────────────────────────────

describe("factValueDisplay — fallback (unregistered keys)", () => {
  it("returns '—' for null", () => {
    expect(factValueDisplay("spine", "unregistered_key", null)).toBe("—");
  });

  it("returns '—' for undefined", () => {
    expect(factValueDisplay("spine", "unregistered_key", undefined)).toBe("—");
  });

  it("returns '(complex value)' for a plain object", () => {
    expect(factValueDisplay("spine", "unregistered_key", { foo: "bar" })).toBe("(complex value)");
  });

  it("returns '(complex value)' for an array of non-entries", () => {
    expect(factValueDisplay("spine", "unregistered_key", [1, 2, 3])).toBe("(complex value)");
  });

  it("passes string values through as-is", () => {
    expect(factValueDisplay("spine", "unregistered_key", "some_value")).toBe("some_value");
  });

  it("converts number values to string", () => {
    expect(factValueDisplay("hearing", "unregistered_key", 65)).toBe("65");
  });
});

// ── Spine: registered key labels ──────────────────────────────────────────────

describe("factKeyLabel — spine registrations", () => {
  it("spine_region → 'Region'", () => {
    expect(factKeyLabel("spine", "spine_region")).toBe("Region");
  });

  it("spine_entries → 'Diagnosis entries'", () => {
    expect(factKeyLabel("spine", "spine_entries")).toBe("Diagnosis entries");
  });

  it("monoparesisHalving → 'Monoparesis halving'", () => {
    expect(factKeyLabel("spine", "monoparesisHalving")).toBe("Monoparesis halving");
  });

  it("bladderBowelSeverity → 'Bladder/bowel'", () => {
    expect(factKeyLabel("spine", "bladderBowelSeverity")).toBe("Bladder/bowel");
  });

  it("discCordInvolvement → 'Cord involvement'", () => {
    expect(factKeyLabel("spine", "discCordInvolvement")).toBe("Cord involvement");
  });

  it("spondylolysisPathway → 'Spondylolysis pathway'", () => {
    expect(factKeyLabel("spine", "spondylolysisPathway")).toBe("Spondylolysis pathway");
  });
});

// ── Spine: registered value formatters ───────────────────────────────────────

describe("factValueDisplay — spine registrations", () => {
  it("spine_region lumbo_sacral → 'Lumbo-Sacral'", () => {
    expect(factValueDisplay("spine", "spine_region", "lumbo_sacral")).toBe("Lumbo-Sacral");
  });

  it("spine_region cervical → 'Cervical'", () => {
    expect(factValueDisplay("spine", "spine_region", "cervical")).toBe("Cervical");
  });

  it("spine_region thoraco_lumbar → 'Thoraco-Lumbar'", () => {
    expect(factValueDisplay("spine", "spine_region", "thoraco_lumbar")).toBe("Thoraco-Lumbar");
  });

  it("spine_entries renders a disc entry as a clinical summary", () => {
    const entry = {
      diagnosisCategory: "intervertebral_disc",
      severityKey: "disc31_persistent_motor_or_motor_sensory",
      monoparesisHalving: false,
      bladderBowelSeverity: "none",
      discCordInvolvement: false,
      spondylolysisPathway: "acute_traumatic",
    };
    const result = factValueDisplay("spine", "spine_entries", [entry]);
    expect(result).not.toContain("{");
    expect(result).not.toContain("disc31_persistent");
    expect(result).toContain("Intervertebral Disc");
  });

  it("spine_entries with monoparesisHalving appends modifier", () => {
    const entry = {
      diagnosisCategory: "intervertebral_disc",
      severityKey: "disc31_persistent_motor_or_motor_sensory",
      monoparesisHalving: true,
      bladderBowelSeverity: "none",
      discCordInvolvement: false,
      spondylolysisPathway: "acute_traumatic",
    };
    const result = factValueDisplay("spine", "spine_entries", [entry]);
    expect(result).toContain("monoparesis halving");
  });

  it("bladderBowelSeverity incomplete_both → clinical label", () => {
    const result = factValueDisplay("spine", "bladderBowelSeverity", "incomplete_both");
    expect(result).toBe("Incomplete (bladder and bowel)");
  });
});

// ── Upper limb: registered key labels ────────────────────────────────────────

describe("factKeyLabel — upper_limb registrations", () => {
  it("side → 'Side'", () => {
    expect(factKeyLabel("upper_limb", "side")).toBe("Side");
  });

  it("rom_joints → 'Range of motion'", () => {
    expect(factKeyLabel("upper_limb", "rom_joints")).toBe("Range of motion");
  });

  it("rom_from_nerve → 'ROM from nerve'", () => {
    expect(factKeyLabel("upper_limb", "rom_from_nerve")).toBe("ROM from nerve");
  });

  it("nerve_selections → 'Nerve injuries'", () => {
    expect(factKeyLabel("upper_limb", "nerve_selections")).toBe("Nerve injuries");
  });

  it("arm_amputation → 'Arm amputation'", () => {
    expect(factKeyLabel("upper_limb", "arm_amputation")).toBe("Arm amputation");
  });

  it("finger_amputations → 'Finger amputations'", () => {
    expect(factKeyLabel("upper_limb", "finger_amputations")).toBe("Finger amputations");
  });

  it("dbe_selections → 'DBE'", () => {
    expect(factKeyLabel("upper_limb", "dbe_selections")).toBe("DBE");
  });
});

// ── Upper limb: ROM joints formatter ─────────────────────────────────────────

describe("factValueDisplay — upper_limb rom_joints", () => {
  it("single joint with measurements formats directions and degrees", () => {
    const result = factValueDisplay("upper_limb", "rom_joints", {
      shoulder: { isAnkylosed: false, measurements: { flexion: 90, extension: 30 } },
    });
    expect(result).toContain("shoulder");
    expect(result).toContain("flexion 90°");
    expect(result).toContain("extension 30°");
    expect(result).not.toContain("{");
  });

  it("ankylosed joint renders 'ankylosed'", () => {
    const result = factValueDisplay("upper_limb", "rom_joints", {
      elbow: { isAnkylosed: true, measurements: {} },
    });
    expect(result).toContain("elbow: ankylosed");
  });

  it("multiple joints separated by semicolons", () => {
    const result = factValueDisplay("upper_limb", "rom_joints", {
      shoulder: { isAnkylosed: false, measurements: { flexion: 60 } },
      elbow: { isAnkylosed: false, measurements: { flexion: 120 } },
    });
    expect(result).toContain("shoulder");
    expect(result).toContain("elbow");
    expect(result).toContain(";");
  });

  it("empty object returns '(no joints recorded)'", () => {
    expect(factValueDisplay("upper_limb", "rom_joints", {})).toBe("(no joints recorded)");
  });

  it("null returns '—'", () => {
    expect(factValueDisplay("upper_limb", "rom_joints", null)).toBe("—");
  });
});

// ── Lower limb: registered key labels ────────────────────────────────────────

describe("factKeyLabel — lower_limb registrations", () => {
  it("side → 'Side'", () => {
    expect(factKeyLabel("lower_limb", "side")).toBe("Side");
  });

  it("bilateral_mode → 'Bilateral mode'", () => {
    expect(factKeyLabel("lower_limb", "bilateral_mode")).toBe("Bilateral mode");
  });

  it("rom_joints → 'Range of motion'", () => {
    expect(factKeyLabel("lower_limb", "rom_joints")).toBe("Range of motion");
  });

  it("shortening_cm → 'Shortening'", () => {
    expect(factKeyLabel("lower_limb", "shortening_cm")).toBe("Shortening");
  });

  it("leg_amputation → 'Leg amputation'", () => {
    expect(factKeyLabel("lower_limb", "leg_amputation")).toBe("Leg amputation");
  });

  it("toe_amputations → 'Toe amputations'", () => {
    expect(factKeyLabel("lower_limb", "toe_amputations")).toBe("Toe amputations");
  });
});

// ── Lower limb: shortening_cm formatter ──────────────────────────────────────

describe("factValueDisplay — lower_limb shortening_cm", () => {
  it("number formats as 'X cm'", () => {
    expect(factValueDisplay("lower_limb", "shortening_cm", 3.5)).toBe("3.5 cm");
  });

  it("zero formats as '0 cm'", () => {
    expect(factValueDisplay("lower_limb", "shortening_cm", 0)).toBe("0 cm");
  });
});

// ── Hearing: registered key labels ───────────────────────────────────────────

describe("factKeyLabel — hearing registrations", () => {
  it("hearing_path → 'Assessment pathway'", () => {
    expect(factKeyLabel("hearing", "hearing_path")).toBe("Assessment pathway");
  });

  it("hearing_left_ear_ahl → 'Left ear AHL'", () => {
    expect(factKeyLabel("hearing", "hearing_left_ear_ahl")).toBe("Left ear AHL");
  });

  it("hearing_right_ear_ahl → 'Right ear AHL'", () => {
    expect(factKeyLabel("hearing", "hearing_right_ear_ahl")).toBe("Right ear AHL");
  });

  it("hearing_age → 'Patient age'", () => {
    expect(factKeyLabel("hearing", "hearing_age")).toBe("Patient age");
  });

  it("hearing_affected_ears → 'Affected ears'", () => {
    expect(factKeyLabel("hearing", "hearing_affected_ears")).toBe("Affected ears");
  });
});

// ── Respiratory: registered key labels ───────────────────────────────────────

describe("factKeyLabel — respiratory registrations", () => {
  it("resp_diagnosis → 'Diagnosis type'", () => {
    expect(factKeyLabel("respiratory", "resp_diagnosis")).toBe("Diagnosis type");
  });

  it("resp_fvc → 'FVC (% predicted)'", () => {
    expect(factKeyLabel("respiratory", "resp_fvc")).toBe("FVC (% predicted)");
  });

  it("resp_fev1 → 'FEV1 (% predicted)'", () => {
    expect(factKeyLabel("respiratory", "resp_fev1")).toBe("FEV1 (% predicted)");
  });

  it("resp_dyspnoea → 'Dyspnoea'", () => {
    expect(factKeyLabel("respiratory", "resp_dyspnoea")).toBe("Dyspnoea");
  });

  it("resp_asthma_medication → 'Maintenance medication'", () => {
    expect(factKeyLabel("respiratory", "resp_asthma_medication")).toBe("Maintenance medication");
  });
});

// ── Respiratory: value formatters ────────────────────────────────────────────

describe("factValueDisplay — respiratory registrations", () => {
  it("resp_diagnosis standard → clinical label", () => {
    const result = factValueDisplay("respiratory", "resp_diagnosis", "standard");
    expect(result).toContain("Standard");
    expect(result).not.toContain("standard");
  });

  it("resp_diagnosis occupational_asthma → clinical label", () => {
    expect(factValueDisplay("respiratory", "resp_diagnosis", "occupational_asthma")).toBe("Occupational Asthma");
  });
});

// ── Renal: registered key labels ─────────────────────────────────────────────

describe("factKeyLabel — renal registrations", () => {
  it("renal_sex → 'Patient sex'", () => {
    expect(factKeyLabel("renal", "renal_sex")).toBe("Patient sex");
  });

  it("renal_ckd_stage → 'CKD stage'", () => {
    expect(factKeyLabel("renal", "renal_ckd_stage")).toBe("CKD stage");
  });

  it("renal_clinical_severity → 'Clinical severity'", () => {
    expect(factKeyLabel("renal", "renal_clinical_severity")).toBe("Clinical severity");
  });

  it("renal_solitary_kidney → 'Solitary kidney'", () => {
    expect(factKeyLabel("renal", "renal_solitary_kidney")).toBe("Solitary kidney");
  });
});

// ── Renal: value formatters ───────────────────────────────────────────────────

describe("factValueDisplay — renal registrations", () => {
  it("renal_sex male → 'Male'", () => {
    expect(factValueDisplay("renal", "renal_sex", "male")).toBe("Male");
  });

  it("renal_ckd_stage 3 → clinical label containing 'Stage 3'", () => {
    const result = factValueDisplay("renal", "renal_ckd_stage", 3);
    expect(result).toContain("Stage 3");
  });

  it("renal_clinical_severity persisting → clinical label", () => {
    const result = factValueDisplay("renal", "renal_clinical_severity", "persisting");
    expect(result).toContain("Persisting");
    expect(result).not.toContain("persisting");
  });
});

// ── Gastro: registered key labels ────────────────────────────────────────────

describe("factKeyLabel — gastro_digestive registrations", () => {
  it("gastro_subsystem → 'Subsystem'", () => {
    expect(factKeyLabel("gastro_digestive", "gastro_subsystem")).toBe("Subsystem");
  });

  it("gastro_bracket_index → 'Severity bracket'", () => {
    expect(factKeyLabel("gastro_digestive", "gastro_bracket_index")).toBe("Severity bracket");
  });

  it("gastro_pi_percent → 'PI%'", () => {
    expect(factKeyLabel("gastro_digestive", "gastro_pi_percent")).toBe("PI%");
  });
});

// ── Gastro: value formatters ──────────────────────────────────────────────────

describe("factValueDisplay — gastro_digestive registrations", () => {
  it("gastro_subsystem upperGI → clinical label", () => {
    const result = factValueDisplay("gastro_digestive", "gastro_subsystem", "upperGI");
    expect(result).not.toBe("upperGI");
    expect(result.length).toBeGreaterThan(0);
  });

  it("gastro_subsystem colonicRectalAnal → clinical label", () => {
    const result = factValueDisplay("gastro_digestive", "gastro_subsystem", "colonicRectalAnal");
    expect(result).not.toBe("colonicRectalAnal");
  });
});

// ── CNS placeholder ───────────────────────────────────────────────────────────

describe("factKeyLabel — cns placeholder", () => {
  it("does not throw for cns system", () => {
    expect(() => factKeyLabel("cns", "cns_g1a_bracketId")).not.toThrow();
  });

  it("falls back gracefully for unknown CNS key", () => {
    const label = factKeyLabel("cns", "cns_g1a_bracketId");
    expect(label).toBeTruthy();
    expect(label).not.toContain("_");
  });
});

// ── Visual placeholder ────────────────────────────────────────────────────────

describe("factKeyLabel — visual placeholder", () => {
  it("does not throw for visual system", () => {
    expect(() => factKeyLabel("visual", "visual_diplopia_id")).not.toThrow();
  });

  it("falls back gracefully for unknown visual key", () => {
    const label = factKeyLabel("visual", "visual_diplopia_id");
    expect(label).toBeTruthy();
  });
});
