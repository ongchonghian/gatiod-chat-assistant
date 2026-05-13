import { describe, expect, it } from "vitest";
import {
  gradeSemanticCase,
  summarizeShadowResults,
  type SemanticGoldenCase,
} from "../../src/v2/semanticShadowGrader.js";
import type { SemanticInterpreterResult } from "../../src/v2/semanticInterpreter.js";
import type { SemanticInterpretation } from "../../src/v2/contracts.js";

// P1-A grader unit tests — runs in default CI without any LLM call.
// Verifies the grading rubric: candidate-system recall, legacy_deferred
// labeling, missing-field detection, no forbidden systems, and outcome
// classification.

const NOW = "2026-05-10T00:00:00.000Z";

function ok(interp: SemanticInterpretation): SemanticInterpreterResult {
  return { ok: true, interpretation: interp };
}

function makeInterpretation(
  overrides: Partial<SemanticInterpretation> = {},
): SemanticInterpretation {
  return {
    id: "interp-x",
    sourceText: "test",
    sourceHash: "h",
    candidateSystems: [],
    candidateFindings: [],
    unsupportedTerms: [],
    assumptions: [],
    requiresUserConsensus: true,
    createdAt: NOW,
    ...overrides,
  };
}

const goldenLowerLimbCns: SemanticGoldenCase = {
  id: "test-1",
  description: "lower_limb + cns expected",
  input: "Left common peroneal nerve lesion; Complete anosmia.",
  expected: {
    candidateSystems: ["lower_limb", "cns"],
    legacyDeferredSystems: ["cns"],
    requiredMissingFields: {
      lower_limb: ["partial vs total"],
    },
  },
};

describe("P1-A grader — candidate system recall", () => {
  it("scores 1.0 when all expected systems are detected", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "legacy_deferred", evidence: [], rationale: "x" },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.candidateSystemsRecall).toBe(1);
  });

  it("scores 0.5 when half of expected systems are detected", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.candidateSystemsRecall).toBe(0.5);
    expect(grade.notes.some((n) => n.includes("Missing expected candidate system: cns"))).toBe(true);
  });

  it("scores 0 when none are detected", () => {
    const interp = makeInterpretation();
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.candidateSystemsRecall).toBe(0);
  });
});

describe("P1-A grader — legacy_deferred labeling", () => {
  it("scores 1.0 when expected legacy systems carry legacy_deferred status", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "legacy_deferred", evidence: [], rationale: "x" },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.legacyDeferredLabeled).toBe(1);
  });

  it("scores 0 when CNS is mislabelled as structured_supported", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.legacyDeferredLabeled).toBe(0);
  });
});

describe("P1-A grader — missing-fields detection", () => {
  it("scores 1.0 when expected missing-field phrase appears in any finding", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "legacy_deferred", evidence: [], rationale: "x" },
      ],
      candidateFindings: [
        {
          system: "lower_limb",
          sourceSpan: "Left common peroneal nerve lesion",
          findingType: "neurological",
          proposedMapping: "lower-limb nerve",
          systemConfidence: 0.9,
          mappingConfidence: 0.9,
          completeness: "missing_calculation_fields",
          explicitlyStatedFields: [],
          inferredFields: [],
          missingFields: ["partial vs total loss"],
          calculationReady: false,
        },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.missingFieldsDetected).toBe(1);
  });

  it("scores 0 when expected missing-field phrase is absent", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "legacy_deferred", evidence: [], rationale: "x" },
      ],
      candidateFindings: [
        {
          system: "lower_limb",
          sourceSpan: "Left common peroneal nerve lesion",
          findingType: "neurological",
          proposedMapping: "lower-limb nerve",
          systemConfidence: 0.9,
          mappingConfidence: 0.9,
          completeness: "missing_calculation_fields",
          explicitlyStatedFields: [],
          inferredFields: [],
          missingFields: ["something else"],
          calculationReady: false,
        },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.scoredDimensions.missingFieldsDetected).toBe(0);
  });
});

describe("P1-A grader — forbidden systems", () => {
  it("scores 0 when a forbidden system appears", () => {
    const golden: SemanticGoldenCase = {
      id: "t",
      description: "single-system hearing",
      input: "Right ear AHL 90.",
      expected: {
        candidateSystems: ["hearing"],
        forbiddenSystems: ["spine", "cns"],
      },
    };
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "hearing", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "spine", confidence: 0.5, status: "structured_supported", evidence: [], rationale: "x" },
      ],
    });
    const grade = gradeSemanticCase(golden, ok(interp));
    expect(grade.scoredDimensions.noForbiddenSystems).toBe(0);
  });
});

