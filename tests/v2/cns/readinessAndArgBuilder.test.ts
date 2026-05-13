import { describe, expect, it } from "vitest";
import { validateCnsReadiness } from "../../../src/v2/readiness/cns.js";
import { buildCnsArgs } from "../../../src/v2/argBuilders/cns.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
  CNS_FK_G2, CNS_FK_G2_NEURO,
  CNS_FK_G3, CNS_FK_G4, CNS_FK_G4_PSYCH,
  CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL,
  CNS_FK_B_EQUILIBRIUM, CNS_FK_B_EQUILIBRIUM_ENT,
  CNS_FK_B_SWALLOWING, CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  CNS_FK_C_LIMBS,
} from "../../../src/v2/extractors/cns.js";

function nowIso() { return new Date().toISOString(); }

function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts, pendingCount = 0): V2SystemState {
  const base = defaultV2SessionState().systems.cns;
  const pending = pendingCount > 0
    ? Array.from({ length: pendingCount }, (_, i) => ({
        id: `obs${i}`, system: "cns" as const, type: "other" as const,
        sourceText: "test", parsed: { subtype: "cns_g1a_bracket" }, missingFields: [CNS_FK_G1A],
        clarificationQuestion: "Which bracket?", createdAt: nowIso(), updatedAt: nowIso(),
      }))
    : [];
  return { ...base, extractedFacts: facts, pendingObservations: pending };
}

// ── Readiness validator ────────────────────────────────────────────────────────

