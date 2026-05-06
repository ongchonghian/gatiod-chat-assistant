/**
 * GATIOD — Visual Function Assessment
 *
 * Section A: Primary Visual Loss (Acuity & Fields) — per eye
 * Section B: Modifiers & Specific Ophthalmic Conditions — per eye
 * Section C: Diplopia (Binocular) — global
 *
 * Rules:
 *  - 50% monocular hard cap per eye (sum of A + B capped at 50)
 *  - Additive binocular rule: left cap + right cap
 *  - 100% total hard cap (including diplopia)
 *  - Legal blindness (<6/60 both eyes) = 100%
 *
 * All percentages sourced from the Sixth Edition GATIOD.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Snellen Acuity Table
// ═══════════════════════════════════════════════════════════════════════════════

export interface SnellenEntry {
  id: string;
  label: string;
  logMar: string;
  percent: number;
}

export const SNELLEN_ACUITY: SnellenEntry[] = [
  { id: "6_6",     label: "6/6",     logMar: "0",    percent: 0  },
  { id: "6_7.5",   label: "6/7.5",   logMar: "0.1",  percent: 5  },
  { id: "6_9",     label: "6/9",     logMar: "0.2",  percent: 10 },
  { id: "6_12",    label: "6/12",    logMar: "0.3",  percent: 15 },
  { id: "6_15",    label: "6/15",    logMar: "0.4",  percent: 20 },
  { id: "6_18",    label: "6/18",    logMar: "0.5",  percent: 25 },
  { id: "6_24",    label: "6/24",    logMar: "0.6",  percent: 30 },
  { id: "6_30",    label: "6/30",    logMar: "0.7",  percent: 35 },
  { id: "6_36",    label: "6/36",    logMar: "0.8",  percent: 40 },
  { id: "6_48",    label: "6/48",    logMar: "0.9",  percent: 45 },
  { id: "6_60",    label: "6/60",    logMar: "1.0",  percent: 50 },
  { id: "lt_6_60", label: "< 6/60 (NLP / light perception / hand movements / counting fingers)", logMar: ">1.0", percent: 50 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Visual Field Loss Table
// ═══════════════════════════════════════════════════════════════════════════════

export interface FieldEntry {
  id: string;
  label: string;
  percent: number;
}

export const VISUAL_FIELD_LOSS: FieldEntry[] = [
  { id: "field_full", label: "Full field (≥120°)", percent: 0 },
  { id: "field_110_120", label: "110° to <120°", percent: 2.5 },
  { id: "field_100_110", label: "100° to 110°", percent: 5 },
  { id: "field_90_100", label: "90° to <100°", percent: 10 },
  { id: "field_80_90", label: "80° to <90°", percent: 15 },
  { id: "field_70_80", label: "70° to <80°", percent: 20 },
  { id: "field_60_70", label: "60° to <70°", percent: 25 },
  { id: "field_50_60", label: "50° to <60°", percent: 30 },
  { id: "field_40_50", label: "40° to <50°", percent: 35 },
  { id: "field_30_40", label: "30° to <40°", percent: 40 },
  { id: "field_20_30", label: "20° to <30°", percent: 45 },
  { id: "field_lt20", label: "<20°", percent: 50 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Functional Modifiers
// ═══════════════════════════════════════════════════════════════════════════════

export interface ModifierEntry {
  id: string;
  label: string;
  description: string;
  percent: number;
}

export const FUNCTIONAL_MODIFIERS: ModifierEntry[] = [
  { id: "accommodation", label: "Loss of accommodation", description: "e.g. pseudophakia/aphakia requiring reading glasses", percent: 20 },
  { id: "contrast_glare", label: "Loss of contrast/glare acuity", description: "Loss of contrast acuity or acuity under glare", percent: 10 },
  { id: "colour", label: "Loss of colour differentiation", description: "Loss of ability to differentiate colour", percent: 10 },
  { id: "astigmatism", label: "Astigmatism / Aniseikonia", description: "Cylinder >-3.50D and/or significant aniseikonia", percent: 10 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Specific Ophthalmic Conditions
// ═══════════════════════════════════════════════════════════════════════════════

export const SPECIFIC_CONDITIONS: ModifierEntry[] = [
  { id: "glaucoma", label: "Glaucoma", description: "Glaucomatous damage", percent: 5 },
  { id: "cataract", label: "Cataract / Lens subluxation", description: "Cataract or subluxation of the lens", percent: 3 },
  { id: "corneal", label: "Corneal opacity/scar", description: "Corneal opacity, scar, or decompensation", percent: 5 },
  { id: "orbital", label: "Orbital deformities", description: "Enophthalmos, hypoglobus, or hyperglobus", percent: 5 },
  { id: "mydriasis", label: "Traumatic mydriasis / Iris abnormalities", description: "Traumatic mydriasis, pupillary, or iris abnormalities", percent: 1 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Diplopia Options
// ═══════════════════════════════════════════════════════════════════════════════

export interface DiplopiaEntry {
  id: string;
  label: string;
  description: string;
  percent: number;
}

export const DIPLOPIA_OPTIONS: DiplopiaEntry[] = [
  { id: "dip_none", label: "None", description: "No diplopia", percent: 0 },
  { id: "dip_uncorrectable", label: "Uncorrectable", description: "Not reasonably corrected by prisms or surgery", percent: 40 },
  { id: "dip_central30", label: "Correctable — Central 30°", description: "Correctable by surgery within the central 30 degrees (i.e. 15 degrees in any direction of fixation)", percent: 30 },
  { id: "dip_30_60", label: "Correctable — 30° to 60°", description: "Correctable by surgery, between 30 and 60 degrees", percent: 15 },
  { id: "dip_beyond60", label: "Correctable — Beyond 60°", description: "Correctable by surgery, beyond 60 degrees", percent: 7.5 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Value Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface EyeValue {
  acuityId: string;
  fieldId: string;
  functionalModifiers: string[];
  specificConditions: string[];
}

export interface VisualValue {
  leftEye: EyeValue;
  rightEye: EyeValue;
  diplopiaId: string;
}

export interface EyeResult {
  acuityPercent: number;
  fieldPercent: number;
  modifiersPercent: number;
  conditionsPercent: number;
  rawTotal: number;
  cappedTotal: number;
}

export interface VisualResult {
  leftEye: EyeResult;
  rightEye: EyeResult;
  binocularSubtotal: number;
  diplopiaPercent: number;
  legalBlindness: boolean;
  finalPercent: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════════

const eyeSchema = z.object({
  acuityId: z.string(),
  fieldId: z.string(),
  functionalModifiers: z.array(z.string()),
  specificConditions: z.array(z.string()),
});

export const visualValueSchema = z.object({
  leftEye: eyeSchema,
  rightEye: eyeSchema,
  diplopiaId: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Default
// ═══════════════════════════════════════════════════════════════════════════════

function defaultEye(): EyeValue {
  return {
    acuityId: "",
    fieldId: "",
    functionalModifiers: [],
    specificConditions: [],
  };
}

export function defaultVisualValue(): VisualValue {
  return {
    leftEye: defaultEye(),
    rightEye: defaultEye(),
    diplopiaId: "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calculation — Pure Functions
// ═══════════════════════════════════════════════════════════════════════════════

const MONOCULAR_CAP = 50;
const TOTAL_CAP = 100;

/**
 * Calculate the raw and capped total for a single eye.
 */
