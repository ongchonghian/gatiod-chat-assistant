import { describe, expect, it } from "vitest";
import { validateSpineReadiness } from "../../../src/v2/readiness/spine.js";
import { buildSpineArgs } from "../../../src/v2/argBuilders/spine.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import { SP_FK_REGION, SP_FK_ENTRIES } from "../../../src/v2/extractors/spine.js";
import type { SpineCategoryEntryFact } from "../../../src/v2/extractors/spine.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T): import("../../../src/v2/contracts.js").ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.spine, extractedFacts: facts };
}

function entry(overrides: Partial<SpineCategoryEntryFact> = {}): SpineCategoryEntryFact {
  return {
    diagnosisCategory: "fractures_dislocations",
    severityKey: "asia_d",
    monoparesisHalving: false,
    bladderBowelSeverity: "none",
    discCordInvolvement: false,
    spondylolysisPathway: "acute_traumatic",
    ...overrides,
  };
}

// ── Readiness validator ───────────────────────────────────────────────────────

describe("validateSpineReadiness", () => {
  it("blocks when pending observations exist", () => {
    const state: V2SystemState = {
      ...defaultV2SessionState().systems.spine,
      extractedFacts: { [SP_FK_REGION]: fact("cervical") },
      pendingObservations: [{
        id: "obs1", system: "spine", type: "severity_bracket",
        sourceText: "test", parsed: {}, missingFields: ["severityKey"],
        clarificationQuestion: "Which severity?", candidateAnswers: [],
        createdAt: nowIso(), updatedAt: nowIso(),
      }],
    };
    const r = validateSpineReadiness(state);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when region missing", () => {
    const r = validateSpineReadiness(stateWith({
      [SP_FK_ENTRIES]: fact([entry()]),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_region");
    expect(r.candidateAnswers).toContain("Cervical (C1–C7)");
  });

  it("blocks when no entries", () => {
    const r = validateSpineReadiness(stateWith({ [SP_FK_REGION]: fact("cervical") }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_finding");
  });

  it("blocks when entry has empty severityKey", () => {
    const r = validateSpineReadiness(stateWith({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry({ severityKey: "" })]),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_severity");
  });

  it("blocks when disc entry has cord involvement (should reroute)", () => {
    const r = validateSpineReadiness(stateWith({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry({
        diagnosisCategory: "intervertebral_disc",
        severityKey: "disc31_persistent_motor_or_motor_sensory",
        discCordInvolvement: true,
      })]),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("disc_cord_reroute");
  });

  it("is ready with single complete entry", () => {
    const r = validateSpineReadiness(stateWith({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry()]),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with multiple complete entries", () => {
    const r = validateSpineReadiness(stateWith({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([
        entry({ diagnosisCategory: "fractures_dislocations", severityKey: "mild_sensory_motor" }),
        entry({ diagnosisCategory: "intervertebral_disc", severityKey: "disc31_residual" }),
      ]),
    }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ───────────────────────────────────────────────────────────────

describe("buildSpineArgs", () => {
  it("fails when region is missing", () => {
    const r = buildSpineArgs({ [SP_FK_ENTRIES]: fact([entry()]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("region: required");
  });

  it("fails when entries is empty", () => {
    const r = buildSpineArgs({ [SP_FK_REGION]: fact("cervical") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors?.some((e) => /categoryEntries/i.test(e))).toBe(true);
  });

  it("builds valid args for cervical fracture ASIA D", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry()]),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/v2/argBuilders/spine.js").SpineValue;
      expect(args.region).toBe("cervical");
      expect(args.categoryEntries[0].diagnosisCategory).toBe("fractures_dislocations");
      expect(args.categoryEntries[0].severityKey).toBe("asia_d");
      expect(r.toolName).toBe("assess_spine");
      expect(r.provenance.factsHash).toHaveLength(16);
    }
  });

  it("builds valid args with monoparesis modifier", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry({ monoparesisHalving: true })]),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/v2/argBuilders/spine.js").SpineValue;
      expect(args.categoryEntries[0].monoparesisHalving).toBe(true);
    }
  });

  it("builds valid args with bladder/bowel add-on", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("thoraco_lumbar"),
      [SP_FK_ENTRIES]: fact([entry({
        diagnosisCategory: "spinal_cord_injury",
        severityKey: "asia_c",
        bladderBowelSeverity: "incomplete_both",
      })]),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/v2/argBuilders/spine.js").SpineValue;
      expect(args.categoryEntries[0].bladderBowelSeverity).toBe("incomplete_both");
    }
  });

  it("fails when severity is invalid for category", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry({ severityKey: "disc31_residual" })]), // disc key in fracture category
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors?.some((e) => /not valid/i.test(e))).toBe(true);
  });

  it("fails when severity not available for region", () => {
    // spondy_preexisting_residual only valid for lumbo_sacral
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry({
        diagnosisCategory: "spondylolysis_spondylolisthesis",
        severityKey: "spondy_preexisting_residual",
        spondylolysisPathway: "pre_existing_superimposed",
      })]),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors?.some((e) => /not available/i.test(e))).toBe(true);
  });

  it("builds valid args for disc prolapse", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("lumbo_sacral"),
      [SP_FK_ENTRIES]: fact([entry({
        diagnosisCategory: "intervertebral_disc",
        severityKey: "disc31_persistent_motor_or_motor_sensory",
      })]),
    });
    expect(r.ok).toBe(true);
  });

  it("builds valid args for chronic pain attributable", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("cervical"),
      [SP_FK_ENTRIES]: fact([entry({
        diagnosisCategory: "chronic_pain_normal_mri",
        severityKey: "chronic_pain_attributable",
      })]),
    });
    expect(r.ok).toBe(true);
  });

  it("builds valid args for spondylolysis pre-existing lumbo-sacral", () => {
    const r = buildSpineArgs({
      [SP_FK_REGION]: fact("lumbo_sacral"),
      [SP_FK_ENTRIES]: fact([entry({
        diagnosisCategory: "spondylolysis_spondylolisthesis",
        severityKey: "spondy_preexisting_chronic",
        spondylolysisPathway: "pre_existing_superimposed",
      })]),
    });
    expect(r.ok).toBe(true);
  });
});
