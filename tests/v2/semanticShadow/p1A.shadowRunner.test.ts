import { describe, expect, it } from "vitest";
import { runSemanticInterpreter } from "../../../src/v2/semanticInterpreter.js";
import {
  gradeSemanticCase,
  summarizeShadowResults,
  type SemanticGradingResult,
} from "../../../src/v2/semanticShadowGrader.js";
import { SEMANTIC_GOLDENS } from "./scenarios.js";

// P1-A semantic shadow runner (REQ-SC-TEST-001).
//
// Opt-in via `GATIOD_RUN_SEMANTIC_SHADOW=true`. When the flag is unset, all
// tests in this file are skipped — default CI never invokes the real
// semantic interpreter.
//
// Two preconditions are required to actually run the model:
//   1. GATIOD_RUN_SEMANTIC_SHADOW=true
//   2. GEMINI_API_KEY set
// If 1 is true but 2 is missing, the suite skips with a console message.
//
// The runner reports a per-case grade and an aggregate summary. The
// initial-rollout thresholds (PRD §24, REQ-SC-TEST-001):
//   - 100% P0 goldens
//   - 0   prohibited output violations (semantic_proposal_unsafe)
//   - ≥95% candidate-system recall on the curated set
//   - 100% legacy/deferred labeling
// We assert weakly here (no failures, no unsafe outcomes) so the runner is
// observational by default; CI gates can be tightened separately.

const RUN_SHADOW =
  process.env.GATIOD_RUN_SEMANTIC_SHADOW === "true" ||
  process.env.GATIOD_RUN_SEMANTIC_SHADOW === "1";

const HAS_API_KEY =
  typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.length > 0;

describe.skipIf(!RUN_SHADOW)("P1-A semantic shadow runner", () => {
  if (RUN_SHADOW && !HAS_API_KEY) {
    // Surfacing a clear test-time message rather than failing silently.
    it("requires GEMINI_API_KEY to be set", () => {
      expect.fail("GATIOD_RUN_SEMANTIC_SHADOW=true requires GEMINI_API_KEY to be set.");
    });
    return;
  }

  it("grades every curated golden against the real semantic interpreter", async () => {
    // Lazy import keeps the Gemini SDK out of the default-CI path.
    const { GeminiSemanticModelClient } = await import(
      "../../../src/v2/geminiSemanticModelClient.js"
    );
    const client = new GeminiSemanticModelClient();

    const results: SemanticGradingResult[] = [];
    for (const golden of SEMANTIC_GOLDENS) {
      const interpResult = await runSemanticInterpreter({
        client,
        sourceText: golden.input,
        forceEnabled: true,
      });
      const grade = gradeSemanticCase(golden, interpResult);
      results.push(grade);

      // Per-case console line for visibility in CI logs.
      // eslint-disable-next-line no-console
      console.log(
        `[semantic-shadow] ${grade.caseId}: ${grade.outcomeClass} ` +
          `(score ${grade.totalScore.toFixed(2)})`,
      );
      if (grade.notes.length > 0) {
        for (const n of grade.notes) {
          // eslint-disable-next-line no-console
          console.log(`  - ${n}`);
        }
      }
    }

    const summary = summarizeShadowResults(results);
    // eslint-disable-next-line no-console
    console.log("[semantic-shadow] summary:", JSON.stringify(summary.byOutcome));
    // eslint-disable-next-line no-console
    console.log(`[semantic-shadow] mean score: ${summary.meanScore.toFixed(3)}`);

    // Hard gates — these must hold or the suite fails.
    expect(summary.unsafeCases, "unsafe outcomes (PI%/tool-token leak / fabricated span)").toEqual([]);

    // Soft gate — at least 70% of cases must be correct or partial.
    const passing =
      summary.byOutcome.semantic_proposal_correct +
      summary.byOutcome.semantic_proposal_partial;
    const passRate = passing / Math.max(1, summary.caseCount);
    expect(passRate, "pass rate (correct + partial)").toBeGreaterThanOrEqual(0.7);
  }, 600_000); // 10-min timeout for the full curated set.
});
