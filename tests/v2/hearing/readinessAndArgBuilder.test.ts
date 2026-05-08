import { describe, expect, it } from "vitest";
import { validateHearingReadiness } from "../../../src/v2/readiness/hearing.js";
import { buildHearingArgs } from "../../../src/v2/argBuilders/hearing.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
  HEARING_FK_OCCUPATIONAL_YEARS,
} from "../../../src/v2/extractors/hearing.js";
import type { HearingValue } from "../../../src/engine/hearingData.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.hearing, extractedFacts: facts };
}

function stateWithPending(facts: V2SystemFacts): V2SystemState {
  return {
    ...defaultV2SessionState().systems.hearing,
    extractedFacts: facts,
    pendingObservations: [{
      id: "obs1", system: "hearing", type: "hearing_value",
      sourceText: "test", parsed: { subtype: "hearing_path" }, missingFields: ["path"],
      clarificationQuestion: "NID or injury?", createdAt: nowIso(), updatedAt: nowIso(),
    }],
  };
}

// ── Readiness validator ────────────────────────────────────────────────────────

describe("validateHearingReadiness", () => {
  it("blocks when pending observations exist", () => {
    const r = validateHearingReadiness(stateWithPending({}));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when path is missing", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_path");
    expect(r.candidateAnswers).toContain("Noise-Induced Deafness (NID)");
    expect(r.candidateAnswers).toContain("Injury/Accident");
  });

  it("blocks NID when both AHLs missing", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_AGE]: fact(55),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_ahl");
    expect(r.clarificationQuestion).toMatch(/both ears/i);
  });

  it("blocks NID when left AHL missing", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
      [HEARING_FK_AGE]: fact(55),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_ahl");
    expect(r.clarificationQuestion).toMatch(/left ear/i);
  });

  it("blocks NID when age missing", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_age");
  });

  it("is ready for NID with both AHLs and age", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
      [HEARING_FK_AGE]: fact(55),
    }));
    expect(r.ready).toBe(true);
  });

  it("blocks injury when affected ear missing", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_affected_ear");
  });

  it("blocks injury when affected ear AHL missing", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("left"),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_ahl");
    expect(r.clarificationQuestion).toMatch(/left ear/i);
  });

  it("is ready for injury with affected ear and AHL", () => {
    const r = validateHearingReadiness(stateWith({
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("left"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
    }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ────────────────────────────────────────────────────────────────

describe("buildHearingArgs", () => {
  it("fails when path is missing", () => {
    const r = buildHearingArgs({ [HEARING_FK_LEFT_EAR_AHL]: fact(65) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("path: required");
  });

  it("fails NID when AHL missing", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_AGE]: fact(55),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors?.some(e => e.includes("required"))).toBe(true);
  });

  it("builds valid NID args", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
      [HEARING_FK_AGE]: fact(55),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as HearingValue;
      expect(args.path).toBe("nid");
      if (args.path === "nid") {
        expect(args.leftEarAhl).toBe(65);
        expect(args.rightEarAhl).toBe(70);
        expect(args.age).toBe(55);
      }
      expect(r.toolName).toBe("assess_hearing");
      expect(r.provenance.factsHash).toHaveLength(16);
    }
  });

  it("includes optional occupational years when provided", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
      [HEARING_FK_AGE]: fact(55),
      [HEARING_FK_OCCUPATIONAL_YEARS]: fact(25),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as HearingValue;
      if (args.path === "nid") {
        expect(args.occupationalExposureYears).toBe(25);
      }
      expect(r.provenance.userSupplied).toContain(HEARING_FK_OCCUPATIONAL_YEARS);
    }
  });

  it("fails injury when affected ear missing", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("affectedEars: required");
  });

  it("builds valid injury args for left ear", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("left"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as HearingValue;
      expect(args.path).toBe("injury");
      if (args.path === "injury") {
        expect(args.affectedEars).toBe("left");
        expect(args.leftEarAhl).toBe(65);
      }
      expect(r.toolName).toBe("assess_hearing");
    }
  });

  it("builds valid injury args for right ear", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("right"),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as HearingValue;
      if (args.path === "injury") {
        expect(args.affectedEars).toBe("right");
        expect(args.rightEarAhl).toBe(70);
      }
    }
  });

  it("includes user-supplied fact keys in provenance", () => {
    const r = buildHearingArgs({
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
      [HEARING_FK_AGE]: fact(55),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.userSupplied).toContain(HEARING_FK_PATH);
      expect(r.provenance.userSupplied).toContain(HEARING_FK_LEFT_EAR_AHL);
      expect(r.provenance.userSupplied).toContain(HEARING_FK_RIGHT_EAR_AHL);
      expect(r.provenance.userSupplied).toContain(HEARING_FK_AGE);
    }
  });
});
