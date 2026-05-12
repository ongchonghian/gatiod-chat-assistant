import { describe, expect, it } from "vitest";
import { validateVisualReadiness } from "../../../src/v2/readiness/visual.js";
import { buildVisualArgs } from "../../../src/v2/argBuilders/visual.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  VISUAL_FK_LEFT_ACUITY, VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD,  VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_LEFT_MODIFIERS, VISUAL_FK_RIGHT_MODIFIERS,
  VISUAL_FK_LEFT_CONDITIONS, VISUAL_FK_RIGHT_CONDITIONS,
  VISUAL_FK_DIPLOPIA,
  VISUAL_FK_LEFT_ENUCLEATED, VISUAL_FK_RIGHT_ENUCLEATED,
} from "../../../src/v2/extractors/visual.js";
import type { VisualValue } from "../../../src/engine/visualAssessmentData.js";

function nowIso() { return new Date().toISOString(); }

function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts, pendingCount = 0): V2SystemState {
  const base = defaultV2SessionState().systems.visual;
  const pending = pendingCount > 0
    ? Array.from({ length: pendingCount }, (_, i) => ({
        id: `obs${i}`, system: "visual" as const, type: "visual_value" as const,
        sourceText: "test", parsed: { subtype: "visual_diplopia_zone" }, missingFields: [VISUAL_FK_DIPLOPIA],
        clarificationQuestion: "Which zone?", createdAt: nowIso(), updatedAt: nowIso(),
      }))
    : [];
  return { ...base, extractedFacts: facts, pendingObservations: pending };
}

// ── Readiness validator ────────────────────────────────────────────────────────

describe("validateVisualReadiness", () => {
  it("blocks when pending observations exist", () => {
    const r = validateVisualReadiness(stateWith({}, 1));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when no visual facts present", () => {
    const r = validateVisualReadiness(stateWith({}));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_finding");
    expect(r.candidateAnswers).toContain("Right eye");
    expect(r.candidateAnswers).toContain("Left eye");
  });

  it("is ready with right eye acuity only", () => {
    const r = validateVisualReadiness(stateWith({ [VISUAL_FK_RIGHT_ACUITY]: fact("6_12") }));
    expect(r.ready).toBe(true);
  });

  it("is ready with left eye field only", () => {
    const r = validateVisualReadiness(stateWith({ [VISUAL_FK_LEFT_FIELD]: fact("field_90_100") }));
    expect(r.ready).toBe(true);
  });

  it("is ready with diplopia only", () => {
    const r = validateVisualReadiness(stateWith({ [VISUAL_FK_DIPLOPIA]: fact("dip_uncorrectable") }));
    expect(r.ready).toBe(true);
  });

  it("is ready with enucleation", () => {
    const r = validateVisualReadiness(stateWith({ [VISUAL_FK_LEFT_ENUCLEATED]: fact(true) }));
    expect(r.ready).toBe(true);
  });

  it("is ready with modifiers only", () => {
    const r = validateVisualReadiness(stateWith({ [VISUAL_FK_RIGHT_MODIFIERS]: fact(["accommodation"]) }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ───────────────────────────────────────────────────────────────

describe("buildVisualArgs", () => {
  it("returns toolName assess_visual", () => {
    const r = buildVisualArgs({ [VISUAL_FK_RIGHT_ACUITY]: fact("6_12") });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.toolName).toBe("assess_visual");
  });

  it("defaults diplopiaId to dip_none when not supplied", () => {
    const r = buildVisualArgs({ [VISUAL_FK_RIGHT_ACUITY]: fact("6_12") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as VisualValue;
      expect(args.diplopiaId).toBe("dip_none");
    }
  });

  it("zero-fills unspecified eye fields to empty string", () => {
    const r = buildVisualArgs({ [VISUAL_FK_RIGHT_ACUITY]: fact("6_24") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as VisualValue;
      expect(args.leftEye.acuityId).toBe("");
      expect(args.leftEye.fieldId).toBe("");
      expect(args.leftEye.functionalModifiers).toEqual([]);
      expect(args.leftEye.specificConditions).toEqual([]);
    }
  });

  it("uses lt_6_60 and field_lt20 for enucleated left eye", () => {
    const r = buildVisualArgs({ [VISUAL_FK_LEFT_ENUCLEATED]: fact(true) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as VisualValue;
      expect(args.leftEye.acuityId).toBe("lt_6_60");
      expect(args.leftEye.fieldId).toBe("field_lt20");
      expect(args.leftEye.functionalModifiers).toEqual([]);
    }
  });

  it("uses lt_6_60 and field_lt20 for enucleated right eye", () => {
    const r = buildVisualArgs({ [VISUAL_FK_RIGHT_ENUCLEATED]: fact(true) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as VisualValue;
      expect(args.rightEye.acuityId).toBe("lt_6_60");
      expect(args.rightEye.fieldId).toBe("field_lt20");
    }
  });

  it("assembles full VisualValue from all per-eye facts", () => {
    const r = buildVisualArgs({
      [VISUAL_FK_RIGHT_ACUITY]:     fact("6_9"),
      [VISUAL_FK_RIGHT_FIELD]:      fact("field_90_100"),
      [VISUAL_FK_RIGHT_MODIFIERS]:  fact(["accommodation"]),
      [VISUAL_FK_RIGHT_CONDITIONS]: fact(["glaucoma"]),
      [VISUAL_FK_LEFT_ACUITY]:      fact("6_24"),
      [VISUAL_FK_LEFT_FIELD]:       fact("field_70_80"),
      [VISUAL_FK_LEFT_MODIFIERS]:   fact(["contrast_glare"]),
      [VISUAL_FK_LEFT_CONDITIONS]:  fact(["cataract"]),
      [VISUAL_FK_DIPLOPIA]:         fact("dip_uncorrectable"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as VisualValue;
      expect(args.rightEye.acuityId).toBe("6_9");
      expect(args.rightEye.fieldId).toBe("field_90_100");
      expect(args.rightEye.functionalModifiers).toContain("accommodation");
      expect(args.rightEye.specificConditions).toContain("glaucoma");
      expect(args.leftEye.acuityId).toBe("6_24");
      expect(args.leftEye.fieldId).toBe("field_70_80");
      expect(args.leftEye.functionalModifiers).toContain("contrast_glare");
      expect(args.leftEye.specificConditions).toContain("cataract");
      expect(args.diplopiaId).toBe("dip_uncorrectable");
    }
  });

  it("tracks userSupplied and builderZeroFilled provenance", () => {
    const r = buildVisualArgs({ [VISUAL_FK_RIGHT_ACUITY]: fact("6_12"), [VISUAL_FK_DIPLOPIA]: fact("dip_none") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.userSupplied).toContain(VISUAL_FK_RIGHT_ACUITY);
      expect(r.provenance.userSupplied).toContain(VISUAL_FK_DIPLOPIA);
      expect(r.provenance.builderZeroFilled).toContain(VISUAL_FK_LEFT_ACUITY);
    }
  });

  it("passes schema validation with all fields empty (all defaults)", () => {
    const r = buildVisualArgs({});
    expect(r.ok).toBe(true);
  });
});
