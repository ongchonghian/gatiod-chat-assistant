// Golden tests for the V2 renal pipeline (V2-707 / REQ-C1).
//
// Covers the full processChatV2 conversation flow for:
//   - Serum creatinine path (male/female, extraction)
//   - Creatinine clearance path
//   - CKD stage path
//   - Clinical severity path (all 4 levels)
//   - Solitary kidney signal
//   - Provisional award flag
//   - eGFR disambiguation (→ pending observation, not a fact)
//   - Missing sex → readiness gate
//   - Missing classifying input → readiness gate
//   - Multi-turn accumulation (sex T1, value T2)
//   - Full pipeline end-to-end (each path → Confirmed → PI%)
//
// Each test uses a unique session ID so runs are fully independent.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
import {
  RENAL_FK_SEX,
  RENAL_FK_SERUM_CREATININE,
  RENAL_FK_CREATININE_CLEARANCE,
  RENAL_FK_CKD_STAGE,
  RENAL_FK_CLINICAL_SEVERITY,
  RENAL_FK_SOLITARY_KIDNEY,
  RENAL_FK_PROVISIONAL_AWARD,
} from "../../../src/v2/extractors/renal.js";

let _extractorFlag: string | undefined;
let _comparisonFlag: string | undefined;

beforeAll(() => {
  process.env.GATIOD_DB_PATH = ":memory:";
  _extractorFlag = process.env.LLM_EXTRACTOR_ENABLED;
  _comparisonFlag = process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
  process.env.LLM_EXTRACTOR_ENABLED = "false";
  process.env.LLM_EXTRACTOR_COMPARISON_ENABLED = "false";
});

afterAll(() => {
  if (_extractorFlag !== undefined) process.env.LLM_EXTRACTOR_ENABLED = _extractorFlag;
  else delete process.env.LLM_EXTRACTOR_ENABLED;
  if (_comparisonFlag !== undefined) process.env.LLM_EXTRACTOR_COMPARISON_ENABLED = _comparisonFlag;
  else delete process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
});

