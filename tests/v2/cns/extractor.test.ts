import { describe, expect, it } from "vitest";
import { extractCns } from "../../../src/v2/extractors/cns.js";
import {
  CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
  CNS_FK_G2, CNS_FK_G2_NEURO,
  CNS_FK_G3,
  CNS_FK_G4, CNS_FK_G4_PSYCH,
  CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL,
  CNS_FK_B_EQUILIBRIUM, CNS_FK_B_EQUILIBRIUM_ENT,
  CNS_FK_B_SWALLOWING, CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  CNS_FK_C_LIMBS,
} from "../../../src/v2/extractors/cns.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { NormalizedUtterance, V2SystemState } from "../../../src/v2/contracts.js";

function utt(text: string): NormalizedUtterance {
  return { raw: text, normalizedText: text.toLowerCase(), tokens: text.split(/\s+/), mappedTokens: [], unresolvedTerms: [], confidence: 0.9 };
}

function emptyState(): V2SystemState {
  return defaultV2SessionState().systems.cns;
}

// ── Section A — Group 1B (Episodic / Epilepsy) ────────────────────────────────

describe("Section A Group 1B — epilepsy bracket", () => {
  it("auto-selects e_uncontrolled for uncontrolled seizures", () => {
    const r = extractCns(utt("uncontrolled epilepsy constant seizures"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G1B]?.value).toBe("e_uncontrolled");
    expect(r.slotSignalsPatch.cns_section).toBe(true);
  });

  it("auto-selects e_severe_supervised for supervised restriction", () => {
    const r = extractCns(utt("epilepsy with severe frequency requiring supervised activities"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G1B]?.value).toBe("e_severe_supervised");
  });

  it("auto-selects e_interferes when some daily activities affected", () => {
    const r = extractCns(utt("seizures that interfere with some daily activities"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G1B]?.value).toBe("e_interferes");
  });

  it("creates pending observation when bracket is ambiguous", () => {
    const r = extractCns(utt("epilepsy"), emptyState());
    expect(r.pendingObservationsToAdd.length).toBeGreaterThan(0);
    expect(r.pendingObservationsToAdd[0].missingFields).toContain(CNS_FK_G1B);
    expect(r.pendingObservationsToAdd[0].candidateAnswers?.length).toBeGreaterThan(0);
  });
});

// ── Section A — Group 1A (Consciousness) ─────────────────────────────────────

describe("Section A Group 1A — consciousness bracket", () => {
  it("creates pending observation for consciousness impairment", () => {
    const r = extractCns(utt("altered consciousness"), emptyState());
    expect(r.pendingObservationsToAdd.length).toBeGreaterThan(0);
    expect(r.pendingObservationsToAdd[0].missingFields).toContain(CNS_FK_G1A);
  });

  it("triggers on coma", () => {
    const r = extractCns(utt("patient in coma"), emptyState());
    expect(r.pendingObservationsToAdd[0]?.missingFields).toContain(CNS_FK_G1A);
  });
});

// ── Section A — Group 2 (Cognition) with neuropsychologist gate ───────────────

describe("Section A Group 2 — cognitive bracket + neuro gate", () => {
  it("auto-selects ms_severe for severe cognitive impairment", () => {
    const r = extractCns(utt("severe cognitive impairment with significant dependence"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G2]?.value).toBe("ms_severe");
  });

  it("auto-selects ms_slight for slight forgetfulness", () => {
    const r = extractCns(utt("cognitive impairment slight forgetfulness fully self-caring"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G2]?.value).toBe("ms_slight");
  });

  it("creates neuro confirmation pending after bracket is set (if not yet confirmed)", () => {
    const r = extractCns(utt("moderate memory impairment affecting everyday activities"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G2]?.value).toBe("ms_moderate");
    // Neuro confirmation pending should appear in same pass
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_G2_NEURO))).toBe(true);
  });

  it("extracts neuro confirmation from text", () => {
    const state = { ...emptyState(), extractedFacts: { [CNS_FK_G2]: { value: "ms_moderate", sourceText: "test", confidence: 0.9, extractionMethod: "regex" as const, createdAt: "", updatedAt: "" } } };
    const r = extractCns(utt("neuropsychologist confirmed the cognitive impairment"), state);
    expect(r.extractedFactsPatch[CNS_FK_G2_NEURO]?.value).toBe(true);
  });
});

