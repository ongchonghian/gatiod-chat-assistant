// FileCalibrationEvidenceReader — implements PromotionEvidence by reading
// committed calibration JSON files from tests/v2/excelScenarios/.
// Shared by scripts/calibration/run.ts and scripts/check-adr-0001-promotion.ts.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GatiodSystemKey } from "../../src/v2/contracts.js";
import type { PromotionEvidence } from "../../src/v2/systemRegistry.js";

interface RawCalibrationReport {
  sampleSize: number;
  componentSafeOutcomeRate: number;
  exactCalculationRate: number;
  byExpected: { exact_calculation: { total: number } };
}

export class FileCalibrationEvidenceReader implements PromotionEvidence {
  loadCalibration(system: GatiodSystemKey) {
    const path = resolve(`tests/v2/excelScenarios/${system}.calibration.generated.json`);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawCalibrationReport;
    return {
      sampleSize: raw.sampleSize,
      componentSafeOutcomeRate: raw.componentSafeOutcomeRate,
      exactCalculationRate: raw.exactCalculationRate,
      exactRowCount: raw.byExpected?.exact_calculation?.total ?? 0,
    };
  }
}
