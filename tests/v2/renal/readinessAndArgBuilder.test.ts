import { describe, expect, it } from "vitest";
import { validateRenalReadiness } from "../../../src/v2/readiness/renal.js";
import { buildRenalArgs } from "../../../src/v2/argBuilders/renal.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  RENAL_FK_SEX,
  RENAL_FK_SERUM_CREATININE,
  RENAL_FK_CREATININE_CLEARANCE,
  RENAL_FK_CKD_STAGE,
  RENAL_FK_CLINICAL_SEVERITY,
  RENAL_FK_SOLITARY_KIDNEY,
  RENAL_FK_PROVISIONAL_AWARD,
} from "../../../src/v2/extractors/renal.js";
import type { RenalValue } from "../../../src/engine/renalData.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.renal, extractedFacts: facts };
}

// ── Readiness validator ────────────────────────────────────────────────────────

describe("validateRenalReadiness", () => {
  it("blocks when pending observations exist", () => {
    const state: V2SystemState = {
      ...defaultV2SessionState().systems.renal,
      pendingObservations: [{
        id: "obs1", system: "renal", type: "other",
        sourceText: "test", parsed: { subtype: "egfr_disambiguation" }, missingFields: [],
        clarificationQuestion: "Which method?", createdAt: nowIso(), updatedAt: nowIso(),
      }],
    };
    const r = validateRenalReadiness(state);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when sex is missing", () => {
    const r = validateRenalReadiness(stateWith({
      [RENAL_FK_SERUM_CREATININE]: fact(180),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_sex");
    expect(r.candidateAnswers).toContain("Male");
    expect(r.candidateAnswers).toContain("Female");
  });

  it("blocks when no classifying input", () => {
    const r = validateRenalReadiness(stateWith({
      [RENAL_FK_SEX]: fact("male"),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_classifying_input");
  });

  it("is ready with sex and serum creatinine", () => {
    const r = validateRenalReadiness(stateWith({
      [RENAL_FK_SEX]:              fact("male"),
      [RENAL_FK_SERUM_CREATININE]: fact(180),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with sex and CKD stage", () => {
    const r = validateRenalReadiness(stateWith({
      [RENAL_FK_SEX]:       fact("female"),
      [RENAL_FK_CKD_STAGE]: fact(3),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with sex and clinical severity", () => {
    const r = validateRenalReadiness(stateWith({
      [RENAL_FK_SEX]:              fact("male"),
      [RENAL_FK_CLINICAL_SEVERITY]: fact("persisting"),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with sex and creatinine clearance", () => {
    const r = validateRenalReadiness(stateWith({
      [RENAL_FK_SEX]:                   fact("female"),
      [RENAL_FK_CREATININE_CLEARANCE]:  fact(45),
    }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ────────────────────────────────────────────────────────────────

describe("buildRenalArgs", () => {
  it("fails when sex is missing", () => {
    const r = buildRenalArgs({ [RENAL_FK_SERUM_CREATININE]: fact(180) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("sex: required");
  });

  it("builds valid args for male with serum creatinine", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:              fact("male"),
      [RENAL_FK_SERUM_CREATININE]: fact(180),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RenalValue;
      expect(args.sex).toBe("male");
      expect(args.serumCreatinine).toBe(180);
      expect(args.creatinineClearance).toBeNull();
      expect(args.ckdStage).toBeNull();
      expect(args.clinicalSeverity).toBeNull();
      expect(r.toolName).toBe("assess_renal");
      expect(r.provenance.factsHash).toHaveLength(16);
    }
  });

  it("defaults solitaryKidney to false and provisionalAward to true", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:       fact("female"),
      [RENAL_FK_CKD_STAGE]: fact(3),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RenalValue;
      expect(args.solitaryKidney).toBe(false);
      expect(args.provisionalAward).toBe(true);
    }
  });

  it("builds valid args with solitary kidney", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:              fact("male"),
      [RENAL_FK_CKD_STAGE]:        fact(2),
      [RENAL_FK_SOLITARY_KIDNEY]:  fact(true),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RenalValue;
      expect(args.solitaryKidney).toBe(true);
    }
  });

  it("builds valid args with non-provisional award", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:              fact("female"),
      [RENAL_FK_SERUM_CREATININE]: fact(200),
      [RENAL_FK_PROVISIONAL_AWARD]: fact(false),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RenalValue;
      expect(args.provisionalAward).toBe(false);
    }
  });

  it("builds valid args with creatinine clearance", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:                  fact("male"),
      [RENAL_FK_CREATININE_CLEARANCE]: fact(38),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RenalValue;
      expect(args.creatinineClearance).toBe(38);
    }
  });

  it("builds valid args with clinical severity persisting", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:              fact("male"),
      [RENAL_FK_CLINICAL_SEVERITY]: fact("persisting"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RenalValue;
      expect(args.clinicalSeverity).toBe("persisting");
    }
  });

  it("includes user-supplied fact keys in provenance", () => {
    const r = buildRenalArgs({
      [RENAL_FK_SEX]:              fact("male"),
      [RENAL_FK_SERUM_CREATININE]: fact(180),
      [RENAL_FK_CKD_STAGE]:        fact(3),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.userSupplied).toContain(RENAL_FK_SEX);
      expect(r.provenance.userSupplied).toContain(RENAL_FK_SERUM_CREATININE);
      expect(r.provenance.userSupplied).toContain(RENAL_FK_CKD_STAGE);
    }
  });
});