// ── Section A — Group 3 (Dysphasia) ──────────────────────────────────────────

describe("Section A Group 3 — dysphasia bracket", () => {
  it("auto-selects co_severe_or_complete for complete inability to communicate", () => {
    const r = extractCns(utt("complete inability to communicate aphasia"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G3]?.value).toBe("co_severe_or_complete");
  });

  it("auto-selects co_moderate for moderate dysphasia", () => {
    const r = extractCns(utt("moderate dysphasia language impairment"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G3]?.value).toBe("co_moderate");
  });

  it("creates pending for ambiguous dysphasia", () => {
    const r = extractCns(utt("expressive aphasia"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_G3))).toBe(true);
  });
});

// ── Section A — Group 4 (Emotional) with psychiatrist gate ───────────────────

describe("Section A Group 4 — emotional bracket + psych gate", () => {
  it("auto-selects em_severe for severe impairment with major dependence", () => {
    const r = extractCns(utt("emotional impairment severe limitation major dependence"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G4]?.value).toBe("em_severe");
  });

  it("creates psych confirmation pending after bracket set", () => {
    const r = extractCns(utt("emotional impairment mild ADL limitation"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_G4]?.value).toBe("em_mild");
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_G4_PSYCH))).toBe(true);
  });

  it("captures psychiatrist confirmation", () => {
    const state = { ...emptyState(), extractedFacts: { [CNS_FK_G4]: { value: "em_moderate", sourceText: "test", confidence: 0.9, extractionMethod: "regex" as const, createdAt: "", updatedAt: "" } } };
    const r = extractCns(utt("psychiatrist confirmed the emotional behavioural impairment"), state);
    expect(r.extractedFactsPatch[CNS_FK_G4_PSYCH]?.value).toBe(true);
  });
});

// ── Section B — Olfaction (anosmia auto-select) ───────────────────────────────

describe("Section B olfaction", () => {
  it("auto-selects ol_anosmia for anosmia", () => {
    const r = extractCns(utt("anosmia loss of smell"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_OLFACTION]?.value).toBe("ol_anosmia");
    expect(r.slotSignalsPatch.section_b_component).toBe(true);
  });

  it("auto-selects ol_none for no smell loss", () => {
    const r = extractCns(utt("no smell loss normal olfaction"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_OLFACTION]?.value).toBe("ol_none");
  });
});

// ── Section B — Facial nerve ──────────────────────────────────────────────────

describe("Section B facial nerve", () => {
  it("auto-selects fn_mild_unilateral for taste loss", () => {
    const r = extractCns(utt("facial nerve palsy with taste loss mild unilateral"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_FACIAL]?.value).toBe("fn_mild_unilateral");
  });

  it("creates pending for ambiguous facial nerve", () => {
    const r = extractCns(utt("facial palsy bell's palsy"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_B_FACIAL))).toBe(true);
  });
});

// ── Section B — Equilibrium + ENT gate ───────────────────────────────────────

describe("Section B equilibrium + ENT gate", () => {
  it("auto-selects eq_minimal for hazardous surroundings only limitation", () => {
    const r = extractCns(utt("vestibular disorder limited only in hazardous surroundings"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_EQUILIBRIUM]?.value).toBe("eq_minimal");
  });

  it("creates ENT confirmation pending after bracket set", () => {
    const r = extractCns(utt("equilibrium impairment limited only in hazardous surroundings"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_EQUILIBRIUM]?.value).toBe("eq_minimal");
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_B_EQUILIBRIUM_ENT))).toBe(true);
  });
});

// ── Section B — Swallowing ────────────────────────────────────────────────────

