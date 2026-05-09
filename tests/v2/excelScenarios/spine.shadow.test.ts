// Spine Excel shadow runner — fixture sanity + calibration sample via the
// shared helper. Opt-in via GATIOD_RUN_EXCEL_SCENARIOS=true.

import { describe, it, beforeAll, expect } from "vitest";
import {
  loadExcelFixture,
  shadowScenariosEnabled,
  singleSystemScenariosFor,
} from "./loadFixture.js";
import { checkAdr0001Thresholds, runSystemShadowSample } from "./runSystemShadowSample.js";
import type { SystemCalibrationReport } from "./gradeShadowOutcome.js";

const enabled = shadowScenariosEnabled();
const maybe = enabled ? describe : describe.skip;

maybe("Spine Excel shadow runner — fixture sanity (Slice 5)", () => {
  it("fixture loads with the expected sheet counts", () => {
    const fixture = loadExcelFixture();
    expect(fixture.sheetCounts["Specific Scenarios"]).toBe(2419);
    expect(fixture.sheetCounts["Cross-System Scenarios"]).toBe(360);
    expect(fixture.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("there is at least one single-system spine scenario with a calculable PI", () => {
    const rows = singleSystemScenariosFor("spine");
    expect(rows.length).toBeGreaterThan(0);
    const calculable = rows.filter((r) => r.components[0].outcomeClass === "exact_calculation");
    expect(calculable.length).toBeGreaterThan(0);
  });

  it("no spine rows have legacy_deferred outcome (deferral is CNS/visual only)", () => {
    const rows = singleSystemScenariosFor("spine");
    const deferred = rows.filter((r) => r.components[0].outcomeClass === "legacy_deferred");
    expect(deferred).toHaveLength(0);
  });
});

maybe("Spine Excel shadow runner — calibration sample (Slice 7)", () => {
  let report: SystemCalibrationReport;

  beforeAll(async () => {
    report = await runSystemShadowSample("spine");
  }, 900_000);

  it("ran the sample without infrastructure failure", () => {
    expect(report.sampleSize).toBeGreaterThan(0);
  });

  it("meets ADR-0001 thresholds (95%, 90%)", () => {
    const result = checkAdr0001Thresholds(report);
    expect(result.ok, result.reasons.join("; ")).toBe(true);
  });
});