describe("P1-A grader — outcome classification", () => {
  it("classifies a perfect grade as semantic_proposal_correct", () => {
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "legacy_deferred", evidence: [], rationale: "x" },
      ],
      candidateFindings: [
        {
          system: "lower_limb",
          sourceSpan: "Left common peroneal nerve lesion",
          findingType: "neurological",
          proposedMapping: "lower-limb",
          systemConfidence: 0.9,
          mappingConfidence: 0.9,
          completeness: "missing_calculation_fields",
          explicitlyStatedFields: [],
          inferredFields: [],
          missingFields: ["partial vs total loss"],
          calculationReady: false,
        },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.outcomeClass).toBe("semantic_proposal_correct");
    expect(grade.totalScore).toBe(1);
  });

  it("classifies a partial grade as semantic_proposal_partial", () => {
    // Detect lower_limb but miss CNS → 0.5 candidate-recall
    // Legacy deferred score 0 (CNS missing entirely)
    // Missing field detected (1.0)
    // No forbidden systems (1.0)
    // Total: 0.5*0.4 + 0*0.2 + 1*0.2 + 1*0.2 = 0.6 → fails
    // To land in partial (0.7..0.95), miss only legacy labeling:
    const interp = makeInterpretation({
      candidateSystems: [
        { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
        { system: "cns", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
      ],
      candidateFindings: [
        {
          system: "lower_limb",
          sourceSpan: "x",
          findingType: "neurological",
          proposedMapping: "x",
          systemConfidence: 0.9,
          mappingConfidence: 0.9,
          completeness: "missing_calculation_fields",
          explicitlyStatedFields: [],
          inferredFields: [],
          missingFields: ["partial vs total loss"],
          calculationReady: false,
        },
      ],
    });
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    // 1.0 * 0.4 + 0 * 0.2 + 1.0 * 0.2 + 1.0 * 0.2 = 0.8
    expect(grade.totalScore).toBeCloseTo(0.8, 5);
    expect(grade.outcomeClass).toBe("semantic_proposal_partial");
  });

  it("classifies a low-score grade as semantic_proposal_failed", () => {
    const interp = makeInterpretation();
    const grade = gradeSemanticCase(goldenLowerLimbCns, ok(interp));
    expect(grade.totalScore).toBeLessThan(0.7);
    expect(grade.outcomeClass).toBe("semantic_proposal_failed");
  });

  it("classifies a safety-validation failure as semantic_proposal_unsafe", () => {
    const failure: SemanticInterpreterResult = {
      ok: false,
      kind: "safety_validation_failed",
      message: "fabricated source span",
    };
    const grade = gradeSemanticCase(goldenLowerLimbCns, failure);
    expect(grade.outcomeClass).toBe("semantic_proposal_unsafe");
    expect(grade.hardGateFailures.length).toBeGreaterThan(0);
  });

  it("classifies a schema-validation failure as semantic_proposal_unsafe", () => {
    const failure: SemanticInterpreterResult = {
      ok: false,
      kind: "schema_validation_failed",
      message: "missing required field",
    };
    const grade = gradeSemanticCase(goldenLowerLimbCns, failure);
    expect(grade.outcomeClass).toBe("semantic_proposal_unsafe");
  });

  it("classifies a non-JSON model output as semantic_proposal_failed (no safety breach)", () => {
    const failure: SemanticInterpreterResult = {
      ok: false,
      kind: "model_returned_non_json",
      message: "garbage",
    };
    const grade = gradeSemanticCase(goldenLowerLimbCns, failure);
    expect(grade.outcomeClass).toBe("semantic_proposal_failed");
    expect(grade.hardGateFailures).toEqual([]);
  });
});

describe("P1-A grader — summarizeShadowResults", () => {
  it("aggregates outcome counts and mean score across results", () => {
    const results = [
      gradeSemanticCase(goldenLowerLimbCns, ok(makeInterpretation({
        candidateSystems: [
          { system: "lower_limb", confidence: 0.9, status: "structured_supported", evidence: [], rationale: "x" },
          { system: "cns", confidence: 0.9, status: "legacy_deferred", evidence: [], rationale: "x" },
        ],
        candidateFindings: [
          {
            system: "lower_limb",
            sourceSpan: "x",
            findingType: "neurological",
            proposedMapping: "x",
            systemConfidence: 0.9,
            mappingConfidence: 0.9,
            completeness: "missing_calculation_fields",
            explicitlyStatedFields: [],
            inferredFields: [],
            missingFields: ["partial vs total loss"],
            calculationReady: false,
          },
        ],
      }))),
      gradeSemanticCase(goldenLowerLimbCns, ok(makeInterpretation())),
      gradeSemanticCase(goldenLowerLimbCns, {
        ok: false,
        kind: "safety_validation_failed",
        message: "x",
      } satisfies SemanticInterpreterResult),
    ];
    const summary = summarizeShadowResults(results);
    expect(summary.caseCount).toBe(3);
    expect(summary.byOutcome.semantic_proposal_correct).toBe(1);
    expect(summary.byOutcome.semantic_proposal_failed).toBe(1);
    expect(summary.byOutcome.semantic_proposal_unsafe).toBe(1);
    expect(summary.unsafeCases).toHaveLength(1);
    expect(summary.failedCases).toHaveLength(1);
  });
});
