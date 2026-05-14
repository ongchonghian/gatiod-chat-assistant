// Golden tests for the V2 gastro-digestive pipeline (V2-708 / REQ-C1).
//
// Covers the full processChatV2 conversation flow for:
//   - All 4 subsystems: upperDigestive, colonicRectalAnal, liverBiliary, herniation
//   - Colonal sub-path: colonicRectal vs anal
//   - Liver/biliary sub-path: liver vs biliary
//   - Bracket selection (class 1–4) and PI% extraction
//   - Upper-GI weight-loss modifier
//   - Missing subsystem → pending obs
//   - Missing bracket → pending obs
//   - Missing PI% → pending obs
//   - Full pipeline end-to-end (each subsystem → Confirmed → PI%)
//
// Each test uses a unique session ID so runs are fully independent.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
import {
  GASTRO_FK_SUBSYSTEM,
  GASTRO_FK_COLONAL_SUBPATH,
  GASTRO_FK_LIVER_BILIARY_SUBPATH,
  GASTRO_FK_BRACKET_INDEX,
  GASTRO_FK_WEIGHT_LOSS,
  GASTRO_FK_PI_PERCENT,
} from "../../../src/v2/extractors/gastro.js";

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
  return `golden-gastro-${tag}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function gastroFacts(sessionId: string) {
  const session = loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return coerceV2State(session.systemStates).systems.gastro_digestive;
}

// ── Upper digestive subsystem ───────────────────────────────────────────────

describe("upper digestive subsystem", () => {
  it("stomach condition class 2 PI 15% → all 3 facts extracted, no pending", async () => {
    const id = sid("upper-stomach");
    await processChatV2(id, "Stomach condition class 2 PI 15%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(1);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(15);
    expect(g.pendingObservations).toHaveLength(0);
  });

  it("oesophageal reflux class 1 PI 5% → bracket_index=0", async () => {
    const id = sid("upper-oesophageal");
    await processChatV2(id, "Oesophageal reflux class 1 PI 5%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(0);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(5);
  });

  it("peptic ulcer class 3 PI 25% → bracket_index=2", async () => {
    const id = sid("upper-peptic");
    // "peptic" alone is not a router synonym; "gastric" is required to route to gastro_digestive
    await processChatV2(id, "Gastric peptic ulcer class 3 PI 25%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(2);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(25);
  });

  it("upper GI weight loss modifier: oesophageal class 2 weight loss 15% PI 20% → weight_loss_percent=15", async () => {
    const id = sid("upper-weight-loss");
    await processChatV2(id, "Oesophageal condition class 2 weight loss 15% PI 20%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
    expect(g.extractedFacts[GASTRO_FK_WEIGHT_LOSS]?.value).toBe(15);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(20);
  });
});

// ── Colonic / rectal / anal subsystem ───────────────────────────────────────

describe("colonic/rectal/anal subsystem", () => {
  it("colitis class 1 PI 5% → subsystem=colonicRectalAnal, subpath=colonicRectal", async () => {
    const id = sid("colonic-colitis");
    await processChatV2(id, "Colitis class 1 PI 5%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("colonicRectalAnal");
    expect(g.extractedFacts[GASTRO_FK_COLONAL_SUBPATH]?.value).toBe("colonicRectal");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(0);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(5);
    expect(g.pendingObservations).toHaveLength(0);
  });

  it("rectal disease class 2 PI 10% → subpath=colonicRectal", async () => {
    const id = sid("colonic-rectal");
    await processChatV2(id, "Rectal disease class 2 PI 10%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_COLONAL_SUBPATH]?.value).toBe("colonicRectal");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(1);
  });

  it("anal disease class 2 PI 10% → subpath=anal", async () => {
    const id = sid("colonic-anal");
    await processChatV2(id, "Anal disease class 2 PI 10%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("colonicRectalAnal");
    expect(g.extractedFacts[GASTRO_FK_COLONAL_SUBPATH]?.value).toBe("anal");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(1);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(10);
  });
});

// ── Liver / biliary subsystem ───────────────────────────────────────────────

describe("liver/biliary subsystem", () => {
  it("liver cirrhosis class 3 PI 25% → subsystem=liverBiliary, subpath=liver", async () => {
    const id = sid("liver-cirrhosis");
    await processChatV2(id, "Liver cirrhosis class 3 PI 25%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("liverBiliary");
    expect(g.extractedFacts[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value).toBe("liver");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(2);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(25);
    expect(g.pendingObservations).toHaveLength(0);
  });

  it("hepatitis class 2 PI 12% → subpath=liver", async () => {
    const id = sid("liver-hepatitis");
    await processChatV2(id, "Hepatitis class 2 PI 12%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value).toBe("liver");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(1);
  });

  it("biliary tract disease class 2 PI 12% → subpath=biliary", async () => {
    const id = sid("liver-biliary");
    await processChatV2(id, "Biliary tract disease class 2 PI 12%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("liverBiliary");
    expect(g.extractedFacts[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value).toBe("biliary");
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(12);
  });
});

// ── Herniation subsystem ────────────────────────────────────────────────────

describe("herniation subsystem", () => {
  it("inguinal hernia class 1 PI 3% → subsystem=herniation, no subpath required", async () => {
    const id = sid("hernia-inguinal");
    await processChatV2(id, "Inguinal hernia class 1 PI 3%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("herniation");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(0);
    expect(g.extractedFacts[GASTRO_FK_PI_PERCENT]?.value).toBe(3);
    expect(g.pendingObservations).toHaveLength(0);
  });

  it("incisional hernia class 3 PI 20% → bracket_index=2", async () => {
    const id = sid("hernia-incisional");
    await processChatV2(id, "Incisional hernia class 3 PI 20%");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("herniation");
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(2);
  });
});

// ── Clarification cases ─────────────────────────────────────────────────────

describe("clarification cases", () => {
  it("no subsystem keyword → pending obs asking for subsystem", async () => {
    const id = sid("no-subsystem");
    const resp = await processChatV2(id, "Gastro digestive impairment class 2");
    expect(resp.route.systems).toContain("gastro_digestive");
    const g = gastroFacts(id);
    expect(g.pendingObservations.length).toBeGreaterThan(0);
    expect(g.pendingObservations[0].missingFields).toContain("subSystem");
  });

  it("subsystem known, no bracket → pending obs asking for severity class", async () => {
    const id = sid("no-bracket");
    await processChatV2(id, "Stomach ulcer gastric");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_SUBSYSTEM]?.value).toBe("upperDigestive");
    expect(g.pendingObservations.length).toBeGreaterThan(0);
    expect(g.pendingObservations[0].missingFields).toContain("selectedBracketIndex");
  });

  it("subsystem + bracket known, no PI% → pending obs asking for PI%", async () => {
    const id = sid("no-pi");
    await processChatV2(id, "Stomach gastric class 2");
    const g = gastroFacts(id);
    expect(g.extractedFacts[GASTRO_FK_BRACKET_INDEX]?.value).toBe(1);
    expect(g.pendingObservations.length).toBeGreaterThan(0);
    expect(g.pendingObservations[0].missingFields).toContain("piPercent");
  });
});

// ── Full pipeline end-to-end ─────────────────────────────────────────────────

describe("full pipeline — upper digestive", () => {
  it("stomach class 2 PI 15% → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-upper");
    const r1 = await processChatV2(id, "Stomach condition class 2 PI 15%");
    expect(r1.route.systems).toContain("gastro_digestive");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });
});

describe("full pipeline — colonic", () => {
  it("colitis class 1 PI 5% → Confirmed → PI%", async () => {
    const id = sid("pipeline-colonic");
    // Add "bowel" so gastro scores higher than spine's ontology match on "colitis"
    await processChatV2(id, "Bowel colitis class 1 PI 5%");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

describe("full pipeline — liver", () => {
  it("liver cirrhosis class 3 PI 35% → Confirmed → PI%", async () => {
    const id = sid("pipeline-liver");
    // Liver class 3 (index 2) range is 30–49%; PI 35% is within range
    await processChatV2(id, "Liver cirrhosis class 3 PI 35%");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

describe("full pipeline — hernia", () => {
  it("inguinal hernia class 1 PI 3% → Confirmed → PI%", async () => {
    const id = sid("pipeline-hernia");
    await processChatV2(id, "Inguinal hernia class 1 PI 3%");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});
