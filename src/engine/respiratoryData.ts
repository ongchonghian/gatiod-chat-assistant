/**
 * Respiratory Function Assessment — GATIOD Chapter 6
 *
 * Handles:
 *  1. Pulmonary Function Test (PFT) classification into severity classes
 *  2. Occupational Asthma medication-based overrides
 *  3. Asbestosis / Silicosis 10% minimum floor
 *  4. Final PI% auto-calculation (nearest 5%, highest class wins)
 */

import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiagnosisCategory =
  | "standard"
  | "occupational_asthma"
  | "asbestosis_silicosis";

export const DIAGNOSIS_LABELS: Record<DiagnosisCategory, string> = {
  standard: "Standard Respiratory Impairment (Traumatic / Inhalational / Infection / Chronic Lung Disease)",
  occupational_asthma: "Occupational Asthma",
  asbestosis_silicosis: "Asbestosis / Silicosis",
};

export type AsthmaMaintenanceMedication =
  | "bronchodilators"
  | "low_dose_steroids"
  | "high_dose_steroids"
  | "oral_steroids";

export const ASTHMA_MEDICATION_LABELS: Record<
  AsthmaMaintenanceMedication,
  string
> = {
  bronchodilators: "Bronchodilators only",
  low_dose_steroids: "Low-dose inhaled steroids",
  high_dose_steroids:
    "High-dose (>800 µg/day) inhaled steroid or combination therapy",
  oral_steroids: "Oral steroids",
};

export const ASTHMA_MEDICATION_PI: Record<AsthmaMaintenanceMedication, number> =
  {
    bronchodilators: 5,
    low_dose_steroids: 10,
    high_dose_steroids: 15,
    oral_steroids: 20,
  };

export type AsbestosisProfusionBand = "below_1_1" | "at_least_1_1";

export const ASBESTOSIS_PROFUSION_LABELS: Record<
  AsbestosisProfusionBand,
  string
> = {
  below_1_1: "Below 1/1",
  at_least_1_1: "1/1 or above",
};

export type DyspnoeaSeverity =
  | "none"
  | "on_severe_exertion"
  | "on_moderate_exertion"
  | "on_minimal_exertion";

export const DYSPNOEA_LABELS: Record<DyspnoeaSeverity, string> = {
  none: "None",
  on_severe_exertion: "On severe exertion only",
  on_moderate_exertion: "On moderate exertion (e.g. climbing stairs)",
  on_minimal_exertion: "On minimal exertion or at rest",
};

export type RespiratoryMetricKey = "fvc" | "fev1" | "dlco" | "vo2Max";

interface MetricClassRule {
  matches: (value: number) => boolean;
  label: string;
}

export interface SeverityClass {
  label: string;
  rangeLabel: string;
  min: number;
  max: number;
}

export const SEVERITY_CLASSES: SeverityClass[] = [
  {
    label: "No Impairment",
    rangeLabel: "0%",
    min: 0,
    max: 0,
  },
  {
    label: "Mild Impairment",
    rangeLabel: "10–25%",
    min: 10,
    max: 25,
  },
  {
    label: "Moderate Impairment",
    rangeLabel: "30–45%",
    min: 30,
    max: 45,
  },
  {
    label: "Severe Impairment",
    rangeLabel: "50–100%",
    min: 50,
    max: 100,
  },
];

const METRIC_CLASS_RULES: Record<RespiratoryMetricKey, MetricClassRule[]> = {
  // GATIOD table uses inclusive lower bounds (≥) and exclusive upper bounds (<).
  // Intentional boundary gaps exist in the spec: FVC 50–51, FEV1/DLCO 40–41 are
  // unclassified and will fall through to matchedClassDefinition: false ("Boundary").
  fvc: [
    { label: "No Impairment", matches: (v) => v >= 80 },
    { label: "Mild Impairment", matches: (v) => v >= 60 && v < 80 },
    { label: "Moderate Impairment", matches: (v) => v >= 51 && v < 60 },
    { label: "Severe Impairment", matches: (v) => v < 50 },
  ],
  fev1: [
    { label: "No Impairment", matches: (v) => v >= 80 },
    { label: "Mild Impairment", matches: (v) => v >= 60 && v < 80 },
    { label: "Moderate Impairment", matches: (v) => v >= 41 && v < 60 },
    { label: "Severe Impairment", matches: (v) => v < 40 },
  ],
  dlco: [
    { label: "No Impairment", matches: (v) => v >= 80 },
    { label: "Mild Impairment", matches: (v) => v >= 60 && v < 80 },
    { label: "Moderate Impairment", matches: (v) => v >= 41 && v < 60 },
    { label: "Severe Impairment", matches: (v) => v < 40 },
  ],
  vo2Max: [
    { label: "No Impairment", matches: (v) => v >= 25 },
    { label: "Mild Impairment", matches: (v) => v >= 20 && v < 25 },
    { label: "Moderate Impairment", matches: (v) => v >= 15 && v < 20 },
    { label: "Severe Impairment", matches: (v) => v < 15 },
  ],
};

