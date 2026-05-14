// Golden tests for the V2 respiratory pipeline (V2-706 / REQ-C1).
//
// Covers the full processChatV2 conversation flow for:
//   - Standard PFT pathway (FVC, FEV1, DLCO, VO2max extraction)
//   - Dyspnoea extraction (none, minimal, moderate, severe)
//   - Occupational asthma: all-prereqs extraction, workbook phrasing, missing
//     prereqs / missing medication / missing FEV1 blocks, full pipeline
//   - Asbestosis/silicosis: radiological + profusion paths, PFT path,
//     below-profusion needs PFT, full pipeline
//   - Multi-turn accumulation (PFT across turns, OA prereqs + med + FEV1)
//   - Full pipeline end-to-end (standard, OA, asbestosis → Confirmed → PI%)
//
// Each test uses a unique session ID so runs are fully independent.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
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
  return `golden-resp-${tag}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function respFacts(sessionId: string) {
  const session = loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return coerceV2State(session.systemStates).systems.respiratory;
}

// ── Standard PFT extraction ─────────────────────────────────────────────────

describe("standard PFT extraction", () => {
  it("FVC 65 → resp_fvc=65, no diagnosis set", async () => {
    const id = sid("pft-fvc");
    await processChatV2(id, "FVC 65");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_FVC]?.value).toBe(65);
    expect(r.extractedFacts[RESP_FK_DIAGNOSIS]).toBeUndefined();
  });

  it("FEV1 60 FVC 70 → both extracted", async () => {
    const id = sid("pft-fev1-fvc");
    await processChatV2(id, "FEV1 60 FVC 70");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_FEV1]?.value).toBe(60);
    expect(r.extractedFacts[RESP_FK_FVC]?.value).toBe(70);
  });

  it("DLCO 55 → dlco=55", async () => {
    const id = sid("pft-dlco");
    await processChatV2(id, "DLCO 55 respiratory");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DLCO]?.value).toBe(55);
  });

  it("VO2 max 18 → vo2max=18", async () => {
    const id = sid("pft-vo2");
    await processChatV2(id, "VO2 max 18 respiratory");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_VO2MAX]?.value).toBe(18);
  });

  it("PFT colon-separated phrasing: 'FVC: 65' → fvc=65", async () => {
    const id = sid("pft-colon");
    await processChatV2(id, "FVC: 65 FEV1: 70");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_FVC]?.value).toBe(65);
    expect(r.extractedFacts[RESP_FK_FEV1]?.value).toBe(70);
  });

  it("standard path with no PFT → readiness blocks, asks for PFT", async () => {
    const id = sid("pft-missing");
    const resp = await processChatV2(id, "respiratory impairment assessment");
    expect(resp.route.systems).toContain("respiratory");
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/FVC|FEV1|DLCO|VO2|PFT/i);
  });
});

// ── Dyspnoea extraction ─────────────────────────────────────────────────────

describe("dyspnoea extraction", () => {
  it("no dyspnoea → resp_dyspnoea=none", async () => {
    const id = sid("dysp-none");
    await processChatV2(id, "FVC 65 no dyspnoea");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DYSPNOEA]?.value).toBe("none");
  });

  it("dyspnoea on moderate exertion → on_moderate_exertion", async () => {
    const id = sid("dysp-moderate");
    await processChatV2(id, "FVC 60 dyspnoea on moderate exertion");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DYSPNOEA]?.value).toBe("on_moderate_exertion");
  });

  it("dyspnoea at rest → on_minimal_exertion", async () => {
    const id = sid("dysp-rest");
    await processChatV2(id, "FVC 55 dyspnoea at rest");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DYSPNOEA]?.value).toBe("on_minimal_exertion");
  });

  it("dyspnoea on severe exertion → on_severe_exertion", async () => {
    const id = sid("dysp-severe");
    await processChatV2(id, "FVC 70 dyspnoea on severe exertion");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DYSPNOEA]?.value).toBe("on_severe_exertion");
  });
});

// ── Occupational asthma extraction ─────────────────────────────────────────

describe("occupational asthma extraction", () => {
  it("all 3 prereqs + oral steroids + FEV1 in one turn → all facts stored, no pending", async () => {
    const id = sid("oa-complete");
    await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance oral steroids, transferred from exposure >=1 year, unlikely further improvement. FEV1 75."
    );
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DIAGNOSIS]?.value).toBe("occupational_asthma");
    expect(r.extractedFacts[RESP_FK_ASTHMA_MAINT]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_TRANSFER]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_IMPROVE]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_MED]?.value).toBe("oral_steroids");
    expect(r.extractedFacts[RESP_FK_FEV1]?.value).toBe(75);
    expect(r.pendingObservations).toHaveLength(0);
  });

  it("workbook phrasing: 'requiring daily maintenance bronchodilators only despite transfer from exposure >=1 year' → all 3 prereqs + bronchodilators extracted", async () => {
    const id = sid("oa-workbook");
    await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance bronchodilators only despite transfer from exposure >=1 year. FEV1 85."
    );
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_ASTHMA_MAINT]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_TRANSFER]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_IMPROVE]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_MED]?.value).toBe("bronchodilators");
  });

  it("high-dose inhaled steroids → asthma_medication=high_dose_steroids", async () => {
    const id = sid("oa-med-high");
    await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance high-dose inhaled steroids, transferred from exposure >=1 year, unlikely further improvement. FEV1 65."
    );
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_ASTHMA_MED]?.value).toBe("high_dose_steroids");
  });

  it("missing one prereq (no transfer) → readiness blocks asking for confirmation", async () => {
    const id = sid("oa-missing-transfer");
    const resp = await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance oral steroids, unlikely further improvement. FEV1 70."
    );
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/transfer|qualif|prereq/i);
  });

  it("all prereqs but no medication → readiness asks for maintenance medication", async () => {
    const id = sid("oa-no-med");
    const resp = await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance, transferred from exposure >=1 year, unlikely further improvement. FEV1 70."
    );
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/medication|inhaled|steroid|bronchodilator/i);
  });

  it("all prereqs + med but no FEV1 → readiness asks for PFT", async () => {
    const id = sid("oa-no-fev1");
    const resp = await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance bronchodilators only, transferred from exposure >=1 year, unlikely further improvement."
    );
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/FEV1|PFT|predicted/i);
  });
});

// ── Asbestosis / silicosis extraction ───────────────────────────────────────

describe("asbestosis/silicosis extraction", () => {
  it("asbestosis radiologically definite + profusion ≥1/1 → ready without PFT", async () => {
    const id = sid("asb-radio-high-prof");
    const resp = await processChatV2(
      id,
      "Asbestosis, radiologically confirmed, ILO profusion 1/1"
    );
    expect(resp.route.systems).toContain("respiratory");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DIAGNOSIS]?.value).toBe("asbestosis_silicosis");
    expect(r.extractedFacts[RESP_FK_ASBESTOSIS_RADIO]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASBESTOSIS_PROFUSION]?.value).toBe("at_least_1_1");
    expect(r.pendingObservations).toHaveLength(0);
  });

  it("asbestosis radiologically definite + profusion below 1/1 → not ready, asks for PFT", async () => {
    const id = sid("asb-below-prof");
    const resp = await processChatV2(
      id,
      "Asbestosis, radiologically confirmed, ILO profusion below 1/1"
    );
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/FVC|FEV1|DLCO|PFT/i);
  });

  it("asbestosis with PFT (no radio required) → ready", async () => {
    const id = sid("asb-pft-only");
    await processChatV2(id, "Asbestosis FVC 55 FEV1 60");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DIAGNOSIS]?.value).toBe("asbestosis_silicosis");
    expect(r.extractedFacts[RESP_FK_FVC]?.value).toBe(55);
    expect(r.pendingObservations).toHaveLength(0);
  });

  it("silicosis keyword → diagnosis=asbestosis_silicosis", async () => {
    const id = sid("silicosis");
    await processChatV2(id, "Silicosis radiologically confirmed, profusion 1/1");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_DIAGNOSIS]?.value).toBe("asbestosis_silicosis");
  });
});

// ── Multi-turn accumulation ─────────────────────────────────────────────────

describe("multi-turn accumulation", () => {
  it("FVC in T1, FEV1+DLCO in T2 → all three facts accumulated", async () => {
    const id = sid("multiturn-pft");
    await processChatV2(id, "FVC 65 respiratory");
    await processChatV2(id, "FEV1 70 DLCO 60");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_FVC]?.value).toBe(65);
    expect(r.extractedFacts[RESP_FK_FEV1]?.value).toBe(70);
    expect(r.extractedFacts[RESP_FK_DLCO]?.value).toBe(60);
  });

  it("OA prereqs T1, medication + FEV1 T2 → all facts present, system ready", async () => {
    const id = sid("oa-multiturn");
    await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance, transferred from exposure >=1 year, unlikely further improvement."
    );
    await processChatV2(id, "low-dose inhaled steroids. FEV1 82.");
    const r = respFacts(id);
    expect(r.extractedFacts[RESP_FK_ASTHMA_MAINT]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_TRANSFER]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_IMPROVE]?.value).toBe(true);
    expect(r.extractedFacts[RESP_FK_ASTHMA_MED]?.value).toBe("low_dose_steroids");
    expect(r.extractedFacts[RESP_FK_FEV1]?.value).toBe(82);
    expect(r.pendingObservations).toHaveLength(0);
  });
});

// ── Full pipeline end-to-end ─────────────────────────────────────────────────

describe("full pipeline — standard PFT", () => {
  it("FVC 65 → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-pft");
    const r1 = await processChatV2(id, "FVC 65");
    expect(r1.route.systems).toContain("respiratory");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });

  it("FEV1 60 FVC 70 DLCO 55 → Confirmed → PI%", async () => {
    const id = sid("pipeline-pft-full");
    await processChatV2(id, "FEV1 60 FVC 70 DLCO 55");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

describe("full pipeline — occupational asthma", () => {
  it("OA complete single-turn → Confirmed → PI%", async () => {
    const id = sid("pipeline-oa");
    await processChatV2(
      id,
      "Occupational asthma requiring daily maintenance oral steroids, transferred from exposure >=1 year, unlikely further improvement. FEV1 75."
    );
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

describe("full pipeline — asbestosis", () => {
  it("asbestosis radiologically confirmed + profusion 1/1 → Confirmed → PI%", async () => {
    const id = sid("pipeline-asb");
    await processChatV2(id, "Asbestosis, radiologically confirmed, ILO profusion 1/1");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});
