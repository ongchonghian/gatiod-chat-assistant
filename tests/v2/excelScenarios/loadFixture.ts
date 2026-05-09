// Helper: load the committed Excel fixture and filter by system / sheet.
// Used by the per-system *.shadow.test.ts files.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GatiodSystemKey } from "../../../src/v2/contracts.js";
import type {
  ExcelFixtureFile,
  ExcelScenarioFixture,
} from "./scenarioTypes.js";

const FIXTURE_PATH = resolve("tests/v2/excelScenarios/scenarios.generated.json");

let cached: ExcelFixtureFile | null = null;

export function loadExcelFixture(): ExcelFixtureFile {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as ExcelFixtureFile;
  return cached;
}

/**
 * Return all single-system scenarios for a given system. Cross-system rows
 * are excluded — they are graded by `crossSystem.shadow.test.ts`.
 */
export function singleSystemScenariosFor(system: GatiodSystemKey): ExcelScenarioFixture[] {
  const fixture = loadExcelFixture();
  return fixture.scenarios.filter(
    (s) =>
      s.rowClassification === "single_system" &&
      s.components.length === 1 &&
      s.components[0].system === system,
  );
}

/** Return cross-system scenarios where at least one component targets `system`. */
export function crossSystemScenariosFor(system: GatiodSystemKey): ExcelScenarioFixture[] {
  const fixture = loadExcelFixture();
  return fixture.scenarios.filter(
    (s) =>
      s.rowClassification === "cross_system" &&
      s.components.some((c) => c.system === system),
  );
}

/** Convenience: are the shadow scenarios opted in for this run? */
export function shadowScenariosEnabled(): boolean {
  return process.env.GATIOD_RUN_EXCEL_SCENARIOS === "true";
}
