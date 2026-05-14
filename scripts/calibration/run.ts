#!/usr/bin/env node
// V2-701 — Calibration runner (REQ-B1).
//
// Runs the Excel shadow calibration for one or all GATIOD systems without
// needing vitest. Writes tests/v2/excelScenarios/<system>.calibration.generated.json
// per system, prints a summary table, and exits 1 if any system misses its
// ADR-0001 threshold.
//
// Usage:
//   tsx scripts/calibration/run.ts                          # all 9 systems
//   tsx scripts/calibration/run.ts --system upper_limb      # single system
//   tsx scripts/calibration/run.ts --system upper_limb,spine # comma list
//   tsx scripts/calibration/run.ts --full                   # full workbook run
//   tsx scripts/calibration/run.ts --check                  # ADR-0001 promotion check after run

import {
  ADR_0001_THRESHOLDS,
  checkAdr0001Thresholds,
  runSystemShadowSample,
} from "../../tests/v2/excelScenarios/runSystemShadowSample.js";
import { validateStructuredLivePromotion } from "../../src/v2/systemRegistry.js";
import type { GatiodSystemKey } from "../../src/v2/contracts.js";
import { FileCalibrationEvidenceReader } from "./fileCalibrationEvidenceReader.js";

const ALL_SYSTEMS: GatiodSystemKey[] = [
  "upper_limb",
  "lower_limb",
  "spine",
  "respiratory",
  "renal",
  "gastro_digestive",
  "hearing",
  "cns",
  "visual",
];

interface CliArgs {
  systems: GatiodSystemKey[];
  full: boolean;
  checkPromotion: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let systems: GatiodSystemKey[] = ALL_SYSTEMS;
  let full = false;
  let checkPromotion = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--system" && args[i + 1]) {
      systems = args[++i].split(",").map((s) => s.trim()) as GatiodSystemKey[];
    } else if (args[i] === "--full") {
      full = true;
    } else if (args[i] === "--check") {
      checkPromotion = true;
    }
  }

  return { systems, full, checkPromotion };
}

interface RunResult {
  system: GatiodSystemKey;
  ok: boolean;
  reasons: string[];
  safePct: string;
  exactPct: string;
  sampleSize: number;
}

async function main(): Promise<void> {
  const { systems, full, checkPromotion } = parseArgs();

  if (full) {
    process.env.EXCEL_SCENARIO_FULL = "true";
  }

  console.log(`Calibration runner — ${systems.join(", ")}`);
  if (full) console.log("Mode: FULL (all workbook rows)");
  console.log("");

  const results: RunResult[] = [];

  for (const system of systems) {
    process.stdout.write(`  ${system.padEnd(18)} `);
    const report = await runSystemShadowSample(system);
    const check = checkAdr0001Thresholds(report);
    const thresholds = ADR_0001_THRESHOLDS[system];
    const safePct = (report.componentSafeOutcomeRate * 100).toFixed(1) + "%";
    const exactTotal = report.byExpected.exact_calculation.total;
    const exactPct =
      exactTotal === 0 ? "N/A" : (report.exactCalculationRate * 100).toFixed(1) + "%";

    const safeGate = `safe=${safePct}(≥${thresholds.safe}%)`;
    const exactGate = `exact=${exactPct}(≥${thresholds.exact}%)`;
    const status = check.ok ? "✓" : "✗";
    console.log(`${status}  ${safeGate}  ${exactGate}  n=${report.sampleSize}`);

    results.push({ system, ok: check.ok, reasons: check.reasons, safePct, exactPct, sampleSize: report.sampleSize });
  }

  console.log("");

  if (checkPromotion) {
    console.log("ADR-0001 promotion check (evidence mode):");
    const promotion = validateStructuredLivePromotion(new FileCalibrationEvidenceReader());
    for (const w of promotion.warnings) console.log(`  ⚠  ${w}`);
    for (const f of promotion.failures) console.error(`  ✗  ${f}`);
    if (promotion.ok && promotion.warnings.length === 0) {
      console.log("  ✓  All systems meet ADR-0001 promotion thresholds.");
    }
    console.log("");
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error("Systems below ADR-0001 threshold:");
    for (const f of failures) {
      console.error(`  ${f.system}: ${f.reasons.join("; ")}`);
    }
    process.exit(1);
  }

  console.log(`✓ All ${results.length} system(s) meet ADR-0001 thresholds.`);
}

main().catch((err) => {
  console.error("Calibration runner error:", err);
  process.exit(1);
});
