import { describe, expect, it } from "vitest";
import { validateGastroReadiness } from "../../../src/v2/readiness/gastro.js";
import { buildGastroArgs, type GastroValue } from "../../../src/v2/argBuilders/gastro.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  GASTRO_FK_SUBSYSTEM,
  GASTRO_FK_COLONAL_SUBPATH,
  GASTRO_FK_LIVER_BILIARY_SUBPATH,
  GASTRO_FK_BRACKET_INDEX,
  GASTRO_FK_PI_PERCENT,
  GASTRO_FK_WEIGHT_LOSS,
} from "../../../src/v2/extractors/gastro.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.gastro_digestive, extractedFacts: facts };
}

function stateWithPending(facts: V2SystemFacts): V2SystemState {
  return {
    ...defaultV2SessionState().systems.gastro_digestive,
    extractedFacts: facts,
    pendingObservations: [{
      id: "obs1", system: "gastro_digestive", type: "other",
      sourceText: "test", parsed: { subtype: "gastro_subsystem" }, missingFields: ["subSystem"],
      clarificationQuestion: "Which subsystem?", createdAt: nowIso(), updatedAt: nowIso(),
    }],
  };
}

// ── Readiness validator ────────────────────────────────────────────────────────

describe("validateGastroReadiness", () => {
  it("blocks when pending observations exist", () => {
    const state = stateWithPending({ [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive") });
    const r = validateGastroReadiness(state);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when subsystem is missing", () => {
    const r = validateGastroReadiness(stateWith({}));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_subsystem");
    expect(r.candidateAnswers).toContain("Upper GI");
    expect(r.candidateAnswers).toContain("Hernia");
  });

  it("blocks colonicRectalAnal when colonal sub-path missing", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("colonicRectalAnal"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(5),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_colonal_subpath");
  });

  it("blocks liverBiliary when liver sub-path missing", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("liverBiliary"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(3),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_liver_biliary_subpath");
  });

  it("blocks when bracket index is missing", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_PI_PERCENT]: fact(5),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_bracket");
  });

  it("blocks when PI% is missing", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_pi_percent");
  });

  it("is ready for upper digestive with subsystem, bracket, PI%", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_BRACKET_INDEX]: fact(1),
      [GASTRO_FK_PI_PERCENT]: fact(8),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready for herniation with subsystem, bracket, PI%", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("herniation"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(5),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready for colonicRectalAnal with colonal sub-path present", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("colonicRectalAnal"),
      [GASTRO_FK_COLONAL_SUBPATH]: fact("colonicRectal"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(3),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready for liverBiliary with liver sub-path present", () => {
    const r = validateGastroReadiness(stateWith({
      [GASTRO_FK_SUBSYSTEM]: fact("liverBiliary"),
      [GASTRO_FK_LIVER_BILIARY_SUBPATH]: fact("liver"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(3),
    }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ────────────────────────────────────────────────────────────────

describe("buildGastroArgs", () => {
  it("fails when subsystem is missing", () => {
    const r = buildGastroArgs({ [GASTRO_FK_BRACKET_INDEX]: fact(0), [GASTRO_FK_PI_PERCENT]: fact(5) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("subSystem: required");
  });

  it("fails when bracket index is missing", () => {
    const r = buildGastroArgs({ [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"), [GASTRO_FK_PI_PERCENT]: fact(5) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("selectedBracketIndex: required");
  });

  it("fails when PI% is missing", () => {
    const r = buildGastroArgs({ [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"), [GASTRO_FK_BRACKET_INDEX]: fact(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("piPercent: required");
  });

  it("fails Zod validation when colonicRectalAnal lacks colonal sub-path", () => {
    const r = buildGastroArgs({
      [GASTRO_FK_SUBSYSTEM]: fact("colonicRectalAnal"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(3),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors?.some(e => e.includes("colonalSubPath"))).toBe(true);
  });

  it("builds valid args for upper digestive", () => {
    const r = buildGastroArgs({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_BRACKET_INDEX]: fact(1),
      [GASTRO_FK_PI_PERCENT]: fact(15),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as GastroValue;
      expect(args.subSystem).toBe("upperDigestive");
      expect(args.selectedBracketIndex).toBe(1);
      expect(args.piPercent).toBe(15);
      expect(r.toolName).toBe("assess_gastro");
      expect(r.provenance.factsHash).toHaveLength(16);
    }
  });

  it("builds valid args for colonic with sub-path", () => {
    const r = buildGastroArgs({
      [GASTRO_FK_SUBSYSTEM]: fact("colonicRectalAnal"),
      [GASTRO_FK_COLONAL_SUBPATH]: fact("colonicRectal"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(3),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as GastroValue;
      expect(args.subSystem).toBe("colonicRectalAnal");
      expect(args.colonalSubPath).toBe("colonicRectal");
    }
  });

  it("builds valid args for herniation", () => {
    const r = buildGastroArgs({
      [GASTRO_FK_SUBSYSTEM]: fact("herniation"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(5),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as GastroValue;
      expect(args.subSystem).toBe("herniation");
      expect(args.colonalSubPath).toBeUndefined();
    }
  });

  it("includes weight loss when provided", () => {
    const r = buildGastroArgs({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_BRACKET_INDEX]: fact(2),
      [GASTRO_FK_PI_PERCENT]: fact(30),
      [GASTRO_FK_WEIGHT_LOSS]: fact(15),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as GastroValue;
      expect(args.weightLossPercent).toBe(15);
      expect(r.provenance.userSupplied).toContain(GASTRO_FK_WEIGHT_LOSS);
    }
  });

  it("fails Zod validation when PI% is out of bracket range", () => {
    const r = buildGastroArgs({
      [GASTRO_FK_SUBSYSTEM]: fact("upperDigestive"),
      [GASTRO_FK_BRACKET_INDEX]: fact(0),
      [GASTRO_FK_PI_PERCENT]: fact(50),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors?.some(e => e.includes("piPercent") && e.includes("out of range"))).toBe(true);
  });
});