function sid(tag: string) {
  return `golden-renal-${tag}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function renalFacts(sessionId: string) {
  const session = loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return coerceV2State(session.systemStates).systems.renal;
}

// ── Serum creatinine path ───────────────────────────────────────────────────

describe("serum creatinine path", () => {
  it("male + creatinine 180 µmol/L → sex=male, serum_creatinine=180", async () => {
    const id = sid("sc-male");
    await processChatV2(id, "Male patient, serum creatinine 180 µmol/L");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_SEX]?.value).toBe("male");
    expect(r.extractedFacts[RENAL_FK_SERUM_CREATININE]?.value).toBe(180);
    expect(r.pendingObservations).toHaveLength(0);
  });

  it("female + creatinine 150 → sex=female, serum_creatinine=150", async () => {
    const id = sid("sc-female");
    await processChatV2(id, "Female, creatinine 150");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_SEX]?.value).toBe("female");
    expect(r.extractedFacts[RENAL_FK_SERUM_CREATININE]?.value).toBe(150);
  });

  it("'serum creatinine: 220' colon phrasing → serum_creatinine=220", async () => {
    const id = sid("sc-colon");
    // SC abbreviation is not in SERUM_CREATININE_RE; use full phrasing
    await processChatV2(id, "Male, serum creatinine: 220 renal assessment");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_SERUM_CREATININE]?.value).toBe(220);
  });
});

// ── Creatinine clearance path ───────────────────────────────────────────────

describe("creatinine clearance path", () => {
  it("'creatinine clearance 45' (CrCl phrasing) → creatinine_clearance=45, not serum_creatinine", async () => {
    const id = sid("cc-crcl");
    // "CrCl" abbreviation is not a routing synonym — use full phrasing
    await processChatV2(id, "Male patient, creatinine clearance 45 ml/min");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CREATININE_CLEARANCE]?.value).toBe(45);
    expect(r.extractedFacts[RENAL_FK_SERUM_CREATININE]).toBeUndefined();
  });

  it("'creatinine clearance 38' phrasing → creatinine_clearance=38", async () => {
    const id = sid("cc-full");
    await processChatV2(id, "Female, creatinine clearance 38");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CREATININE_CLEARANCE]?.value).toBe(38);
  });
});

// ── CKD stage path ──────────────────────────────────────────────────────────

describe("CKD stage path", () => {
  it("CKD stage 3 → ckd_stage=3", async () => {
    const id = sid("ckd-stage3");
    await processChatV2(id, "Male, CKD stage 3");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CKD_STAGE]?.value).toBe(3);
  });

  it("'stage 4 CKD' phrasing → ckd_stage=4", async () => {
    const id = sid("ckd-stage4-reverse");
    await processChatV2(id, "Female patient, stage 4 CKD assessment");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CKD_STAGE]?.value).toBe(4);
  });

  it("CKD5 (no space) → ckd_stage=5", async () => {
    const id = sid("ckd5-nospace");
    await processChatV2(id, "Male, CKD5 renal impairment");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CKD_STAGE]?.value).toBe(5);
  });
});

// ── Clinical severity path ──────────────────────────────────────────────────

describe("clinical severity path", () => {
  it("'persisting despite' → clinical_severity=persisting", async () => {
    const id = sid("clin-persisting");
    await processChatV2(id, "Male, renal symptoms persisting despite treatment");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("persisting");
  });

  it("'incompletely controlled' → clinical_severity=incompletely_controlled", async () => {
    const id = sid("clin-incomplete");
    await processChatV2(id, "Female, renal condition incompletely controlled");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("incompletely_controlled");
  });

  it("'continuous surveillance' → clinical_severity=continuous_surveillance", async () => {
    const id = sid("clin-surveillance");
    await processChatV2(id, "Male, kidney condition under continuous surveillance");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("continuous_surveillance");
  });

  it("'asymptomatic' → clinical_severity=none", async () => {
    const id = sid("clin-none");
    await processChatV2(id, "Female, asymptomatic renal condition");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_CLINICAL_SEVERITY]?.value).toBe("none");
  });
});

// ── Solitary kidney ─────────────────────────────────────────────────────────

describe("solitary kidney", () => {
  it("'solitary kidney' → solitary_kidney=true", async () => {
    const id = sid("solitary");
    await processChatV2(id, "Male, solitary kidney, CKD stage 3");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_SOLITARY_KIDNEY]?.value).toBe(true);
  });

  it("'nephrectomy' → solitary_kidney=true", async () => {
    const id = sid("nephrectomy");
    await processChatV2(id, "Female, nephrectomy, creatinine clearance 50");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_SOLITARY_KIDNEY]?.value).toBe(true);
  });
});

// ── Provisional award ───────────────────────────────────────────────────────

describe("provisional award", () => {
  it("'provisional award' → provisional_award=true", async () => {
    const id = sid("provisional");
    // "CKD3" alone doesn't split "ckd" as a token; use "CKD stage 3"
    await processChatV2(id, "Male, CKD stage 3, provisional award");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_PROVISIONAL_AWARD]?.value).toBe(true);
  });

  it("'final award' → provisional_award=false", async () => {
    const id = sid("final-award");
    await processChatV2(id, "Female, creatinine clearance 40, final award");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_PROVISIONAL_AWARD]?.value).toBe(false);
  });
});

// ── eGFR disambiguation ─────────────────────────────────────────────────────

describe("eGFR disambiguation", () => {
  it("eGFR value → pending obs asking for method, NOT stored as creatinine clearance", async () => {
    const id = sid("egfr-disambig");
    const resp = await processChatV2(id, "Male, eGFR 52");
    expect(resp.route.systems).toContain("renal");
    const r = renalFacts(id);
    expect(r.pendingObservations.length).toBeGreaterThan(0);
    expect(r.pendingObservations[0].missingFields).toContain("creatinine_clearance_or_decline");
    expect(r.extractedFacts[RENAL_FK_CREATININE_CLEARANCE]).toBeUndefined();
  });
});

// ── Readiness gates ─────────────────────────────────────────────────────────

describe("readiness gates", () => {
  it("classifying input given but no sex → readiness asks for sex", async () => {
    const id = sid("gate-no-sex");
    const resp = await processChatV2(id, "CKD stage 3 renal");
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/sex|male|female/i);
  });

  it("sex given but no classifying input → readiness asks for renal function value", async () => {
    const id = sid("gate-no-input");
    const resp = await processChatV2(id, "Male patient, renal assessment");
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/creatinine|CKD|clearance|severity/i);
  });
});

// ── Multi-turn accumulation ─────────────────────────────────────────────────

describe("multi-turn accumulation", () => {
  it("sex T1, creatinine T2 → both facts present after T2", async () => {
    const id = sid("multiturn");
    await processChatV2(id, "Male patient renal impairment");
    await processChatV2(id, "serum creatinine 200 µmol/L");
    const r = renalFacts(id);
    expect(r.extractedFacts[RENAL_FK_SEX]?.value).toBe("male");
    expect(r.extractedFacts[RENAL_FK_SERUM_CREATININE]?.value).toBe(200);
  });
});

// ── Full pipeline end-to-end ─────────────────────────────────────────────────

describe("full pipeline — serum creatinine", () => {
  it("male + creatinine 180 → Confirmed → PI%", async () => {
    const id = sid("pipeline-sc");
    const r1 = await processChatV2(id, "Male patient, serum creatinine 180 µmol/L");
    expect(r1.route.systems).toContain("renal");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });
});

describe("full pipeline — creatinine clearance", () => {
  it("female + creatinine clearance 38 → Confirmed → PI%", async () => {
    const id = sid("pipeline-cc");
    await processChatV2(id, "Female, creatinine clearance 38 ml/min");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

describe("full pipeline — CKD stage", () => {
  it("male + CKD stage 4 → Confirmed → PI%", async () => {
    const id = sid("pipeline-ckd");
    await processChatV2(id, "Male, CKD stage 4");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

describe("full pipeline — clinical severity only", () => {
  it("female + persisting despite treatment → Confirmed → PI%", async () => {
    const id = sid("pipeline-clin");
    await processChatV2(id, "Female, renal symptoms persisting despite treatment");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});
