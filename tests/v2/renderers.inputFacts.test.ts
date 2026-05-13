/**
 * Issue 04 — Result renderers: inputFacts use clinical display registry.
 *
 * Verifies that fullBreakdown.inputFacts entries use factKeyLabel/factValueDisplay
 * instead of raw fact keys and JSON.stringify.
 */
import { describe, expect, it } from "vitest";
import { renderSpineResult } from "../../src/v2/renderers/spineResult.js";
import { renderLowerLimbResult } from "../../src/v2/renderers/lowerLimbResult.js";
import { renderHearingResult } from "../../src/v2/renderers/hearingResult.js";
import { renderUpperLimbResult } from "../../src/v2/renderers/upperLimbResult.js";
import { renderRespiratoryResult } from "../../src/v2/renderers/respiratoryResult.js";
import { renderRenalResult } from "../../src/v2/renderers/renalResult.js";
import { renderGastroResult } from "../../src/v2/renderers/gastroResult.js";
import type { V2SystemState, V2SystemFacts } from "../../src/v2/contracts.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(facts: V2SystemFacts): V2SystemState {
  return {
    status: "ready_to_calculate",
    completeness: 1,
    pendingFields: [],
    slotSignals: {},
    extractedValues: {},
    extractedFacts: facts,
    pendingObservations: [],
    confirmation: { factsHash: "", confirmedAt: "", confirmedFacts: {} },
    piPercent: null,
    updatedAt: new Date().toISOString(),
  };
}

function fact(value: unknown) {
  return { value, sourceText: "", confidence: 1, extractionMethod: "regex" as const, createdAt: "", updatedAt: "" };
}

// ── Spine renderer ────────────────────────────────────────────────────────────

describe("renderSpineResult — inputFacts clinical labels (Issue 04)", () => {
  const spineToolResult = {
    finalPercent: 30,
    winnerIndex: 0,
    evaluatedEntries: [
      {
        diagnosisCategory: "intervertebral_disc",
        severity: "disc31_persistent_motor_or_motor_sensory",
        computedPercent: 30,
        isMonoparesis: false,
        bladderBowelAddOn: 0,
      },
    ],
    firstScheduleFlag: false,
  };

  it("inputFacts contains 'Region:' label, not raw 'spine_region'", () => {
    const state = makeState({
      spine_region: fact("lumbo_sacral"),
    });
    const rendered = renderSpineResult(spineToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Region:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("spine_region:"))).toBe(false);
  });

  it("inputFacts contains 'Diagnosis entries:' label, not raw 'spine_entries'", () => {
    const entry = {
      diagnosisCategory: "intervertebral_disc",
      severityKey: "disc31_persistent_motor_or_motor_sensory",
      monoparesisHalving: false,
      bladderBowelSeverity: "none",
      discCordInvolvement: false,
      spondylolysisPathway: "acute_traumatic",
    };
    const state = makeState({
      spine_entries: fact([entry]),
    });
    const rendered = renderSpineResult(spineToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Diagnosis entries:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("spine_entries:"))).toBe(false);
  });

  it("inputFacts region value is 'Lumbo-Sacral', not raw 'lumbo_sacral'", () => {
    const state = makeState({
      spine_region: fact("lumbo_sacral"),
    });
    const rendered = renderSpineResult(spineToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    const regionLine = facts.find((f) => f.startsWith("Region:"));
    expect(regionLine).toBeDefined();
    expect(regionLine).toContain("Lumbo-Sacral");
    expect(regionLine).not.toContain("lumbo_sacral");
  });

  it("inputFacts entries value contains no raw JSON brackets", () => {
    const entry = {
      diagnosisCategory: "intervertebral_disc",
      severityKey: "disc31_persistent_motor_or_motor_sensory",
      monoparesisHalving: false,
      bladderBowelSeverity: "none",
      discCordInvolvement: false,
      spondylolysisPathway: "acute_traumatic",
    };
    const state = makeState({
      spine_entries: fact([entry]),
    });
    const rendered = renderSpineResult(spineToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    const entriesLine = facts.find((f) => f.startsWith("Diagnosis entries:"));
    expect(entriesLine).not.toContain("{");
    expect(entriesLine).not.toContain("disc31_persistent");
  });
});

