// upper_limb Excel shadow runner — calibration + ADR-0001 threshold enforcement.
import { describe, it, beforeAll, expect } from "vitest";
import { shadowScenariosEnabled } from "./loadFixture.js";
import { checkAdr0001Thresholds, runSystemShadowSample } from "./runSystemShadowSample.js";
import type { SystemCalibrationReport } from "./gradeShadowOutcome.js";

const enabled = shadowScenariosEnabled();
const maybe = enabled ? describe : describe.skip;

maybe("upper_limb Excel shadow runner — calibration sample", () => {
  let report: SystemCalibrationReport;

  beforeAll(async () => {
    report = await runSystemShadowSample("upper_limb");
  }, 900_000);

  it("ran the sample without infrastructure failure", () => {
    expect(report.sampleSize).toBeGreaterThan(0);
  });

  it("meets ADR-0001 thresholds (85%, 70%)", () => {
    const result = checkAdr0001Thresholds(report);
    expect(result.ok, result.reasons.join("; ")).toBe(true);
  });
});
