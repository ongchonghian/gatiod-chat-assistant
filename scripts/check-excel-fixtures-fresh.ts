// CI drift gate for the Excel scenario fixture. Regenerates the committed
// fixture from data/gatiod_injury_scenario_catalogue.xlsx and the override
// file, then fails if either generated file has changed on disk.
//
// Intent: the workbook and its derived fixture must be committed together.
// A changed workbook with a stale fixture (or vice versa) silently breaks
// the ADR-0001 promotion-gate evidence pipeline.
//
// Run via `npm run check:excel-fixtures-fresh`. Designed for CI.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const FIXTURE_PATH = resolve("tests/v2/excelScenarios/scenarios.generated.json");
const REPORT_PATH = resolve("tests/v2/excelScenarios/outcome-class-report.generated.json");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main(): void {
  const fixtureBefore = sha256(FIXTURE_PATH);
  const reportBefore = sha256(REPORT_PATH);

  // Regenerate. Inherit stdio so any generator output is visible in CI logs.
  execSync("npx tsx scripts/build-excel-fixtures.ts", { stdio: "inherit" });

  const fixtureAfter = sha256(FIXTURE_PATH);
  const reportAfter = sha256(REPORT_PATH);

  const drifts: string[] = [];
  if (fixtureBefore !== fixtureAfter) drifts.push("scenarios.generated.json");
  if (reportBefore !== reportAfter)   drifts.push("outcome-class-report.generated.json");

  if (drifts.length > 0) {
    console.error("");
    console.error("✗ Excel fixture drift detected:");
    for (const f of drifts) console.error(`    ${f} changed after regeneration`);
    console.error("");
    console.error("  The workbook (data/gatiod_injury_scenario_catalogue.xlsx) or override");
    console.error("  file has changed without the generated fixture being committed.");
    console.error("  Run `npm run build:excel-fixtures` and commit the result.");
    console.error("");
    process.exit(1);
  }

  console.log("✓ Excel fixture is fresh (no drift after regeneration).");
}

main();