describe("validateCnsReadiness", () => {
  it("blocks when pending observations exist", () => {
    const r = validateCnsReadiness(stateWith({}, 1));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when no assessable finding", () => {
    const r = validateCnsReadiness(stateWith({}));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_finding");
    expect(r.candidateAnswers).toContain("Section A");
    expect(r.candidateAnswers).toContain("Section B");
    expect(r.candidateAnswers).toContain("Section C");
  });

  it("blocks for Group 2 non-zero without neuro confirmation", () => {
    const r = validateCnsReadiness(stateWith({ [CNS_FK_G2]: fact("ms_moderate") }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_g2_neuro_confirmation");
    expect(r.missingFields).toContain(CNS_FK_G2_NEURO);
  });

  it("blocks for Group 4 non-zero without psych confirmation", () => {
    const r = validateCnsReadiness(stateWith({ [CNS_FK_G4]: fact("em_mild") }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_g4_psych_confirmation");
    expect(r.missingFields).toContain(CNS_FK_G4_PSYCH);
  });

  it("blocks for equilibrium non-zero without ENT confirmation", () => {
    const r = validateCnsReadiness(stateWith({ [CNS_FK_B_EQUILIBRIUM]: fact("eq_minimal") }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_equilibrium_ent_confirmation");
    expect(r.missingFields).toContain(CNS_FK_B_EQUILIBRIUM_ENT);
  });

  it("is ready with Section A G1B only (no confirmation needed)", () => {
    const r = validateCnsReadiness(stateWith({ [CNS_FK_G1B]: fact("e_predictable") }));
    expect(r.ready).toBe(true);
  });

  it("is ready with Section B olfaction only", () => {
    const r = validateCnsReadiness(stateWith({ [CNS_FK_B_OLFACTION]: fact("ol_anosmia") }));
    expect(r.ready).toBe(true);
  });

  it("is ready with Group 2 + neuro confirmed", () => {
    const r = validateCnsReadiness(stateWith({
      [CNS_FK_G2]: fact("ms_severe"),
      [CNS_FK_G2_NEURO]: fact(true),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with Group 4 + psych confirmed", () => {
    const r = validateCnsReadiness(stateWith({
      [CNS_FK_G4]: fact("em_moderate"),
      [CNS_FK_G4_PSYCH]: fact(true),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with equilibrium + ENT confirmed", () => {
    const r = validateCnsReadiness(stateWith({
      [CNS_FK_B_EQUILIBRIUM]: fact("eq_minimal"),
      [CNS_FK_B_EQUILIBRIUM_ENT]: fact(true),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with Section C paralysed limbs", () => {
    const r = validateCnsReadiness(stateWith({ [CNS_FK_C_LIMBS]: fact(["both_upper_limbs"]) }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ───────────────────────────────────────────────────────────────

describe("buildCnsArgs", () => {
  it("returns toolName assess_cns", () => {
    const r = buildCnsArgs({ [CNS_FK_G1B]: fact("e_predictable") });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.toolName).toBe("assess_cns");
  });

  it("zero-fills all unspecified Section A groups", () => {
    const r = buildCnsArgs({ [CNS_FK_B_OLFACTION]: fact("ol_anosmia") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/cnsAssessmentData.js").CnsValue;
      expect(args.group1Consciousness.value).toBe(0);
      expect(args.group1Episodic.value).toBe(0);
      expect(args.group1Arousal.value).toBe(0);
      expect(args.group2.value).toBe(0);
    }
  });

  it("converts bracketId string to GroupSelection using bracket.min", () => {
    const r = buildCnsArgs({ [CNS_FK_G1B]: fact("e_predictable") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/cnsAssessmentData.js").CnsValue;
      expect(args.group1Episodic.bracketId).toBe("e_predictable");
      expect(typeof args.group1Episodic.value).toBe("number");
      expect(args.group1Episodic.value).toBeGreaterThan(0);
    }
  });

  it("includes paralysed limbs in args", () => {
    const r = buildCnsArgs({ [CNS_FK_C_LIMBS]: fact(["both_upper_limbs", "both_lower_limbs_or_feet"]) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/cnsAssessmentData.js").CnsValue;
      expect(args.paralysedLimbs).toContain("both_upper_limbs");
      expect(args.paralysedLimbs).toContain("both_lower_limbs_or_feet");
    }
  });

  it("fails on invalid limb ID", () => {
    const r = buildCnsArgs({ [CNS_FK_C_LIMBS]: fact(["not_a_real_limb"]) });
    expect(r.ok).toBe(false);
  });

  it("tracks userSupplied and builderZeroFilled provenance", () => {
    const r = buildCnsArgs({ [CNS_FK_G3]: fact("co_moderate") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.userSupplied).toContain(CNS_FK_G3);
      expect(r.provenance.builderZeroFilled).toContain(CNS_FK_G1A);
    }
  });

  it("sets neuro/psych/ent confirmation flags correctly", () => {
    const r = buildCnsArgs({
      [CNS_FK_G2]: fact("ms_severe"),
      [CNS_FK_G2_NEURO]: fact(true),
      [CNS_FK_G4]: fact("em_moderate"),
      [CNS_FK_G4_PSYCH]: fact(true),
      [CNS_FK_B_EQUILIBRIUM]: fact("eq_minimal"),
      [CNS_FK_B_EQUILIBRIUM_ENT]: fact(true),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/cnsAssessmentData.js").CnsValue;
      expect(args.group2NeuropsychologistConfirmed).toBe(true);
      expect(args.group4PsychiatristConfirmed).toBe(true);
      expect(args.equilibriumEntConfirmed).toBe(true);
    }
  });

  it("includes all Section B components when set", () => {
    const r = buildCnsArgs({
      [CNS_FK_B_OLFACTION]:    fact("ol_anosmia"),
      [CNS_FK_B_FACIAL]:       fact("fn_mild_unilateral"),
      [CNS_FK_B_SWALLOWING]:   fact("sw_mild"),
      [CNS_FK_B_STATION_GAIT]: fact("sg_walks_difficult"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/cnsAssessmentData.js").CnsValue;
      expect(args.olfaction.bracketId).toBe("ol_anosmia");
      expect(args.facialNerve.bracketId).toBe("fn_mild_unilateral");
      expect(args.swallowing.bracketId).toBe("sw_mild");
      expect(args.stationGait.bracketId).toBe("sg_walks_difficult");
    }
  });
});
