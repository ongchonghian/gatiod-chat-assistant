// Shared runner for per-system shadow calibration. Each *.shadow.test.ts
// invokes this with its system key; the helper handles sampling,
// two-turn driving, grading via gradeShadowOutcome, mismatch capture,
// and report serialization.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import type { GatiodSystemKey } from "../../../src/v2/contracts.js";
import { singleSystemScenariosFor } from "./loadFixture.js";
import {
  emptyCalibrationReport,
  gradeOutcome,
  type SystemCalibrationReport,
} from "./gradeShadowOutcome.js";
import type { ExcelScenarioFixture } from "./scenarioTypes.js";

const DEFAULT_SAMPLE_SIZE = 30;

/**
 * EXCEL_SCENARIO_FULL=true runs every available scenario for the system —
 * sample size becomes the full population. Used to validate that the
 * default-sample evidence generalizes to the entire workbook before a
 * release. Slow (minutes), so opt-in.
 */
function isFullRun(): boolean {
  return process.env.EXCEL_SCENARIO_FULL === "true";
}

/**
 * Per-system ADR-0001 promotion thresholds (safe-outcome %, exact-calc %).
 * Source: docs/adr/0001-structured-live-promotion-gate.md.
 */
export const ADR_0001_THRESHOLDS: Record<GatiodSystemKey, { safe: number; exact: number } | "deferred"> = {
  hearing:           { safe: 95, exact: 90 },
  spine:             { safe: 95, exact: 90 },
  respiratory:       { safe: 90, exact: 80 },
  renal:             { safe: 90, exact: 80 },
  gastro_digestive:  { safe: 85, exact: 70 },
  upper_limb:        { safe: 85, exact: 70 },
  lower_limb:        { safe: 85, exact: 70 },
  cns:               "deferred",
  visual:            "deferred",
};

/**
 * Apply ADR-0001 promotion thresholds to a calibration report. Returns a
 * structured pass/fail describing both metrics. Used by the per-system
 * shadow tests to enforce the gate.
 */
export interface ThresholdCheck {
  ok: boolean;
  safeOk: boolean;
  exactOk: boolean;
  reasons: string[];
}
export function checkAdr0001Thresholds(report: SystemCalibrationReport): ThresholdCheck {
  const cfg = ADR_0001_THRESHOLDS[report.system];
  if (cfg === "deferred") {
    return { ok: true, safeOk: true, exactOk: true, reasons: ["Deferred per ADR-0002."] };
  }
  const safePct = report.componentSafeOutcomeRate * 100;
  const exactTotal = report.byExpected.exact_calculation.total;
  const exactPct = report.exactCalculationRate * 100;
  const reasons: string[] = [];
  const safeOk = safePct >= cfg.safe;
  if (!safeOk) {
    reasons.push(
      `safe-outcome ${safePct.toFixed(1)}% < ${cfg.safe}% threshold`,
    );
  }
  // Exact-calc threshold only applies when there are exact_calculation rows
  // in the sample. With n=0, the metric is not meaningful and is treated
  // as N/A (passes by definition — the system has nothing to score against).
  const exactOk = exactTotal === 0 || exactPct >= cfg.exact;
  if (!exactOk) {
    reasons.push(
      `exact-calculation ${exactPct.toFixed(1)}% < ${cfg.exact}% threshold (n=${exactTotal})`,
    );
  }
  return { ok: safeOk && exactOk, safeOk, exactOk, reasons };
}

function deterministicSample(scenarios: ExcelScenarioFixture[], n: number): ExcelScenarioFixture[] {
  if (scenarios.length <= n) return scenarios;
  const stride = Math.floor(scenarios.length / n);
  const out: ExcelScenarioFixture[] = [];
  for (let i = 0; out.length < n && i < scenarios.length; i += stride) {
    out.push(scenarios[i]);
  }
  return out;
}

/**
 * Run a sample of single-system scenarios for `system` through processChatV2,
 * grade each, and write a calibration report at
 * `tests/v2/excelScenarios/<system>.calibration.generated.json`. Returns the
 * report so the caller can assert on aggregate numbers.
 */
export async function runSystemShadowSample(
  system: GatiodSystemKey,
): Promise<SystemCalibrationReport> {
  const sampleSize = isFullRun()
    ? Number.MAX_SAFE_INTEGER
    : Number.parseInt(
    process.env.EXCEL_SCENARIO_SAMPLE ?? String(DEFAULT_SAMPLE_SIZE),
    10,
  );

  process.env.GATIOD_DB_PATH = ":memory:";
  const all = singleSystemScenariosFor(system);
  const sample = deterministicSample(all, sampleSize);
  const report = emptyCalibrationReport(system);
  report.sampleSize = sample.length;

  let exactTotal = 0;
  let exactPiMatches = 0;
  let totalMatches = 0;

  for (const scenario of sample) {
    const component = scenario.components[0];
    const sessionId = `shadow-${system}-${scenario.rowId}`;
    let response;
    try {
      response = await processChatV2(sessionId, scenario.inputText, { shadow: true });
      // Two-turn flow: a "Confirmed" reply makes sense when the assistant
      // has either (a) presented a structured confirmation card, or (b)
      // returned a DBE/lookup-mapped result asking the doctor to proceed
      // ("Please confirm if you want me to proceed and share any
      // additional findings"). Both are functionally pre-confirmation
      // states for an exact_calculation flow.
      const isStructuredConfirm = /\*\*Confirmation —/.test(response.message);
      const isLookupConfirm =
        /please\s+confirm\s+if\s+you\s+want\s+me\s+to\s+proceed/i.test(response.message);
      if (response.needsClarification && isStructuredConfirm) {
        response = await processChatV2(sessionId, "Confirmed", { shadow: true });
      } else if (isLookupConfirm) {
        response = await processChatV2(sessionId, "Confirmed", { shadow: true });
      }
    } catch (err) {
      report.byExpected[component.outcomeClass].total += 1;
      if (report.mismatchSamples.length < 30) {
        report.mismatchSamples.push({
          rowId: scenario.rowId,
          inputText: scenario.inputText.slice(0, 160),
          expected: component.outcomeClass,
          observed: "wrong_route",
          notes: `runner threw: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      continue;
    }

    const grade = gradeOutcome(response, component);
    const bucket = report.byExpected[component.outcomeClass];
    bucket.total += 1;
    bucket.observedDist[grade.observed] += 1;
    if (grade.matches) {
      bucket.matched += 1;
      totalMatches += 1;
    }

    if (component.outcomeClass === "exact_calculation") {
      exactTotal += 1;
      if (grade.piMatches) exactPiMatches += 1;
    }

    if (!grade.matches && report.mismatchSamples.length < 30) {
      report.mismatchSamples.push({
        rowId: scenario.rowId,
        inputText: scenario.inputText.slice(0, 160),
        expected: component.outcomeClass,
        observed: grade.observed,
        notes: grade.notes,
      });
    }
  }

  report.componentSafeOutcomeRate = sample.length === 0 ? 0 : totalMatches / sample.length;
  report.exactCalculationRate = exactTotal === 0 ? 0 : exactPiMatches / exactTotal;

  const reportPath = resolve(`tests/v2/excelScenarios/${system}.calibration.generated.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  return report;
}