export interface MetricClassification {
  classIndex: number;
  classLabel: string;
  matchedClassDefinition: boolean;
  value: number | null;
}

// ─── Value schema ─────────────────────────────────────────────────────────────

export const RespiratoryValueSchema = z.object({
  diagnosis: z.enum([
    "standard",
    "occupational_asthma",
    "asbestosis_silicosis",
  ]),
  fvc: z.number().min(0).max(200).nullable(),
  fev1: z.number().min(0).max(200).nullable(),
  dlco: z.number().min(0).max(200).nullable(),
  vo2Max: z.number().min(0).max(100).nullable(),

  // Occupational asthma qualifiers
  asthmaRequiresDailyMaintenance: z.boolean(),
  asthmaTransferredFromExposureOneYear: z.boolean(),
  asthmaUnlikelyFurtherImprovement: z.boolean(),
  asthmaMedication: z
    .enum([
      "bronchodilators",
      "low_dose_steroids",
      "high_dose_steroids",
      "oral_steroids",
    ])
    .nullable(),

  // Asbestosis/silicosis qualifiers
  asbestosisRadiologicallyDefinite: z.boolean(),
  asbestosisProfusion: z.enum(["below_1_1", "at_least_1_1"]),

  selectedPi: z.number().min(0).max(100).nullable(), // doctor's chosen PI within class range
  dyspnoea: z
    .enum(["none", "on_severe_exertion", "on_moderate_exertion", "on_minimal_exertion"])
    .nullable(),
});

export type RespiratoryValue = z.infer<typeof RespiratoryValueSchema>;

export const DEFAULT_RESPIRATORY_VALUE: RespiratoryValue = {
  diagnosis: "standard",
  fvc: null,
  fev1: null,
  dlco: null,
  vo2Max: null,
  asthmaRequiresDailyMaintenance: false,
  asthmaTransferredFromExposureOneYear: false,
  asthmaUnlikelyFurtherImprovement: false,
  asthmaMedication: null,
  asbestosisRadiologicallyDefinite: false,
  asbestosisProfusion: "below_1_1",
  selectedPi: null,
  dyspnoea: null,
};

// ─── Result ───────────────────────────────────────────────────────────────────

export interface RespiratoryResult {
  severityClassIndex: number; // 0–3
  severityLabel: string;
  piRangeMin: number;
  piRangeMax: number;
  recommendedPi: number;
  selectedPi: number;
  isAsthmaOverride: boolean;
  isAsbestosisFloor: boolean;
  asthmaEligible: boolean;
  asbestosisEligible: boolean;
  suppressionReason: string | null;
  /** PI choices the doctor can pick from (multiples of 5 within range) */
  piChoices: number[];
  testClassifications: Record<RespiratoryMetricKey, MetricClassification>;
  baseSeverityClassIndex: number;
  baseSeverityLabel: string;
  basePiRangeMin: number;
  basePiRangeMax: number;
  selectionAdjustedFrom: number | null;
  selectionAdjustmentReason: string | null;
  hardCapApplied: boolean;
  firstScheduleFlag: boolean;
}

// ─── Classification helpers ───────────────────────────────────────────────────

export function classifyRespiratoryMetric(
  value: number | null,
  testKey: RespiratoryMetricKey
): MetricClassification {
  if (value === null) {
    return {
      classIndex: 0,
      classLabel: "No Impairment",
      matchedClassDefinition: false,
      value,
    };
  }

  const classRules = METRIC_CLASS_RULES[testKey];

  for (let i = classRules.length - 1; i >= 0; i--) {
    if (classRules[i].matches(value)) {
      return {
        classIndex: i,
        classLabel: classRules[i].label,
        matchedClassDefinition: true,
        value,
      };
    }
  }

  // Exact threshold values can fall between strict class bands in the table.
  return {
    classIndex: 0,
    classLabel: "No Impairment",
    matchedClassDefinition: false,
    value,
  };
}

function piChoicesForRange(min: number, max: number): number[] {
  const choices: number[] = [];
  const start = Math.ceil(min / 5) * 5;
  for (let v = start; v <= max; v += 5) {
    choices.push(v);
  }
  if (choices.length === 0) choices.push(min);
  return choices;
}

function findNearestChoice(target: number, choices: number[]): number {
  return choices.reduce((nearest, choice) => {
    if (Math.abs(choice - target) < Math.abs(nearest - target)) return choice;
    return nearest;
  }, choices[0]);
}

