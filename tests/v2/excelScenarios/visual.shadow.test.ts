// Visual Excel shadow runner — calibration sample via the shared helper.
// Opt-in via GATIOD_RUN_EXCEL_SCENARIOS=true.

import { describe, it, beforeAll, expect } from "vitest";
import { shadowScenariosEnabled } from "./loadFixture.js";
import { checkAdr0001Thresholds, runSystemShadowSample } from "./runSystemShadowSample.js";
import type { SystemCalibrationReport } from "./gradeShadowOutcome.js";

const enabled = shadowScenariosEnabled();
const maybe = enabled ? describe : describe.skip;

maybe("Visual Excel shadow runner — calibration sample", () => {
  let report: SystemCalibrationReport;

  beforeAll(async () => {
    report = await runSystemShadowSample("visual");
  }, 900_000);

  it("ran the sample without infrastructure failure", () => {
    expect(report.sampleSize).toBeGreaterThan(0);
  });

  it("meets ADR-0001 thresholds (safe ≥90%, exact ≥80%)", () => {
    const result = checkAdr0001Thresholds(report);
    expect(result.ok, result.reasons.join("; ")).toBe(true);
  });
});
