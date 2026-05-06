/**
 * Renal Function Assessment — GATIOD Chapter 7
 *
 * Handles:
 *  1. Classification into 4 severity classes (0–10%, 11–30%, 31–60%, 61–100%)
 *  2. Sex-specific serum creatinine thresholds
 *  3. Creatinine clearance classification
 *  4. CKD stage classification
 *  5. Clinical signs/symptoms classification
 *  6. Highest Class Override rule
 *  7. Solitary Kidney 10% base modifier
 *  8. Provisional Award flag
 *  9. PI auto-calculation (nearest 5%, highest class wins)
 */

import { z } from "zod";
import { combineTwoValuesChart } from "./cvcCalculator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PatientSex = "male" | "female";

export const PATIENT_SEX_LABELS: Record<PatientSex, string> = {
  male: "Male",
  female: "Female",
};

export type CkdStage = 1 | 2 | 3 | 4 | 5;

export const CKD_STAGE_LABELS: Record<CkdStage, string> = {
  1: "Stage 1 — Normal or high GFR (≥ 90 mL/min)",
  2: "Stage 2 — Mildly decreased GFR (60–89 mL/min)",
  3: "Stage 3 — Moderately decreased GFR (30–59 mL/min)",
  4: "Stage 4 — Severely decreased GFR (15–29 mL/min)",
  5: "Stage 5 — Kidney failure (< 15 mL/min)",
};

export type ClinicalSeverity =
  | "none"
  | "continuous_surveillance"
  | "incompletely_controlled"
  | "persisting";

export const CLINICAL_SEVERITY_LABELS: Record<ClinicalSeverity, string> = {
  none: "None or intermittent, not requiring treatment",
  continuous_surveillance:
    "Objective clinical evidence of dysfunction — Necessitating continuous surveillance and frequent treatment",
  incompletely_controlled:
    "Objective clinical evidence of dysfunction — Incompletely controlled by surgical or continuous medical treatment",
  persisting:
    "Objective clinical evidence of dysfunction — Persisting despite surgical or continuous medical treatment",
};

// ─── Severity Classes ─────────────────────────────────────────────────────────

export interface RenalSeverityClass {
  label: string;
  rangeLabel: string;
  min: number;
  max: number;
  ckdStages: CkdStage[];
  creatinineClearanceRange: [number, number] | null; // [low, high], inclusive
  serumCreatinineMale: [number, number] | null; // inclusive
  serumCreatinineFemale: [number, number] | null; // inclusive
  clinicalSeverities: ClinicalSeverity[];
}

export const SEVERITY_CLASSES: RenalSeverityClass[] = [
  {
    label: "No / Minimal Impairment",
    rangeLabel: "0–10%",
    min: 0,
    max: 10,
    ckdStages: [1],
    creatinineClearanceRange: [60, 69],
    serumCreatinineMale: [111, 138],
    serumCreatinineFemale: [86, 113],
    clinicalSeverities: ["none"],
  },
  {
    label: "Mild Impairment",
    rangeLabel: "11–30%",
    min: 11,
    max: 30,
    ckdStages: [2],
    creatinineClearanceRange: [45, 59],
    serumCreatinineMale: [139, 178],
    serumCreatinineFemale: [114, 153],
    clinicalSeverities: ["continuous_surveillance"],
  },
  {
    label: "Moderate Impairment",
    rangeLabel: "31–60%",
    min: 31,
    max: 60,
    ckdStages: [3],
    creatinineClearanceRange: [30, 44],
    serumCreatinineMale: [179, 283],
    serumCreatinineFemale: [154, 268],
    clinicalSeverities: ["incompletely_controlled"],
  },
  {
    label: "Severe Impairment",
    rangeLabel: "61–100%",
    min: 61,
    max: 100,
    ckdStages: [4, 5],
    creatinineClearanceRange: [0, 29],
    serumCreatinineMale: [284, Infinity],
    serumCreatinineFemale: [269, Infinity],
    clinicalSeverities: ["persisting"],
  },
];

// ─── Value Schema ─────────────────────────────────────────────────────────────

export const RenalValueSchema = z.object({
  sex: z.enum(["male", "female"]),
  serumCreatinine: z.number().min(0).nullable(),
  creatinineClearance: z.number().min(0).nullable(),
  ckdStage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  clinicalSeverity: z
    .enum(["none", "continuous_surveillance", "incompletely_controlled", "persisting"])
    .nullable(),
  solitaryKidney: z.boolean(),
  provisionalAward: z.boolean(),
  selectedPi: z.number().nullable(),
});

export type RenalValue = z.infer<typeof RenalValueSchema>;

export const DEFAULT_RENAL_VALUE: RenalValue = {
  sex: "male",
  serumCreatinine: null,
  creatinineClearance: null,
  ckdStage: null,
  clinicalSeverity: null,
  solitaryKidney: false,
  provisionalAward: true, // provisional by default per GATIOD
  selectedPi: null,
};

// ─── Result ───────────────────────────────────────────────────────────────────

