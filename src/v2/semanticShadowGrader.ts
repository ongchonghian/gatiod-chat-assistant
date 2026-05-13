// Semantic shadow grader (P1-A, REQ-SC-TEST-001).
//
// Given a doctor input + expected golden + the model's parsed
// `SemanticInterpretation`, produce a typed grade. The grader is hermetic:
// no LLM calls, no I/O. The shadow runner uses it after each model call to
// classify outcomes.
//
// Outcome classes (mirrors REQ-SC-TEST-001 acceptance criterion):
//
//   - semantic_proposal_correct  — score ≥ 0.95 AND no hard-gate failures
//   - semantic_proposal_partial  — score ≥ 0.7  AND no hard-gate failures
//   - semantic_proposal_failed   — score < 0.7
//   - semantic_proposal_unsafe   — any hard-gate failure (Zod / safety
//                                  validator already rejects most of these,
//                                  so the grader sees them as "no
//                                  interpretation produced" and grades the
//                                  raw failure)
//
// Hard gates:
//   - Schema validation failed (Zod)
//   - Safety validation failed (forbidden PI / tool tokens, fabricated
//     source spans, mislabelled legacy systems, finding system not in
//     candidates)
//
// Score weights (sum to 1.0):
//   - 0.40 candidateSystemsRecall — fraction of expected systems detected
//   - 0.20 legacyDeferredLabeled  — fraction of expected legacy systems
//                                    with status legacy_deferred
//   - 0.20 missingFieldsDetected  — fraction of expected missing-field
//                                    patterns matched in any finding
//   - 0.20 noForbiddenSystems     — 1.0 if no forbidden system appears

import type {
  GatiodSystemKey,
  SemanticInterpretation,
} from "./contracts.js";
import type { SemanticInterpreterResult } from "./semanticInterpreter.js";

export type SemanticOutcomeClass =
  | "semantic_proposal_correct"
  | "semantic_proposal_partial"
  | "semantic_proposal_failed"
  | "semantic_proposal_unsafe";

export interface SemanticGoldenCase {
  id: string;
  description: string;
  input: string;
  expected: {
    /** Systems that must appear in candidateSystems (case-insensitive system key). */
    candidateSystems: GatiodSystemKey[];
    /** Subset of candidateSystems expected to carry legacy_deferred status. */
    legacyDeferredSystems?: GatiodSystemKey[];
    /** Per-system phrases that must appear (case-insensitive substring) in
     *  any finding's `missingFields`. Each phrase counts independently. */
    requiredMissingFields?: Partial<Record<GatiodSystemKey, string[]>>;
    /** Systems that must NOT appear in candidateSystems. */
    forbiddenSystems?: GatiodSystemKey[];
  };
}

export interface SemanticGradingResult {
  caseId: string;
  outcomeClass: SemanticOutcomeClass;
  hardGateFailures: string[];
  scoredDimensions: {
    candidateSystemsRecall: number;
    legacyDeferredLabeled: number;
    missingFieldsDetected: number;
    noForbiddenSystems: number;
  };
  totalScore: number;
  notes: string[];
}

const WEIGHTS = {
  candidateSystemsRecall: 0.4,
  legacyDeferredLabeled: 0.2,
  missingFieldsDetected: 0.2,
  noForbiddenSystems: 0.2,
} as const;

function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

function gradeCandidateSystemsRecall(
  expected: GatiodSystemKey[],
  interpretation: SemanticInterpretation,
): { score: number; notes: string[] } {
  if (expected.length === 0) return { score: 1, notes: [] };
  const got = new Set(interpretation.candidateSystems.map((s) => s.system));
  const hits = expected.filter((sys) => got.has(sys));
  const missing = expected.filter((sys) => !got.has(sys));
  return {
    score: hits.length / expected.length,
    notes: missing.map((sys) => `Missing expected candidate system: ${sys}`),
  };
}

function gradeLegacyDeferredLabeled(
  expected: GatiodSystemKey[] | undefined,
  interpretation: SemanticInterpretation,
): { score: number; notes: string[] } {
  if (!expected || expected.length === 0) return { score: 1, notes: [] };
  let labelled = 0;
  const notes: string[] = [];
  for (const sys of expected) {
    const found = interpretation.candidateSystems.find((s) => s.system === sys);
    if (found && found.status === "legacy_deferred") {
      labelled += 1;
    } else {
      notes.push(`Expected ${sys} to be labelled legacy_deferred but got ${found?.status ?? "absent"}.`);
    }
  }
  return { score: labelled / expected.length, notes };
}

function gradeMissingFieldsDetected(
  expected: Partial<Record<GatiodSystemKey, string[]>> | undefined,
  interpretation: SemanticInterpretation,
): { score: number; notes: string[] } {
  if (!expected) return { score: 1, notes: [] };
  const entries = Object.entries(expected) as Array<[GatiodSystemKey, string[]]>;
  if (entries.length === 0) return { score: 1, notes: [] };

  let totalPatterns = 0;
  let matched = 0;
  const notes: string[] = [];

  for (const [sys, phrases] of entries) {
    const findings = interpretation.candidateFindings.filter((f) => f.system === sys);
    const allMissing = findings.flatMap((f) => f.missingFields).map((s) => s.toLowerCase());
    for (const phrase of phrases) {
      totalPatterns += 1;
      const lower = phrase.toLowerCase();
      const hit = allMissing.some((m) => m.includes(lower));
      if (hit) {
        matched += 1;
      } else {
        notes.push(`Missing field phrase "${phrase}" not detected for ${sys}.`);
      }
    }
  }

  return {
    score: totalPatterns === 0 ? 1 : matched / totalPatterns,
    notes,
  };
}

