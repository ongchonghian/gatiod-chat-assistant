import { describe, expect, it } from "vitest";
import { extractRenal } from "../../../src/v2/extractors/renal.js";
import {
  RENAL_FK_SEX,
  RENAL_FK_SERUM_CREATININE,
  RENAL_FK_CREATININE_CLEARANCE,
  RENAL_FK_CKD_STAGE,
  RENAL_FK_CLINICAL_SEVERITY,
  RENAL_FK_SOLITARY_KIDNEY,
  RENAL_FK_PROVISIONAL_AWARD,
} from "../../../src/v2/extractors/renal.js";
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
  return defaultV2SessionState().systems.renal;
}

// ── Sex extraction ─────────────────────────────────────────────────────────────

describe("sex extraction", () => {
  it("extracts male", () => {
    const r = extractRenal(utt("male patient serum creatinine 180"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SEX]?.value).toBe("male");
    expect(r.slotSignalsPatch.sex).toBe(true);
  });

  it("extracts female", () => {
    const r = extractRenal(utt("female creatinine 150"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SEX]?.value).toBe("female");
  });

  it("extracts woman as female", () => {
    const r = extractRenal(utt("woman creatinine clearance 45"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SEX]?.value).toBe("female");
  });
});

// ── Serum creatinine extraction ────────────────────────────────────────────────

describe("serum creatinine extraction", () => {
  it("extracts serum creatinine µmol/L", () => {
    const r = extractRenal(utt("serum creatinine 180 µmol/L male"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SERUM_CREATININE]?.value).toBe(180);
    expect(r.slotSignalsPatch.renal_inputs).toBe(true);
  });

  it("extracts creatinine without units", () => {
    const r = extractRenal(utt("male creatinine 220"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SERUM_CREATININE]?.value).toBe(220);
  });
});

// ── Creatinine clearance extraction ───────────────────────────────────────────

describe("creatinine clearance extraction", () => {
  it("extracts creatinine clearance mL/min", () => {
    const r = extractRenal(utt("male creatinine clearance 45 ml/min"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CREATININE_CLEARANCE]?.value).toBe(45);
    expect(r.slotSignalsPatch.renal_inputs).toBe(true);
  });

  it("extracts CrCl abbreviation", () => {
    const r = extractRenal(utt("male CrCl 38"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CREATININE_CLEARANCE]?.value).toBe(38);
  });
});

// ── CKD stage extraction ───────────────────────────────────────────────────────

describe("CKD stage extraction", () => {
  it("extracts CKD stage 3", () => {
    const r = extractRenal(utt("male CKD stage 3"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CKD_STAGE]?.value).toBe(3);
    expect(r.slotSignalsPatch.renal_inputs).toBe(true);
  });

  it("extracts CKD5", () => {
    const r = extractRenal(utt("male CKD5"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CKD_STAGE]?.value).toBe(5);
  });

  it("extracts stage N CKD format", () => {
    const r = extractRenal(utt("female stage 4 CKD"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CKD_STAGE]?.value).toBe(4);
  });
});

// ── Clinical severity extraction ───────────────────────────────────────────────

describe("clinical severity extraction", () => {
  it("extracts persisting severity", () => {
    const r = extractRenal(utt("male persisting despite treatment"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("persisting");
    expect(r.slotSignalsPatch.clinical_severity).toBe(true);
  });

  it("extracts incompletely controlled", () => {
    const r = extractRenal(utt("male incompletely controlled renal disease"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("incompletely_controlled");
  });

  it("extracts continuous surveillance", () => {
    const r = extractRenal(utt("male continuous surveillance required"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("continuous_surveillance");
  });

  it("extracts none clinical severity", () => {
    const r = extractRenal(utt("male asymptomatic renal impairment"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("none");
  });
});

// ── Solitary kidney ────────────────────────────────────────────────────────────

describe("solitary kidney extraction", () => {
  it("extracts solitary kidney = true", () => {
    const r = extractRenal(utt("male solitary kidney CKD stage 2"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SOLITARY_KIDNEY]?.value).toBe(true);
    expect(r.slotSignalsPatch.solitary_kidney).toBe(true);
  });

  it("extracts nephrectomy as solitary kidney", () => {
    const r = extractRenal(utt("male nephrectomy CKD stage 3"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_SOLITARY_KIDNEY]?.value).toBe(true);
  });
});

// ── Provisional award ──────────────────────────────────────────────────────────

describe("provisional award", () => {
  it("extracts final award = not provisional", () => {
    const r = extractRenal(utt("male CKD stage 3 final award"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_PROVISIONAL_AWARD]?.value).toBe(false);
    expect(r.slotSignalsPatch.provisional_award).toBe(true);
  });

  it("extracts provisional award = true", () => {
    const r = extractRenal(utt("male CKD stage 3 provisional award"), emptyState());
    expect(r.extractedFactsPatch[RENAL_FK_PROVISIONAL_AWARD]?.value).toBe(true);
  });
});

// ── eGFR disambiguation (policy fix §4) ───────────────────────────────────────

describe("eGFR disambiguation pending obs", () => {
  it("creates pending obs when eGFR is mentioned", () => {
    const r = extractRenal(utt("male eGFR 45"), emptyState());
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("other");
    expect(r.pendingObservationsToAdd[0].parsed["subtype"]).toBe("egfr_disambiguation");
    expect(r.pendingObservationsToAdd[0].parsed["egfrValue"]).toBe(45);
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toHaveLength(2);
  });

  it("does not create pending obs for serum creatinine", () => {
    const r = extractRenal(utt("male creatinine 180"), emptyState());
    expect(r.pendingObservationsToAdd).toHaveLength(0);
  });
});
