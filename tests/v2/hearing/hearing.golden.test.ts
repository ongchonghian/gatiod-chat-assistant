// Golden tests for the V2 hearing pipeline (V2-703 / REQ-B3).
//
// Covers the full processChatV2 conversation flow for:
//   - NID path: extraction, clarification roundtrips, full assessment pipeline
//   - Injury path: extraction, affected-ear detection, full assessment pipeline
//   - Path ambiguity: clarification when no NID/injury keyword
//   - Instance scoping: right-ear vs left-ear fact isolation
//
// Each test uses a unique session ID so runs are independent.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
  HEARING_FK_OCCUPATIONAL_YEARS,
  HEARING_FK_TINNITUS,
} from "../../../src/v2/extractors/hearing.js";

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
  return `golden-hearing-${tag}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function hearingFacts(sessionId: string) {
  const session = loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return coerceV2State(session.systemStates).systems.hearing;
}

// ── NID path: extraction ────────────────────────────────────────────────────

describe("NID path — extraction", () => {
  it("complete single-turn: bilateral AHL + age → all facts extracted, no pending", async () => {
    const id = sid("nid-complete");
    await processChatV2(id, "noise-induced deafness left 65 dB right 70 dB age 55");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("nid");
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(65);
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(70);
    expect(h.extractedFacts[HEARING_FK_AGE]?.value).toBe(55);
    expect(h.pendingObservations).toHaveLength(0);
  });

  it("NID keyword variant 'occupational deafness' is recognised as NID path", async () => {
    // "occupational noise exposure" alone has no hearing synonym in the router;
    // "occupational deafness" has "deafness" → routes to hearing → NID_RE matches.
    const id = sid("nid-keyword-occ");
    await processChatV2(id, "occupational deafness left 60 dB right 65 dB age 52");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("nid");
  });

  it("tinnitus signal is captured alongside NID facts", async () => {
    const id = sid("nid-tinnitus");
    await processChatV2(id, "NID left 62 dB right 68 dB age 50, also has tinnitus");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("nid");
    expect(h.extractedFacts[HEARING_FK_TINNITUS]?.value).toBe(true);
  });

  it("occupational exposure years are captured alongside NID facts", async () => {
    const id = sid("nid-occ-years");
    await processChatV2(id, "NID left 60 dB right 65 dB age 58, 25 years noise exposure");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_OCCUPATIONAL_YEARS]?.value).toBe(25);
  });
});

// ── NID path: clarification roundtrips ─────────────────────────────────────

describe("NID path — clarification roundtrips", () => {
  it("NID with no AHL → clarification asked for bilateral AHL", async () => {
    const id = sid("nid-no-ahl");
    const r1 = await processChatV2(id, "noise-induced deafness age 55");
    expect(r1.needsClarification).toBe(true);
    // The question should mention AHL or dB
    expect(r1.message.toLowerCase()).toMatch(/ahl|average hearing loss|db|decibel/);
  });

  it("NID with AHL but no age → clarification asked for age", async () => {
    const id = sid("nid-no-age");
    const r1 = await processChatV2(id, "NID left 65 dB right 70 dB");
    expect(r1.needsClarification).toBe(true);
    expect(r1.message.toLowerCase()).toContain("age");
  });

  it("NID AHL clarification resolves: T1 path+age, T2 AHL chip → all data ready → T3 Confirmed → PI%", async () => {
    // When missingEar="both", the resolver maps a single chip value to BOTH ears.
    // Provide age up front so that after the AHL chip the system is immediately ready.
    const id = sid("nid-ahl-clarify");
    const r1 = await processChatV2(id, "NID age 55");
    expect(r1.needsClarification).toBe(true);
    expect(r1.message.toLowerCase()).toMatch(/ahl|average hearing loss|db/);
    // T2: chip AHL answer — resolver sets both ears to 65
    const r2 = await processChatV2(id, "65 dB");
    // All data present (path=nid, left=65, right=65, age=55) → confirmation shown
    expect(r2.needsClarification).toBe(true);
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(65);
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(65);
    expect(h.extractedFacts[HEARING_FK_AGE]?.value).toBe(55);
    expect(h.pendingObservations).toHaveLength(0);
    // T3: confirm → PI%
    const r3 = await processChatV2(id, "Confirmed");
    expect(r3.message).toMatch(/PI%/);
  });

  it("NID: chip AHL resolves both ears to same value, full pipeline completes", async () => {
    // The pending obs resolver for missingEar='both' applies one AHL value to both ears.
    // This is the correct behavior for cases where both ears have equal loss.
    const id = sid("nid-chip-ahl");
    await processChatV2(id, "noise-induced deafness age 48");
    // T2: chip 55 dB → both=55, all data ready
    const r2 = await processChatV2(id, "55 dB");
    // System ready → confirmation (needsClarification=true is expected: doctor must confirm)
    expect(r2.needsClarification).toBe(true);
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(55);
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(55);
    // T3: confirm → PI%
    const r3 = await processChatV2(id, "Confirmed");
    expect(r3.message).toMatch(/PI%/);
  });
});

// ── NID path: full pipeline ─────────────────────────────────────────────────

describe("NID path — full assessment pipeline", () => {
  it("NID complete T1 → confirm → response contains PI%", async () => {
    // After all NID facts are extracted, the system presents a confirmation prompt
    // (needsClarification is true — doctor must respond). T2 "Confirmed" executes assessment.
    const id = sid("nid-full-pipeline");
    const r1 = await processChatV2(id, "noise-induced deafness left 65 dB right 70 dB age 55");
    expect(r1.route.systems).toContain("hearing");
    // T2: confirm
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });

  it("NID 3-turn: path+age T1, AHL chip T2, Confirmed T3 → PI%", async () => {
    // When AHL is the only missing field (path+age in T1), resolving it via chip in T2
    // makes the system immediately ready. T3 "Confirmed" executes the assessment.
    const id = sid("nid-3turn-pipeline");
    await processChatV2(id, "noise-induced hearing loss age 55");
    await processChatV2(id, "70 dB");
    const r3 = await processChatV2(id, "Confirmed");
    expect(r3.message).toMatch(/PI%/);
  });

  it("NID with age > 50: presbycusis deduction appears in rendered output", async () => {
    const id = sid("nid-presbycusis");
    // Age 65 → deduction = 0.5% × (65-50) = 7.5%
    await processChatV2(id, "NID left 75 dB right 80 dB age 65");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message.toLowerCase()).toMatch(/presbycusis|deduction/);
    expect(r2.message).toMatch(/PI%/);
  });
});

// ── Injury path: extraction ─────────────────────────────────────────────────

describe("Injury path — extraction", () => {
  it("right ear injury with AHL → path + affected ear + rightEarAhl extracted", async () => {
    const id = sid("injury-right-complete");
    await processChatV2(id, "right ear injury, AHL 90 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("injury");
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(90);
  });

  it("left ear accident with AHL → left path extracted", async () => {
    // Use "AHL 75 dB" so the generic AHL extractor binds 75 to the known left ear.
    const id = sid("injury-left-complete");
    await processChatV2(id, "left ear accident, AHL 75 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("injury");
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("left");
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(75);
  });

  it("'left-sided' phrasing → AFFECTED_LEFT_RE matches left ear", async () => {
    const id = sid("injury-leftsided");
    await processChatV2(id, "left-sided hearing loss after injury, AHL 80 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("left");
  });

  it("'in the left ear' phrasing → left ear detected", async () => {
    const id = sid("injury-in-the-left-ear");
    await processChatV2(id, "hearing loss in the left ear following accident, AHL 70 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("left");
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(70);
  });

  it("generic AHL is bound to the known affected ear", async () => {
    // "injury to the right ear, AHL 75 dB" — AHL has no left/right qualifier
    // The extractor must bind it to the right ear via the generic fallback.
    const id = sid("injury-generic-ahl");
    await processChatV2(id, "injury to the right ear, AHL 75 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(75);
  });
});

// ── Injury path: clarification roundtrips ──────────────────────────────────

describe("Injury path — clarification roundtrips", () => {
  it("injury with no ear side → clarification asks which ear", async () => {
    const id = sid("injury-no-ear");
    const r1 = await processChatV2(id, "hearing loss after accident");
    expect(r1.needsClarification).toBe(true);
    expect(r1.message.toLowerCase()).toMatch(/which ear|left|right/);
  });

  it("injury with AHL but unknown ear → asks which ear before AHL", async () => {
    // Even with an AHL value, if the ear side is unknown the ear question comes first
    const id = sid("injury-ahl-no-ear");
    const r1 = await processChatV2(id, "hearing injury, 80 dB");
    expect(r1.needsClarification).toBe(true);
    expect(r1.message.toLowerCase()).toMatch(/which ear|left ear|right ear/);
  });

  it("ear side given in T2 resolves the ear question, then asks for AHL", async () => {
    const id = sid("injury-ear-in-t2");
    await processChatV2(id, "hearing loss after accident");
    const r2 = await processChatV2(id, "right ear");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
    // AHL still needed — should ask for it
    expect(r2.needsClarification).toBe(true);
    expect(r2.message.toLowerCase()).toMatch(/ahl|db|average hearing/);
  });
});

// ── Injury path: full pipeline ──────────────────────────────────────────────

describe("Injury path — full assessment pipeline", () => {
  it("right ear injury full pipeline → confirm → PI%", async () => {
    // After all injury facts extracted in T1, confirmation is presented
    // (needsClarification=true — doctor must confirm). T2 executes assessment.
    const id = sid("injury-right-pipeline");
    const r1 = await processChatV2(id, "right ear injury AHL 90 dB");
    expect(r1.route.systems).toContain("hearing");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });

  it("left ear injury multi-turn → confirm → PI%", async () => {
    const id = sid("injury-left-pipeline");
    await processChatV2(id, "left ear trauma");
    await processChatV2(id, "75 dB");
    const r3 = await processChatV2(id, "Confirmed");
    expect(r3.message).toMatch(/PI%/);
  });
});

// ── Path ambiguity ──────────────────────────────────────────────────────────

describe("Path ambiguity — clarification roundtrips", () => {
  it("no NID/injury keyword → clarification asks NID or injury", async () => {
    const id = sid("path-unknown");
    const r1 = await processChatV2(id, "patient has hearing loss, AHL 65 dB");
    expect(r1.needsClarification).toBe(true);
    expect(r1.message.toLowerCase()).toMatch(/noise-induced|nid|injury/);
  });

  it("path unknown T1, NID answer T2 → nid path extracted, then asks for AHL", async () => {
    const id = sid("path-resolves-nid");
    await processChatV2(id, "patient has hearing loss");
    const r2 = await processChatV2(id, "Noise-Induced Deafness (NID)");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("nid");
    // No AHL yet — should ask for it
    expect(r2.needsClarification).toBe(true);
    expect(r2.message.toLowerCase()).toMatch(/ahl|db|average hearing/);
  });

  it("path unknown T1, injury answer T2 → injury path extracted, then asks which ear", async () => {
    const id = sid("path-resolves-injury");
    await processChatV2(id, "patient has hearing loss");
    const r2 = await processChatV2(id, "Injury/Accident");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_PATH]?.value).toBe("injury");
    expect(r2.needsClarification).toBe(true);
    expect(r2.message.toLowerCase()).toMatch(/which ear|left ear|right ear/);
  });

  it("tinnitus alone with no path keyword → clarification asks NID or injury", async () => {
    const id = sid("tinnitus-alone");
    const r1 = await processChatV2(id, "patient reports tinnitus");
    expect(r1.needsClarification).toBe(true);
    expect(r1.message.toLowerCase()).toMatch(/noise-induced|nid|injury/);
    // Tinnitus should still be captured despite the path being unknown
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_TINNITUS]?.value).toBe(true);
  });
});

// ── Instance scoping ────────────────────────────────────────────────────────

describe("Instance scoping", () => {
  it("right-ear injury: leftEarAhl is NOT stored in extractedFacts (scoped out)", async () => {
    // Input mentions both ears' AHL values, but only right-ear data should be kept
    const id = sid("scope-right-ear");
    await processChatV2(id, "right ear injury, left 65 dB right 80 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(80);
    // Left-ear AHL must be stripped by scopeFactsToInstance
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]).toBeUndefined();
  });

  it("left-ear injury: rightEarAhl is NOT stored in extractedFacts (scoped out)", async () => {
    const id = sid("scope-left-ear");
    await processChatV2(id, "left ear trauma, left 75 dB right 80 dB");
    const h = hearingFacts(id);
    expect(h.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("left");
    expect(h.extractedFacts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(75);
    // Right-ear AHL must be stripped
    expect(h.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]).toBeUndefined();
  });

  it("NID full pipeline with tinnitus: tinnitus note appears in rendered result", async () => {
    const id = sid("nid-tinnitus-render");
    await processChatV2(id, "NID left 65 dB right 70 dB age 55, with tinnitus");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message.toLowerCase()).toMatch(/tinnitus/);
  });
});