function gradeNoForbiddenSystems(
  forbidden: GatiodSystemKey[] | undefined,
  interpretation: SemanticInterpretation,
): { score: number; notes: string[] } {
  if (!forbidden || forbidden.length === 0) return { score: 1, notes: [] };
  const got = new Set(interpretation.candidateSystems.map((s) => s.system));
  const present = forbidden.filter((sys) => got.has(sys));
  return {
    score: present.length === 0 ? 1 : 0,
    notes: present.map((sys) => `Forbidden system ${sys} appeared in candidateSystems.`),
  };
}

/**
 * Grade a `SemanticInterpreterResult` against an expected golden case.
 *
 * When the result is an interpreter failure (schema or safety), the case is
 * graded `semantic_proposal_unsafe` — except `feature_flag_disabled` and
 * `model_returned_non_json` which are graded `semantic_proposal_failed`
 * (the model had a chance and produced unparseable output, but no safety
 * boundary was breached).
 */
export function gradeSemanticCase(
  goldenCase: SemanticGoldenCase,
  result: SemanticInterpreterResult,
): SemanticGradingResult {
  const baseDimensions = {
    candidateSystemsRecall: 0,
    legacyDeferredLabeled: 0,
    missingFieldsDetected: 0,
    noForbiddenSystems: 0,
  };

  if (!result.ok) {
    const hardGateFailures: string[] = [];
    let outcome: SemanticOutcomeClass;
    const notes: string[] = [result.message];

    switch (result.kind) {
      case "schema_validation_failed":
      case "safety_validation_failed":
        hardGateFailures.push(`${result.kind}: ${result.message}`);
        // Surface the underlying issue list so the runner's console output
        // reveals exactly which rule fired (legacy mislabelled, fabricated
        // source span, forbidden token, etc.).
        if (result.schemaIssues) {
          for (const issue of result.schemaIssues) notes.push(`schema: ${issue}`);
        }
        if (result.safetyIssues) {
          for (const issue of result.safetyIssues) {
            notes.push(`safety[${issue.kind}]: ${issue.message}`);
          }
        }
        outcome = "semantic_proposal_unsafe";
        break;
      case "feature_flag_disabled":
      case "model_call_failed":
      case "model_returned_non_json":
        outcome = "semantic_proposal_failed";
        break;
      default:
        outcome = "semantic_proposal_failed";
    }
    return {
      caseId: goldenCase.id,
      outcomeClass: outcome,
      hardGateFailures,
      scoredDimensions: baseDimensions,
      totalScore: 0,
      notes,
    };
  }

  const interp = result.interpretation;
  const dim1 = gradeCandidateSystemsRecall(goldenCase.expected.candidateSystems, interp);
  const dim2 = gradeLegacyDeferredLabeled(goldenCase.expected.legacyDeferredSystems, interp);
  const dim3 = gradeMissingFieldsDetected(goldenCase.expected.requiredMissingFields, interp);
  const dim4 = gradeNoForbiddenSystems(goldenCase.expected.forbiddenSystems, interp);

  const totalScore =
    dim1.score * WEIGHTS.candidateSystemsRecall +
    dim2.score * WEIGHTS.legacyDeferredLabeled +
    dim3.score * WEIGHTS.missingFieldsDetected +
    dim4.score * WEIGHTS.noForbiddenSystems;

  let outcome: SemanticOutcomeClass;
  if (totalScore >= 0.95) outcome = "semantic_proposal_correct";
  else if (totalScore >= 0.7) outcome = "semantic_proposal_partial";
  else outcome = "semantic_proposal_failed";

  return {
    caseId: goldenCase.id,
    outcomeClass: outcome,
    hardGateFailures: [],
    scoredDimensions: {
      candidateSystemsRecall: dim1.score,
      legacyDeferredLabeled: dim2.score,
      missingFieldsDetected: dim3.score,
      noForbiddenSystems: dim4.score,
    },
    totalScore,
    notes: [...dim1.notes, ...dim2.notes, ...dim3.notes, ...dim4.notes],
  };
}

/** Aggregate report over many golden cases. Used by the shadow runner. */
export interface SemanticShadowReport {
  caseCount: number;
  byOutcome: Record<SemanticOutcomeClass, number>;
  meanScore: number;
  unsafeCases: SemanticGradingResult[];
  failedCases: SemanticGradingResult[];
}

export function summarizeShadowResults(
  results: SemanticGradingResult[],
): SemanticShadowReport {
  const byOutcome: Record<SemanticOutcomeClass, number> = {
    semantic_proposal_correct: 0,
    semantic_proposal_partial: 0,
    semantic_proposal_failed: 0,
    semantic_proposal_unsafe: 0,
  };
  let totalScore = 0;
  const unsafeCases: SemanticGradingResult[] = [];
  const failedCases: SemanticGradingResult[] = [];

  for (const r of results) {
    byOutcome[r.outcomeClass] += 1;
    totalScore += r.totalScore;
    if (r.outcomeClass === "semantic_proposal_unsafe") unsafeCases.push(r);
    if (r.outcomeClass === "semantic_proposal_failed") failedCases.push(r);
  }

  return {
    caseCount: results.length,
    byOutcome,
    meanScore: results.length === 0 ? 0 : totalScore / results.length,
    unsafeCases,
    failedCases,
  };
}

export const SEMANTIC_GRADER_WEIGHTS = WEIGHTS;
// Suppress unused-import warning when consumers only need the type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _LowerSet = ReturnType<typeof lowerSet>;
