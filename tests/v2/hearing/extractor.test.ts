import { describe, expect, it } from "vitest";
import { extractHearing } from "../../../src/v2/extractors/hearing.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
  HEARING_FK_OCCUPATIONAL_YEARS,
  HEARING_FK_TINNITUS,
} from "../../../src/v2/extractors/hearing.js";
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
  return defaultV2SessionState().systems.hearing;
}

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts) {
  return { ...emptyState(), extractedFacts: facts };
}

// ── Path detection ─────────────────────────────────────────────────────────────

describe("path detection", () => {
  it("detects NID path from 'noise-induced'", () => {
    const r = extractHearing(utt("noise-induced deafness left 65 dB right 70 dB age 55"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_PATH]?.value).toBe("nid");
    expect(r.slotSignalsPatch.path).toBe(true);
  });

  it("detects NID path from 'NID'", () => {
    const r = extractHearing(utt("NID left 60 dB right 65 dB age 52"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_PATH]?.value).toBe("nid");
  });

  it("detects NID path from 'occupational noise'", () => {
    const r = extractHearing(utt("occupational noise exposure left 70 right 65 age 58"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_PATH]?.value).toBe("nid");
  });

  it("detects injury path from 'injury'", () => {
    const r = extractHearing(utt("injury to left ear left 65 dB"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_PATH]?.value).toBe("injury");
  });

  it("detects injury path from 'blast'", () => {
    const r = extractHearing(utt("blast injury left ear left 70 dB"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_PATH]?.value).toBe("injury");
  });

  it("creates pending obs when no path detected", () => {
    const r = extractHearing(utt("hearing loss"), emptyState());
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("hearing_value");
    expect(r.pendingObservationsToAdd[0].parsed["subtype"]).toBe("hearing_path");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Noise-Induced Deafness (NID)");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Injury/Accident");
  });
});

// ── AHL extraction (NID) ───────────────────────────────────────────────────────

describe("AHL extraction — NID path", () => {
  it("extracts left and right AHL in one utterance", () => {
    const r = extractHearing(utt("noise-induced left 65 dB right 70 dB age 55"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(65);
    expect(r.extractedFactsPatch[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(70);
    expect(r.slotSignalsPatch.leftEarAhl).toBe(true);
    expect(r.slotSignalsPatch.rightEarAhl).toBe(true);
  });

  it("extracts left AHL only", () => {
    const r = extractHearing(utt("NID left ear AHL 60 dB age 50"), stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(65),
    }));
    expect(r.extractedFactsPatch[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(60);
  });

  it("creates pending obs when both ears missing", () => {
    const state = stateWith({ [HEARING_FK_PATH]: fact("nid"), [HEARING_FK_AGE]: fact(55) });
    const r = extractHearing(utt("patient has noise-induced deafness"), state);
    const ahl = r.pendingObservationsToAdd.find(o => o.parsed["subtype"] === "hearing_ahl");
    expect(ahl).toBeDefined();
    expect(ahl?.clarificationQuestion).toMatch(/both ears/i);
    expect(ahl?.candidateAnswers).toContain("65 dB");
  });

  it("creates pending obs for right ear when only left is known", () => {
    const state = stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_AGE]: fact(55),
    });
    const r = extractHearing(utt("NID, right ear not yet assessed"), state);
    const ahl = r.pendingObservationsToAdd.find(o => o.parsed["subtype"] === "hearing_ahl");
    expect(ahl).toBeDefined();
    expect(ahl?.clarificationQuestion).toMatch(/right ear/i);
  });

  it("creates pending obs for age when both AHLs present but age missing", () => {
    const state = stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
    });
    const r = extractHearing(utt("NID, left 65, right 70"), state);
    const agePending = r.pendingObservationsToAdd.find(o => o.parsed["subtype"] === "hearing_age");
    expect(agePending).toBeDefined();
  });
});

// ── Age extraction (NID) ───────────────────────────────────────────────────────

describe("age extraction — NID path", () => {
  it("extracts age from 'age 55'", () => {
    const r = extractHearing(utt("NID left 65 dB right 70 dB age 55"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_AGE]?.value).toBe(55);
    expect(r.slotSignalsPatch.age).toBe(true);
  });

  it("extracts age from '58 years old'", () => {
    const r = extractHearing(utt("NID left 70 right 75 58 years old"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_AGE]?.value).toBe(58);
  });
});

// ── Occupational years (NID) ───────────────────────────────────────────────────

describe("occupational years extraction", () => {
  it("extracts occupational exposure years", () => {
    const r = extractHearing(utt("NID left 65 right 70 age 55 25 years exposure"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_OCCUPATIONAL_YEARS]?.value).toBe(25);
  });
});

// ── Injury path ────────────────────────────────────────────────────────────────

describe("AHL extraction — injury path", () => {
  it("extracts affected ear (left)", () => {
    const state = stateWith({ [HEARING_FK_PATH]: fact("injury") });
    const r = extractHearing(utt("injury left ear 70 dB"), state);
    expect(r.extractedFactsPatch[HEARING_FK_AFFECTED_EARS]?.value).toBe("left");
    expect(r.extractedFactsPatch[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(70);
    expect(r.slotSignalsPatch.affectedEars).toBe(true);
  });

  it("extracts affected ear (right)", () => {
    const state = stateWith({ [HEARING_FK_PATH]: fact("injury") });
    const r = extractHearing(utt("injury right ear 65 dB"), state);
    expect(r.extractedFactsPatch[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
    expect(r.extractedFactsPatch[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(65);
  });

  it("creates pending obs for affected ear when path is injury and ear unknown", () => {
    const state = stateWith({ [HEARING_FK_PATH]: fact("injury") });
    const r = extractHearing(utt("injury to hearing"), state);
    const obs = r.pendingObservationsToAdd.find(o => o.parsed["subtype"] === "hearing_affected_ear");
    expect(obs).toBeDefined();
    expect(obs?.candidateAnswers).toContain("Left ear");
    expect(obs?.candidateAnswers).toContain("Right ear");
  });
});

// ── Tinnitus ───────────────────────────────────────────────────────────────────

describe("tinnitus extraction", () => {
  it("detects tinnitus keyword", () => {
    const r = extractHearing(utt("NID left 65 right 70 age 55 tinnitus"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_TINNITUS]?.value).toBe(true);
    expect(r.slotSignalsPatch.tinnitus_mentioned).toBe(true);
  });

  it("detects 'ringing in ears'", () => {
    const r = extractHearing(utt("NID left 70 right 75 age 58 ringing in ears"), emptyState());
    expect(r.extractedFactsPatch[HEARING_FK_TINNITUS]?.value).toBe(true);
  });
});