export interface RenalResult {
  severityClassIndex: number; // 0–3
  severityLabel: string;
  piRangeMin: number;
  piRangeMax: number;
  recommendedPi: number;
  /** Selected PI% within class range (before solitary-kidney combination). */
  selectedPi: number;
  /** Alias for clarity in traces/UI. */
  baseSelectedPi: number;
  /** Final renal PI% after applying modifier rules (e.g. solitary-kidney CVC). */
  finalPi: number;
  /** Whether any classifying input was provided (labs/CKD/clinical). */
  hasClassifyingInput: boolean;
  isSolitaryKidneyBase: boolean;
  solitaryKidneyPi: number;
  isProvisional: boolean;
  piChoices: number[];
  selectionAdjustedFrom: number | null;
  selectionAdjustmentReason: string | null;
  hardCapApplied: boolean;
  /** Per-input class indices for transparency */
  serumCreatinineClass: number;
  creatinineClearanceClass: number;
  ckdClass: number;
  clinicalClass: number;
}

// ─── Classification Helpers ───────────────────────────────────────────────────

export function classifySerumCreatinine(
  value: number | null,
  sex: PatientSex
): number {
  if (value === null) return 0;
  const key =
    sex === "male" ? "serumCreatinineMale" : "serumCreatinineFemale";
  for (let i = SEVERITY_CLASSES.length - 1; i >= 0; i--) {
    const range = SEVERITY_CLASSES[i][key];
    if (range && value >= range[0] && value <= range[1]) return i;
  }
  return 0;
}

export function classifyCreatinineClearance(value: number | null): number {
  if (value === null) return 0;
  for (let i = SEVERITY_CLASSES.length - 1; i >= 0; i--) {
    const range = SEVERITY_CLASSES[i].creatinineClearanceRange;
    if (range && value >= range[0] && value <= range[1]) return i;
  }
  return 0;
}

export function classifyCkdStage(stage: CkdStage | null): number {
  if (stage === null) return 0;
  for (let i = SEVERITY_CLASSES.length - 1; i >= 0; i--) {
    if (SEVERITY_CLASSES[i].ckdStages.includes(stage)) return i;
  }
  return 0;
}

export function classifyClinicalSeverity(
  severity: ClinicalSeverity | null
): number {
  if (severity === null) return 0;
  for (let i = SEVERITY_CLASSES.length - 1; i >= 0; i--) {
    if (SEVERITY_CLASSES[i].clinicalSeverities.includes(severity)) return i;
  }
  return 0;
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

// ─── Main Calculation ─────────────────────────────────────────────────────────

export function calculateRenalAssessment(value: RenalValue): RenalResult {
  const hasClassifyingInput =
    value.serumCreatinine !== null ||
    value.creatinineClearance !== null ||
    value.ckdStage !== null ||
    value.clinicalSeverity !== null;

  const scClass = classifySerumCreatinine(value.serumCreatinine, value.sex);
  const ccClass = classifyCreatinineClearance(value.creatinineClearance);
  const ckdClass = classifyCkdStage(value.ckdStage);
  const clinClass = classifyClinicalSeverity(value.clinicalSeverity);

  // Highest class override
  const highestClass = hasClassifyingInput
    ? Math.max(scClass, ccClass, ckdClass, clinClass)
    : 0;

  const severity = SEVERITY_CLASSES[highestClass];
  const piMin = severity.min;
  const piMax = severity.max;

  const choices = hasClassifyingInput ? piChoicesForRange(piMin, piMax) : [0];
  const midpoint = (piMin + piMax) / 2;
  const roundedMidpoint = Math.round(midpoint / 5) * 5;
  const recommended = hasClassifyingInput
    ? findNearestChoice(roundedMidpoint, choices)
    : 0;

  const normalized = normalizeSelectedPi(value.selectedPi, recommended, choices);
  const baseSelectedPi = normalized.selectedPi;

  // Solitary kidney: fixed 10%, combined using CVC (not additive stacking).
  const solitaryPi = value.solitaryKidney ? 10 : 0;
  const combinedWithSolitary = value.solitaryKidney
    ? combineTwoValuesChart(baseSelectedPi, solitaryPi)
    : baseSelectedPi;
  const finalPi = Math.min(combinedWithSolitary, 100);
  const hardCapApplied = normalized.hardCapApplied || combinedWithSolitary > 100;

  return {
    severityClassIndex: highestClass,
    severityLabel: severity.label,
    piRangeMin: piMin,
    piRangeMax: piMax,
    recommendedPi: recommended,
    selectedPi: baseSelectedPi,
    baseSelectedPi,
    finalPi,
    hasClassifyingInput,
    isSolitaryKidneyBase: value.solitaryKidney,
    solitaryKidneyPi: solitaryPi,
    isProvisional: value.provisionalAward,
    piChoices: choices,
    selectionAdjustedFrom: normalized.selectionAdjustedFrom,
    selectionAdjustmentReason: normalized.selectionAdjustmentReason,
    hardCapApplied,
    serumCreatinineClass: scClass,
    creatinineClearanceClass: ccClass,
    ckdClass,
    clinicalClass: clinClass,
  };
}