describe("Section B swallowing", () => {
  it("auto-selects sw_mild for mild dysphagia", () => {
    const r = extractCns(utt("dysphagia mild choking on liquids"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_SWALLOWING]?.value).toBe("sw_mild");
  });

  it("auto-selects sw_severe for inability to swallow", () => {
    const r = extractCns(utt("swallowing difficulty cannot swallow requires suctioning"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_SWALLOWING]?.value).toBe("sw_severe");
  });
});

// ── Section B — Station and gait ─────────────────────────────────────────────

describe("Section B station and gait", () => {
  it("auto-selects sg_cannot_walk_or_stand for cannot walk without assistance", () => {
    const r = extractCns(utt("station and gait impairment cannot walk without assistance"), emptyState());
    expect(r.extractedFactsPatch[CNS_FK_B_STATION_GAIT]?.value).toBe("sg_cannot_walk_or_stand");
  });
});

// ── Section B — Respiration (CNS) ────────────────────────────────────────────

describe("Section B CNS respiration", () => {
  it("creates pending for neurological respiration", () => {
    const r = extractCns(utt("neurological respiration CNS respiration impairment"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_B_RESPIRATION))).toBe(true);
  });
});

// ── Section C — Paralysed limbs ───────────────────────────────────────────────

describe("Section C paralysed limbs", () => {
  it("detects tetraplegia as both upper and lower", () => {
    const r = extractCns(utt("tetraplegia"), emptyState());
    const limbs = r.extractedFactsPatch[CNS_FK_C_LIMBS]?.value as string[];
    expect(limbs).toContain("both_upper_limbs");
    expect(limbs).toContain("both_lower_limbs_or_feet");
  });

  it("detects paraplegia as both lower", () => {
    const r = extractCns(utt("paraplegia both lower limbs paralysed"), emptyState());
    const limbs = r.extractedFactsPatch[CNS_FK_C_LIMBS]?.value as string[];
    expect(limbs).toContain("both_lower_limbs_or_feet");
  });

  it("detects hemiplegia as ipsilateral upper and lower", () => {
    const r = extractCns(utt("hemiplegia"), emptyState());
    const limbs = r.extractedFactsPatch[CNS_FK_C_LIMBS]?.value as string[];
    expect(limbs).toContain("upper_limb_at_or_above_elbow");
    expect(limbs).toContain("lower_limb_at_or_above_knee");
  });

  it("creates pending for unspecified limb paralysis", () => {
    const r = extractCns(utt("paralysis of limbs"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => p.missingFields.includes(CNS_FK_C_LIMBS))).toBe(true);
  });

  it("signals paralysed_limbs for detected limbs", () => {
    const r = extractCns(utt("paraplegia"), emptyState());
    expect(r.slotSignalsPatch.paralysed_limbs).toBe(true);
  });
});

// ── Spine-complication guard ──────────────────────────────────────────────────

describe("SPINE_NEURO_RE guard", () => {
  it("blocks bladder/bowel from populating CNS Section B", () => {
    const r = extractCns(utt("bladder dysfunction and bowel impairment"), emptyState());
    expect(r.pendingObservationsToAdd[0]?.parsed).toMatchObject({ subtype: "cns_spine_complication_clarify" });
    // Should not set any CNS fact
    expect(Object.keys(r.extractedFactsPatch).length).toBe(0);
  });

  it("blocks spasms from CNS", () => {
    const r = extractCns(utt("lower limb spasms"), emptyState());
    expect(r.pendingObservationsToAdd[0]?.parsed).toMatchObject({ subtype: "cns_spine_complication_clarify" });
  });

  it("blocks pressure sores from CNS", () => {
    const r = extractCns(utt("pressure sore on sacrum"), emptyState());
    expect(r.pendingObservationsToAdd[0]?.parsed).toMatchObject({ subtype: "cns_spine_complication_clarify" });
  });
});

// ── No-op when no CNS context ─────────────────────────────────────────────────

describe("no-op for non-CNS utterances", () => {
  it("returns empty patch for unrelated input", () => {
    const r = extractCns(utt("right shoulder ROM 120 degrees"), emptyState());
    expect(Object.keys(r.extractedFactsPatch).length).toBe(0);
    expect(r.pendingObservationsToAdd.length).toBe(0);
  });
});