export function calculateEye(eye: EyeValue): EyeResult {
  const acuity = SNELLEN_ACUITY.find((s) => s.id === eye.acuityId);
  const field = VISUAL_FIELD_LOSS.find((f) => f.id === eye.fieldId);

  const acuityPercent = acuity?.percent ?? 0;
  const fieldPercent = field?.percent ?? 0;

  const modifiersPercent = eye.functionalModifiers.reduce((sum, id) => {
    const mod = FUNCTIONAL_MODIFIERS.find((m) => m.id === id);
    return sum + (mod?.percent ?? 0);
  }, 0);

  const conditionsPercent = eye.specificConditions.reduce((sum, id) => {
    const cond = SPECIFIC_CONDITIONS.find((c) => c.id === id);
    return sum + (cond?.percent ?? 0);
  }, 0);

  const rawTotal = acuityPercent + fieldPercent + modifiersPercent + conditionsPercent;
  const cappedTotal = Math.min(rawTotal, MONOCULAR_CAP);

  return { acuityPercent, fieldPercent, modifiersPercent, conditionsPercent, rawTotal, cappedTotal };
}

/**
 * Detect legal blindness: both eyes < 6/60 (best corrected).
 */
export function isLegallyBlind(left: EyeValue, right: EyeValue): boolean {
  return left.acuityId === "lt_6_60" && right.acuityId === "lt_6_60";
}

/**
 * Full visual function calculation.
 */
export function calculateVisual(val: VisualValue): VisualResult {
  const leftEye = calculateEye(val.leftEye);
  const rightEye = calculateEye(val.rightEye);

  const legalBlindness = isLegallyBlind(val.leftEye, val.rightEye);

  if (legalBlindness) {
    return {
      leftEye,
      rightEye,
      binocularSubtotal: 100,
      diplopiaPercent: 0,
      legalBlindness: true,
      finalPercent: 100,
    };
  }

  // Additive binocular rule
  const binocularSubtotal = leftEye.cappedTotal + rightEye.cappedTotal;

  const diplopia = DIPLOPIA_OPTIONS.find((d) => d.id === val.diplopiaId);
  const diplopiaPercent = diplopia?.percent ?? 0;

  const finalPercent = Math.min(binocularSubtotal + diplopiaPercent, TOTAL_CAP);

  return {
    leftEye,
    rightEye,
    binocularSubtotal,
    diplopiaPercent,
    legalBlindness,
    finalPercent,
  };
}
