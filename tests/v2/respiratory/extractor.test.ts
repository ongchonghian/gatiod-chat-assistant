import { describe, expect, it } from "vitest";
import { extractRespiratory } from "../../../src/v2/extractors/respiratory.js";
import {
  RESP_FK_DIAGNOSIS,
  RESP_FK_FVC,
  RESP_FK_FEV1,
  RESP_FK_DLCO,
  RESP_FK_VO2MAX,
  RESP_FK_DYSPNOEA,
  RESP_FK_ASTHMA_MAINT,
  RESP_FK_ASTHMA_TRANSFER,
  RESP_FK_ASTHMA_IMPROVE,
  RESP_FK_ASTHMA_MED,
  RESP_FK_ASBESTOSIS_RADIO,
  RESP_FK_ASBESTOSIS_PROFUSION,
} from "../../../src/v2/extractors/respiratory.js";
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

function emptyState() {
  return defaultV2SessionState().systems.respiratory;
}

// ── Diagnosis extraction ───────────────────────────────────────────────────────

describe("diagnosis extraction", () => {
  it("extracts occupational asthma", () => {
    const r = extractRespiratory(utt("occupational asthma FEV1 85%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DIAGNOSIS]?.value).toBe("occupational_asthma");
    expect(r.slotSignalsPatch.diagnosis).toBe(true);
  });

  it("extracts asbestosis", () => {
    const r = extractRespiratory(utt("asbestosis FVC 65%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DIAGNOSIS]?.value).toBe("asbestosis_silicosis");
  });

  it("extracts silicosis", () => {
    const r = extractRespiratory(utt("silicosis DLCO 55%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DIAGNOSIS]?.value).toBe("asbestosis_silicosis");
  });

  it("does not set diagnosis for standard utterance", () => {
    const r = extractRespiratory(utt("FVC 70% FEV1 65%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DIAGNOSIS]).toBeUndefined();
  });
});

// ── PFT value extraction ───────────────────────────────────────────────────────

describe("PFT value extraction", () => {
  it("extracts FVC", () => {
    const r = extractRespiratory(utt("FVC 65%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_FVC]?.value).toBe(65);
    expect(r.slotSignalsPatch.pft_values).toBe(true);
  });

  it("extracts FEV1", () => {
    const r = extractRespiratory(utt("FEV1 72%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_FEV1]?.value).toBe(72);
  });

  it("extracts DLCO", () => {
    const r = extractRespiratory(utt("DLCO 55%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DLCO]?.value).toBe(55);
  });

  it("extracts VO2 Max", () => {
    const r = extractRespiratory(utt("VO2 Max 22 ml/kg/min"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_VO2MAX]?.value).toBe(22);
  });

  it("extracts multiple PFT values in one utterance", () => {
    const r = extractRespiratory(utt("FVC 65% FEV1 58% DLCO 48%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_FVC]?.value).toBe(65);
    expect(r.extractedFactsPatch[RESP_FK_FEV1]?.value).toBe(58);
    expect(r.extractedFactsPatch[RESP_FK_DLCO]?.value).toBe(48);
  });

  it("extracts decimal PFT value", () => {
    const r = extractRespiratory(utt("FVC 68.5%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_FVC]?.value).toBe(68.5);
  });

  it("extracts FVC without % symbol", () => {
    const r = extractRespiratory(utt("FVC 70"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_FVC]?.value).toBe(70);
  });
});

// ── Dyspnoea extraction ────────────────────────────────────────────────────────

describe("dyspnoea extraction", () => {
  it("extracts no dyspnoea", () => {
    const r = extractRespiratory(utt("no dyspnoea FVC 70%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DYSPNOEA]?.value).toBe("none");
  });

  it("extracts dyspnoea on moderate exertion (climbing stairs)", () => {
    const r = extractRespiratory(utt("FVC 65% climbing stairs"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DYSPNOEA]?.value).toBe("on_moderate_exertion");
  });

  it("extracts dyspnoea on severe exertion", () => {
    const r = extractRespiratory(utt("FVC 65% dyspnoea on severe exertion"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DYSPNOEA]?.value).toBe("on_severe_exertion");
  });

  it("extracts dyspnoea on minimal exertion", () => {
    const r = extractRespiratory(utt("dyspnoea on minimal exertion FVC 40%"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_DYSPNOEA]?.value).toBe("on_minimal_exertion");
  });
});

// ── Occupational asthma pathway ────────────────────────────────────────────────

describe("occupational asthma pathway", () => {
  it("extracts daily maintenance requirement", () => {
    const r = extractRespiratory(utt("requires daily maintenance therapy"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_MAINT]?.value).toBe(true);
  });

  it("extracts transferred from exposure", () => {
    const r = extractRespiratory(utt("transferred from exposure one year after transfer"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_TRANSFER]?.value).toBe(true);
  });

  it("extracts unlikely further improvement", () => {
    const r = extractRespiratory(utt("unlikely further improvement"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_IMPROVE]?.value).toBe(true);
  });

  it("extracts oral steroids medication", () => {
    const r = extractRespiratory(utt("occupational asthma oral steroids"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_MED]?.value).toBe("oral_steroids");
    expect(r.slotSignalsPatch.asthma_medication).toBe(true);
  });

  it("extracts low-dose inhaled steroids medication", () => {
    const r = extractRespiratory(utt("occupational asthma low-dose inhaled steroids"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_MED]?.value).toBe("low_dose_steroids");
  });

  it("extracts high-dose ICS medication", () => {
    const r = extractRespiratory(utt("occupational asthma high-dose ICS"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_MED]?.value).toBe("high_dose_steroids");
  });

  it("extracts bronchodilators only medication", () => {
    const r = extractRespiratory(utt("occupational asthma bronchodilators only"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASTHMA_MED]?.value).toBe("bronchodilators");
  });

  it("sets asthma_prerequisites signal when all three confirmed", () => {
    const state = emptyState();
    // First pass: maint + transfer
    const r1 = extractRespiratory(utt("requires daily maintenance transferred from exposure"), state);
    expect(r1.slotSignalsPatch.asthma_prerequisites).toBeUndefined();
    // Second pass: add improve
    const r2 = extractRespiratory(
      utt("unlikely further improvement"),
      { ...state, extractedFacts: { ...state.extractedFacts, ...r1.extractedFactsPatch } },
    );
    expect(r2.slotSignalsPatch.asthma_prerequisites).toBe(true);
  });
});

// ── Asbestosis/silicosis pathway ───────────────────────────────────────────────

describe("asbestosis/silicosis pathway", () => {
  it("extracts radiologically definite", () => {
    const r = extractRespiratory(utt("asbestosis radiologically definite"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASBESTOSIS_RADIO]?.value).toBe(true);
  });

  it("extracts ILO profusion at least 1/1", () => {
    const r = extractRespiratory(utt("asbestosis profusion at least 1/1"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASBESTOSIS_PROFUSION]?.value).toBe("at_least_1_1");
    expect(r.slotSignalsPatch.asbestosis_profusion).toBe(true);
  });

  it("extracts profusion below 1/1", () => {
    const r = extractRespiratory(utt("asbestosis profusion below 1/1"), emptyState());
    expect(r.extractedFactsPatch[RESP_FK_ASBESTOSIS_PROFUSION]?.value).toBe("below_1_1");
  });
});