function normalizeSelectedPi(
  selectedPi: number | null,
  recommendedPi: number,
  choices: number[]
): {
  selectedPi: number;
  selectionAdjustedFrom: number | null;
  selectionAdjustmentReason: string | null;
  hardCapApplied: boolean;
} {
  if (selectedPi === null) {
    return {
      selectedPi: recommendedPi,
      selectionAdjustedFrom: null,
      selectionAdjustmentReason: null,
      hardCapApplied: false,
    };
  }

  let candidate = selectedPi;
  let hardCapApplied = false;
  let reason: string | null = null;

  if (candidate > 100) {
    candidate = 100;
    hardCapApplied = true;
    reason = "hard cap at 100%";
  } else if (candidate < 0) {
    candidate = 0;
    reason = "clamped to valid PI bounds";
  }

  const nearestChoice = findNearestChoice(candidate, choices);
  if (nearestChoice !== candidate) {
    candidate = nearestChoice;
    reason = reason ?? "rounded to nearest selectable 5% value";
  }

  return {
    selectedPi: candidate,
    selectionAdjustedFrom: candidate === selectedPi ? null : selectedPi,
    selectionAdjustmentReason: candidate === selectedPi ? null : reason,
    hardCapApplied,
  };
}

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculateRespiratoryAssessment(
  value: RespiratoryValue
): RespiratoryResult {
  const testClassifications: Record<RespiratoryMetricKey, MetricClassification> = {
    fvc: classifyRespiratoryMetric(value.fvc, "fvc"),
    fev1: classifyRespiratoryMetric(value.fev1, "fev1"),
    dlco: classifyRespiratoryMetric(value.dlco, "dlco"),
    vo2Max: classifyRespiratoryMetric(value.vo2Max, "vo2Max"),
  };

  // Standard PFT classification — highest class wins when at least one measure is abnormal.
  const baseHighestClass = Math.max(
    testClassifications.fvc.classIndex,
    testClassifications.fev1.classIndex,
    testClassifications.dlco.classIndex,
    testClassifications.vo2Max.classIndex
  );

  const baseSeverity = SEVERITY_CLASSES[baseHighestClass];
  const basePiMin = baseSeverity.min;
  const basePiMax = baseSeverity.max;

  const asthmaEligible =
    value.diagnosis === "occupational_asthma" &&
    value.asthmaRequiresDailyMaintenance &&
    value.asthmaTransferredFromExposureOneYear &&
    value.asthmaUnlikelyFurtherImprovement &&
    value.fev1 !== null &&
    value.fev1 > 80 &&
    value.asthmaMedication !== null;

  const asbestosisEligible =
    value.diagnosis === "asbestosis_silicosis" &&
    value.asbestosisRadiologicallyDefinite &&
    value.asbestosisProfusion === "at_least_1_1";

  let severityClassIndex = baseHighestClass;
  let severityLabel = baseSeverity.label;
  let piRangeMin = basePiMin;
  let piRangeMax = basePiMax;
  let isAsthmaOverride = false;
  let isAsbestosisFloor = false;
  let suppressionReason: string | null = null;

  if (asthmaEligible && value.asthmaMedication) {
    const asthmaPi = ASTHMA_MEDICATION_PI[value.asthmaMedication];
    severityClassIndex = 1;
    severityLabel = "Occupational Asthma (Medication-based)";
    piRangeMin = asthmaPi;
    piRangeMax = asthmaPi;
    isAsthmaOverride = true;
    suppressionReason =
      "Occupational asthma override active: qualifying medication pathway bypasses standard PFT class selection.";
  } else if (asbestosisEligible && baseHighestClass === 0) {
    severityClassIndex = 1;
    severityLabel = "Asbestosis/Silicosis Minimum Floor";
    piRangeMin = 10;
    piRangeMax = 10;
    isAsbestosisFloor = true;
  }

  const choices = piChoicesForRange(piRangeMin, piRangeMax);
  const midpoint = (piRangeMin + piRangeMax) / 2;
  const recommended = findNearestChoice(Math.round(midpoint / 5) * 5, choices);

  const selected = normalizeSelectedPi(value.selectedPi, recommended, choices);
  const firstScheduleFlag = selected.selectedPi === 100;

  return {
    severityClassIndex,
    severityLabel,
    piRangeMin,
    piRangeMax,
    recommendedPi: recommended,
    selectedPi: selected.selectedPi,
    isAsthmaOverride,
    isAsbestosisFloor,
    asthmaEligible,
    asbestosisEligible,
    suppressionReason,
    piChoices: choices,
    testClassifications,
    baseSeverityClassIndex: baseHighestClass,
    baseSeverityLabel: baseSeverity.label,
    basePiRangeMin: basePiMin,
    basePiRangeMax: basePiMax,
    selectionAdjustedFrom: selected.selectionAdjustedFrom,
    selectionAdjustmentReason: selected.selectionAdjustmentReason,
    hardCapApplied: selected.hardCapApplied,
    firstScheduleFlag,
  };
}
