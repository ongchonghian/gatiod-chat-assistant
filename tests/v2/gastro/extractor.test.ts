import { describe, expect, it } from "vitest";
import { extractGastro } from "../../../src/v2/extractors/gastro.js";
import {
  GASTRO_FK_SUBSYSTEM,
  GASTRO_FK_COLONAL_SUBPATH,
  GASTRO_FK_LIVER_BILIARY_SUBPATH,
  GASTRO_FK_BRACKET_INDEX,
  GASTRO_FK_WEIGHT_LOSS,
  GASTRO_FK_PI_PERCENT,
} from "../../../src/v2/extractors/gastro.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { NormalizedUtterance, V2SystemFacts } from "../../../src/v2/contracts.js";

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

function emptyState() {
  return defaultV2SessionState().systems.gastro_digestive;
}

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts) {
  return { ...emptyState(), extractedFacts: facts };
}

// ── Subsystem detection ────────────────────────────────────────────────────────

describe("subsystem detection", () => {
  it("detects upper digestive from 'stomach'", () => {
    const r = extractGastro(utt("stomach ulcer class II 5%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
    expect(r.slotSignalsPatch.subSystem).toBe(true);
  });

  it("detects upper digestive from 'oesophagus'", () => {
    const r = extractGastro(utt("oesophageal reflux class I 3%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
  });

  it("detects upper digestive from 'upper GI'", () => {
    const r = extractGastro(utt("upper GI disease class II 8%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
  });

  it("detects colonicRectalAnal from 'colon'", () => {
    const r = extractGastro(utt("colonic disease class I 2%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("colonicRectalAnal");
  });

  it("detects colonicRectalAnal from 'crohn'", () => {
    const r = extractGastro(utt("crohn disease class II 8%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("colonicRectalAnal");
  });

  it("detects liverBiliary from 'liver'", () => {
    const r = extractGastro(utt("liver disease class I 3%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("liverBiliary");
  });

  it("detects liverBiliary from 'cirrhosis'", () => {
    const r = extractGastro(utt("cirrhosis class II 12%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("liverBiliary");
  });

  it("detects herniation from 'hernia' (policy fix §3)", () => {
    const r = extractGastro(utt("inguinal hernia class I 5%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("herniation");
  });

  it("detects herniation from 'incisional hernia' (policy fix §3)", () => {
    const r = extractGastro(utt("incisional hernia class II 10%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]?.value).toBe("herniation");
  });

  it("creates pending obs when subsystem not detected", () => {
    const r = extractGastro(utt("abdominal pain class I 5%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_SUBSYSTEM]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("other");
    expect(r.pendingObservationsToAdd[0].parsed["subtype"]).toBe("gastro_subsystem");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Upper GI (oesophagus/stomach/duodenum/pancreas)");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Colon/rectum/anus");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Liver/biliary");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Hernia");
  });
});

// ── Colonal sub-path detection ─────────────────────────────────────────────────

describe("colonal sub-path detection", () => {
  it("auto-detects anal sub-path from 'anal'", () => {
    const r = extractGastro(utt("anal disease class I 5%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_COLONAL_SUBPATH]?.value).toBe("anal");
  });

  it("auto-detects colonicRectal sub-path from 'rectal class'", () => {
    const r = extractGastro(utt("rectal disease class II 15%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_COLONAL_SUBPATH]?.value).toBe("colonicRectal");
  });

  it("creates pending obs when colonal sub-path ambiguous", () => {
    const state = stateWith({ [GASTRO_FK_SUBSYSTEM]: fact("colonicRectalAnal") });
    const r = extractGastro(utt("bowel disorder class I 5%"), state);
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].parsed["subtype"]).toBe("gastro_colonal_subpath");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Colonic & Rectal Disease");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Anal Disease");
  });
});

// ── Liver/biliary sub-path detection ──────────────────────────────────────────

describe("liver/biliary sub-path detection", () => {
  it("auto-detects biliary sub-path from 'biliary tract'", () => {
    const r = extractGastro(utt("biliary tract disease class I 3%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value).toBe("biliary");
  });

  it("auto-detects liver sub-path from 'hepatic'", () => {
    const r = extractGastro(utt("hepatic disease class I 3%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value).toBe("liver");
  });
});

// ── Bracket extraction ─────────────────────────────────────────────────────────

describe("bracket (severity class) extraction", () => {
  it("extracts class I → index 0", () => {
    const r = extractGastro(utt("stomach class I 3%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_BRACKET_INDEX]?.value).toBe(0);
    expect(r.slotSignalsPatch.selectedBracketIndex).toBe(true);
  });

  it("extracts class II → index 1", () => {
    const r = extractGastro(utt("stomach class II 8%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_BRACKET_INDEX]?.value).toBe(1);
  });

  it("extracts class III → index 2", () => {
    const r = extractGastro(utt("stomach class III 20%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_BRACKET_INDEX]?.value).toBe(2);
  });

  it("creates pending obs when no class mentioned", () => {
    const state = stateWith({ [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive") });
    const r = extractGastro(utt("stomach disease PI 5%"), state);
    expect(r.pendingObservationsToAdd.some(o => o.parsed["subtype"] === "gastro_bracket")).toBe(true);
  });
});

// ── PI% extraction ─────────────────────────────────────────────────────────────

describe("PI% extraction", () => {
  it("extracts explicit PI%", () => {
    const r = extractGastro(utt("stomach class II PI% 8"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_PI_PERCENT]?.value).toBe(8);
    expect(r.slotSignalsPatch.piPercent).toBe(true);
  });

  it("extracts percentage notation", () => {
    const r = extractGastro(utt("stomach class I 5%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_PI_PERCENT]?.value).toBe(5);
  });

  it("creates pending obs for PI% when bracket known but PI% missing", () => {
    const state = stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
    });
    const r = extractGastro(utt("stomach class I"), state);
    expect(r.pendingObservationsToAdd.some(o => o.parsed["subtype"] === "gastro_pi_percent")).toBe(true);
    const obs = r.pendingObservationsToAdd.find(o => o.parsed["subtype"] === "gastro_pi_percent");
    expect(obs?.clarificationQuestion).toMatch(/PI%/);
  });
});

// ── Weight loss (upper digestive only) ────────────────────────────────────────

describe("weight loss extraction (upper digestive)", () => {
  it("extracts weight loss percent", () => {
    const r = extractGastro(utt("stomach class II weight loss 15% PI 8%"), emptyState());
    expect(r.extractedFactsPatch[GASTRO_FK_WEIGHT_LOSS]?.value).toBe(15);
  });
});