// ── Lower limb renderer ───────────────────────────────────────────────────────

describe("renderLowerLimbResult — inputFacts clinical labels (Issue 04)", () => {
  const lowerToolResult = {
    finalPercent: 20,
    amputation: { rawPercent: 0, notes: [] },
    rom: { rawPercent: 20, notes: [] },
    neurological: { rawPercent: 0, notes: [] },
    shortening: { rawPercent: 0, notes: [] },
    dbe: { rawPercent: 0, notes: [] },
    dbeRomConflicts: [],
    cvcInputs: [],
  };

  it("inputFacts contains 'Range of motion:' label, not raw 'rom_joints'", () => {
    const state = makeState({
      rom_joints: fact({ hip: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    const rendered = renderLowerLimbResult(lowerToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Range of motion:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("rom_joints:"))).toBe(false);
  });

  it("inputFacts ROM value shows clinical format, not JSON", () => {
    const state = makeState({
      rom_joints: fact({ hip: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    const rendered = renderLowerLimbResult(lowerToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    const romLine = facts.find((f) => f.startsWith("Range of motion:"));
    expect(romLine).toBeDefined();
    expect(romLine).toContain("hip");
    expect(romLine).toContain("flexion 90°");
    expect(romLine).not.toContain("{");
  });

  it("inputFacts contains 'Shortening:' label with cm suffix", () => {
    const state = makeState({
      shortening_cm: fact(3),
    });
    const rendered = renderLowerLimbResult(lowerToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    const line = facts.find((f) => f.startsWith("Shortening:"));
    expect(line).toBeDefined();
    expect(line).toContain("3 cm");
    expect(facts.some((f) => f.startsWith("shortening_cm:"))).toBe(false);
  });
});

// ── Hearing renderer ──────────────────────────────────────────────────────────

describe("renderHearingResult — inputFacts clinical labels (Issue 04)", () => {
  const nidToolResult = {
    path: "nid" as const,
    finalPercent: 10,
    ahl: 45,
    correctedAhl: 42,
    presbycusisDeduction: 3,
    tablePercent: 10,
    hasTinnitus: false,
  };

  it("inputFacts contains 'Left ear AHL:' label, not raw 'hearing_left_ear_ahl'", () => {
    const state = makeState({
      hearing_left_ear_ahl: fact(45),
      hearing_right_ear_ahl: fact(40),
    });
    const rendered = renderHearingResult(nidToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Left ear AHL:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("hearing_left_ear_ahl:"))).toBe(false);
  });

  it("inputFacts contains 'Assessment pathway:' label, not raw 'hearing_path'", () => {
    const state = makeState({
      hearing_path: fact("nid"),
    });
    const rendered = renderHearingResult(nidToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Assessment pathway:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("hearing_path:"))).toBe(false);
  });
});

// ── Upper limb renderer ───────────────────────────────────────────────────────

describe("renderUpperLimbResult — inputFacts clinical labels (Issue 04)", () => {
  const upperToolResult = {
    finalPercent: 15,
    amputation: { rawPercent: 0, notes: [] },
    rom: { rawPercent: 15, notes: [] },
    neurological: { rawPercent: 0, notes: [] },
    dbe: { rawPercent: 0, notes: [] },
    dbeRomConflicts: [],
    cvcInputs: [],
  };

  it("inputFacts contains 'Side:' label, not raw 'side'... actually side fallback is 'Side'", () => {
    const state = makeState({
      side: fact("left"),
    });
    const rendered = renderUpperLimbResult(upperToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Side:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("side:"))).toBe(false);
  });

  it("inputFacts ROM joints uses clinical label 'Range of motion'", () => {
    const state = makeState({
      rom_joints: fact({ shoulder: { isAnkylosed: false, measurements: { flexion: 60 } } }),
    });
    const rendered = renderUpperLimbResult(upperToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Range of motion:"))).toBe(true);
    const romLine = facts.find((f) => f.startsWith("Range of motion:"));
    expect(romLine).toContain("shoulder");
    expect(romLine).toContain("flexion 60°");
    expect(romLine).not.toContain("{");
  });
});

// ── Respiratory renderer ──────────────────────────────────────────────────────

const nullMetric = { value: null, classIndex: 0, classLabel: "Normal", suppressedReason: null };

describe("renderRespiratoryResult — inputFacts clinical labels (Issue 04)", () => {
  const respToolResult = {
    severityClassIndex: 1,
    severityLabel: "Class I",
    piRangeMin: 10,
    piRangeMax: 20,
    recommendedPi: 15,
    selectedPi: 15,
    isAsthmaOverride: false,
    isAsbestosisFloor: false,
    asthmaEligible: false,
    asbestosisEligible: false,
    suppressionReason: null,
    piChoices: [10, 15, 20],
    testClassifications: {
      fvc: { value: 72, classIndex: 1, classLabel: "Class I", suppressedReason: null },
      fev1: nullMetric,
      dlco: nullMetric,
      vo2Max: nullMetric,
    },
    baseSeverityClassIndex: 1,
    baseSeverityLabel: "Class I",
    basePiRangeMin: 10,
    basePiRangeMax: 20,
    selectionAdjustedFrom: null,
    selectionAdjustmentReason: null,
    hardCapApplied: false,
    firstScheduleFlag: false,
  };

  it("inputFacts contains 'Diagnosis type:' label, not raw 'resp_diagnosis'", () => {
    const state = makeState({
      resp_diagnosis: fact("standard"),
    });
    const rendered = renderRespiratoryResult(respToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Diagnosis type:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("resp_diagnosis:"))).toBe(false);
  });

  it("inputFacts contains 'FVC (% predicted):' label, not raw 'resp_fvc'", () => {
    const state = makeState({
      resp_fvc: fact(72),
    });
    const rendered = renderRespiratoryResult(respToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("FVC (% predicted):"))).toBe(true);
    expect(facts.some((f) => f.startsWith("resp_fvc:"))).toBe(false);
  });
});

// ── Renal renderer ────────────────────────────────────────────────────────────

describe("renderRenalResult — inputFacts clinical labels (Issue 04)", () => {
  const renalToolResult = {
    finalPercent: 25,
    severity: "persisting" as const,
    notes: [],
  };

  it("inputFacts contains 'Patient sex:' label, not raw 'renal_sex'", () => {
    const state = makeState({
      renal_sex: fact("male"),
    });
    const rendered = renderRenalResult(renalToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Patient sex:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("renal_sex:"))).toBe(false);
  });

  it("inputFacts renal_sex value is 'Male', not raw 'male'", () => {
    const state = makeState({
      renal_sex: fact("male"),
    });
    const rendered = renderRenalResult(renalToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    const line = facts.find((f) => f.startsWith("Patient sex:"));
    expect(line).toContain("Male");
    expect(line).not.toMatch(/:\s*male\s*$/);
  });
});

// ── Gastro renderer ───────────────────────────────────────────────────────────

describe("renderGastroResult — inputFacts clinical labels (Issue 04)", () => {
  const gastroToolResult = {
    finalPercent: 15,
    subsystem: "upperGI" as const,
    bracketIndex: 1,
    notes: [],
  };

  it("inputFacts contains 'Subsystem:' label, not raw 'gastro_subsystem'", () => {
    const state = makeState({
      gastro_subsystem: fact("upperGI"),
    });
    const rendered = renderGastroResult(gastroToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    expect(facts.some((f) => f.startsWith("Subsystem:"))).toBe(true);
    expect(facts.some((f) => f.startsWith("gastro_subsystem:"))).toBe(false);
  });

  it("inputFacts subsystem value is clinical label, not raw enum 'upperGI'", () => {
    const state = makeState({
      gastro_subsystem: fact("upperGI"),
    });
    const rendered = renderGastroResult(gastroToolResult, state);
    const facts = rendered.fullBreakdown.inputFacts;
    const line = facts.find((f) => f.startsWith("Subsystem:"));
    expect(line).not.toContain("upperGI");
    expect(line).toContain("Upper GI");
  });
});
