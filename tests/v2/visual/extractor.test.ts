import { describe, expect, it } from "vitest";
import { extractVisual } from "../../../src/v2/extractors/visual.js";
import {
  VISUAL_FK_LEFT_ACUITY, VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD,  VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_LEFT_MODIFIERS, VISUAL_FK_RIGHT_MODIFIERS,
  VISUAL_FK_LEFT_CONDITIONS, VISUAL_FK_RIGHT_CONDITIONS,
  VISUAL_FK_DIPLOPIA,
  VISUAL_FK_LEFT_ENUCLEATED, VISUAL_FK_RIGHT_ENUCLEATED,
} from "../../../src/v2/extractors/visual.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { NormalizedUtterance, V2SystemState } from "../../../src/v2/contracts.js";

function utt(text: string): NormalizedUtterance {
  return { raw: text, normalizedText: text.toLowerCase(), tokens: text.split(/\s+/), mappedTokens: [], unresolvedTerms: [], confidence: 0.9 };
}

function emptyState(): V2SystemState {
  return defaultV2SessionState().systems.visual;
}

// ── Snellen acuity parsing ─────────────────────────────────────────────────────

describe("Snellen acuity parsing", () => {
  it("extracts right eye 6/12", () => {
    const r = extractVisual(utt("right eye 6/12"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("6_12");
    expect(r.slotSignalsPatch.rightEye).toBe(true);
    expect(r.slotSignalsPatch.acuity).toBe(true);
  });

  it("extracts left eye 6/24 using OD/OS notation", () => {
    const r = extractVisual(utt("OD 6/9, OS 6/24"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("6_9");
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_ACUITY]?.value).toBe("6_24");
  });

  it("extracts both eyes 6/18", () => {
    const r = extractVisual(utt("both eyes 6/18"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("6_18");
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_ACUITY]?.value).toBe("6_18");
  });

  it("extracts 6/60 for right eye", () => {
    const r = extractVisual(utt("visual acuity right eye 6/60"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("6_60");
  });

  it("extracts lt_6_60 for NLP", () => {
    const r = extractVisual(utt("right eye nlp no light perception"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("lt_6_60");
  });

  it("extracts lt_6_60 for hand movements", () => {
    const r = extractVisual(utt("left eye hand movements"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_ACUITY]?.value).toBe("lt_6_60");
  });

  it("extracts lt_6_60 for counting fingers", () => {
    const r = extractVisual(utt("right eye counting fingers"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("lt_6_60");
  });

  it("creates pending when Snellen present but no eye-side context", () => {
    const r = extractVisual(utt("visual acuity 6/12"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => p.parsed && (p.parsed as Record<string, unknown>).subtype === "visual_acuity_eye_pick")).toBe(true);
  });
});

// ── Visual field parsing ───────────────────────────────────────────────────────

describe("visual field parsing", () => {
  it("extracts right eye field 90 degrees", () => {
    const r = extractVisual(utt("right eye visual field 90 degrees"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_FIELD]?.value).toBe("field_90_100");
    expect(r.slotSignalsPatch.field).toBe(true);
  });

  it("extracts left eye field 60 degrees", () => {
    const r = extractVisual(utt("left eye field 60 degrees"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_FIELD]?.value).toBe("field_60_70");
  });

  it("extracts full field for ≥120°", () => {
    const r = extractVisual(utt("right eye full field visual field"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_FIELD]?.value).toBe("field_full");
  });

  it("extracts field_lt20 for less than 20 degrees", () => {
    const r = extractVisual(utt("right eye visual field less than 20 degrees"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_FIELD]?.value).toBe("field_lt20");
  });

  it("extracts both eyes field 80 degrees", () => {
    const r = extractVisual(utt("both eyes visual field 80 degrees"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_FIELD]?.value).toBe("field_80_90");
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_FIELD]?.value).toBe("field_80_90");
  });
});

// ── Enucleation ────────────────────────────────────────────────────────────────

describe("enucleation detection", () => {
  it("detects left eye enucleated and sets worst-case acuity/field", () => {
    const r = extractVisual(utt("left eye enucleated prosthetic eye"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_ENUCLEATED]?.value).toBe(true);
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_ACUITY]?.value).toBe("lt_6_60");
    expect(r.extractedFactsPatch[VISUAL_FK_LEFT_FIELD]?.value).toBe("field_lt20");
    expect(r.slotSignalsPatch.leftEye).toBe(true);
  });

  it("detects right eye removed", () => {
    const r = extractVisual(utt("right eye removed artificial eye"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ENUCLEATED]?.value).toBe(true);
    expect(r.extractedFactsPatch[VISUAL_FK_RIGHT_ACUITY]?.value).toBe("lt_6_60");
  });
});

// ── Functional modifiers ───────────────────────────────────────────────────────

describe("functional modifiers", () => {
  it("detects loss of accommodation", () => {
    const r = extractVisual(utt("visual impairment loss of accommodation pseudophakia"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_MODIFIERS]?.value as string[])?.includes("accommodation")).toBe(true);
    expect((r.extractedFactsPatch[VISUAL_FK_LEFT_MODIFIERS]?.value as string[])?.includes("accommodation")).toBe(true);
    expect(r.slotSignalsPatch.modifiers).toBe(true);
  });

  it("detects contrast sensitivity loss", () => {
    const r = extractVisual(utt("eye impairment contrast sensitivity loss"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_MODIFIERS]?.value as string[])?.includes("contrast_glare")).toBe(true);
  });

  it("detects colour loss", () => {
    const r = extractVisual(utt("visual impairment colour differentiation loss"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_MODIFIERS]?.value as string[])?.includes("colour")).toBe(true);
  });
});

// ── Specific conditions ────────────────────────────────────────────────────────

describe("specific ophthalmic conditions", () => {
  it("detects glaucoma", () => {
    const r = extractVisual(utt("glaucomatous damage right eye"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_CONDITIONS]?.value as string[])?.includes("glaucoma")).toBe(true);
  });

  it("detects cataract", () => {
    const r = extractVisual(utt("eye impairment cataract right eye"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_CONDITIONS]?.value as string[])?.includes("cataract")).toBe(true);
  });

  it("detects corneal opacity", () => {
    const r = extractVisual(utt("ocular corneal opacity scar"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_CONDITIONS]?.value as string[])?.includes("corneal")).toBe(true);
  });

  it("detects traumatic mydriasis", () => {
    const r = extractVisual(utt("eye impairment traumatic mydriasis iris abnormalities"), emptyState());
    expect((r.extractedFactsPatch[VISUAL_FK_RIGHT_CONDITIONS]?.value as string[])?.includes("mydriasis")).toBe(true);
  });
});

// ── Diplopia zone (CRITICAL: monocular/binocular → PendingObservation) ────────

describe("diplopia zone extraction", () => {
  it("creates PendingObservation for bare 'diplopia' (no zone)", () => {
    const r = extractVisual(utt("patient has diplopia visual impairment"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => (p.parsed as Record<string, unknown>)?.subtype === "visual_diplopia_zone")).toBe(true);
  });

  it("creates PendingObservation for 'double vision' without zone", () => {
    const r = extractVisual(utt("double vision present"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => (p.parsed as Record<string, unknown>)?.subtype === "visual_diplopia_zone")).toBe(true);
  });

  it("creates PendingObservation for monocular diplopia (zone must not be inferred)", () => {
    const r = extractVisual(utt("monocular diplopia"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => (p.parsed as Record<string, unknown>)?.subtype === "visual_diplopia_zone")).toBe(true);
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]).toBeUndefined();
  });

  it("creates PendingObservation for binocular diplopia (zone must not be inferred)", () => {
    const r = extractVisual(utt("binocular diplopia present"), emptyState());
    expect(r.pendingObservationsToAdd.some((p) => (p.parsed as Record<string, unknown>)?.subtype === "visual_diplopia_zone")).toBe(true);
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]).toBeUndefined();
  });

  it("directly maps 'no diplopia' → dip_none", () => {
    const r = extractVisual(utt("ocular assessment no diplopia"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]?.value).toBe("dip_none");
    expect(r.slotSignalsPatch.diplopiaId).toBe(true);
  });

  it("directly maps 'uncorrectable diplopia' → dip_uncorrectable", () => {
    const r = extractVisual(utt("visual uncorrectable diplopia not correctable"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]?.value).toBe("dip_uncorrectable");
  });

  it("directly maps 'central 30°' → dip_central30", () => {
    const r = extractVisual(utt("visual diplopia central 30 degrees zone"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]?.value).toBe("dip_central30");
  });

  it("directly maps '30 to 60°' zone → dip_30_60", () => {
    const r = extractVisual(utt("vision diplopia 30 to 60 degrees zone"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]?.value).toBe("dip_30_60");
  });

  it("directly maps 'beyond 60°' → dip_beyond60", () => {
    const r = extractVisual(utt("visual impairment diplopia beyond 60 degrees"), emptyState());
    expect(r.extractedFactsPatch[VISUAL_FK_DIPLOPIA]?.value).toBe("dip_beyond60");
  });

  it("diplopia chips include all 5 zones", () => {
    const r = extractVisual(utt("diplopia visual impairment"), emptyState());
    const obs = r.pendingObservationsToAdd.find((p) => (p.parsed as Record<string, unknown>)?.subtype === "visual_diplopia_zone");
    expect(obs?.candidateAnswers?.length).toBe(5);
  });
});

// ── No-op for non-visual input ─────────────────────────────────────────────────

describe("no-op for non-visual input", () => {
  it("returns empty patch for ROM input", () => {
    const r = extractVisual(utt("right shoulder flexion 120 degrees"), emptyState());
    expect(Object.keys(r.extractedFactsPatch).length).toBe(0);
    expect(r.pendingObservationsToAdd.length).toBe(0);
  });
});
