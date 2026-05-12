/**
 * GATIOD Calculation Engine — all 9 systems extracted from AcuScore.
 * Pure TypeScript functions with no UI dependencies.
 */

// ─── CVC Calculator (shared) ────────────────────────────────────────────────
export {
  combineTwoValues,
  combineTwoValuesChart,
  combineMultipleValues,
  combineMultipleValuesChart,
  combineAdditive,
  selectHighest,
} from "./cvcCalculator.js";

// ─── Upper Limb (Chapter 3) ─────────────────────────────────────────────────
export {
  type Side,
  type FingerKey,
  type UpperLimbValue,
  type UpperLimbResult,
  type CategoryResult,
  UpperLimbValueSchema,
  calculateUpperLimb,
  calculateAmputation,
  calculateRom,
  calculateNeurological,
  calculateDbe,
  resolveDbeRomConflicts,
  lookupRom,
  getRomLookupTable,
  getAmputationSuppressedJoints,
  defaultUpperLimbValue,
  ARM_AMPUTATION_LEVELS,
  FINGER_AMPUTATION_LEVELS,
  ROM_JOINTS,
  UPPER_LIMB_NERVES,
  DBE_CONDITIONS,
  UPPER_ANATOMICAL_LABELS,
  FINGER_LABELS,
} from "./upperLimbData.js";

// ─── Lower Limb (Chapter 4) ─────────────────────────────────────────────────
export {
  type LowerLimbValue,
  type LowerLimbResult,
  type ToeKey,
  type GatiodReference,
  calculateLowerLimb,
  defaultLowerLimbValue,
  LowerLimbValueSchema,
  LEG_AMPUTATION_LEVELS,
  TOE_AMPUTATION_LEVELS,
  LOWER_LIMB_NERVES,
  SHORTENING_TABLE,
  lookupShortening,
  DBE_CONDITIONS as LOWER_DBE_CONDITIONS,
  LOWER_ANATOMICAL_LABELS,
  TOE_LABELS,
} from "./lowerLimbData.js";

// ─── Spine (Chapter 5) ──────────────────────────────────────────────────────
export {
  type SpinalRegion,
  type CategoryEntry as SpineCategoryEntry,
  type SpineAssessmentResult,
  calculateSpineAssessment,
  SpineToolInputSchema,
} from "./spineAssessmentData.js";

// ─── Respiratory (Chapter 6) ────────────────────────────────────────────────
export { type RespiratoryValue, type RespiratoryResult, calculateRespiratoryAssessment, RespiratoryValueSchema } from "./respiratoryData.js";

// ─── Renal (Chapter 7) ──────────────────────────────────────────────────────
export { type RenalValue, type RenalResult, calculateRenalAssessment, RenalValueSchema } from "./renalData.js";

// ─── Gastro/Digestive (Chapter 8) ───────────────────────────────────────────
export {
  type GastroDigestiveValue,
  type GastroDigestiveResult,
  calculateGastroDigestiveAssessment,
  GastroDigestiveValueSchema,
  GASTRO_SUB_SYSTEMS,
} from "./gastroDigestiveData.js";

// ─── Hearing (Chapter 9) ────────────────────────────────────────────────────
export { type HearingValue, type HearingResult, calculateHearing, hearingValueSchema } from "./hearingData.js";

// ─── CNS (Chapter 10) ──────────────────────────────────────────────────────
export { type CnsValue, type CnsResult, calculateCns, defaultCnsValue, cnsValueSchema } from "./cnsAssessmentData.js";

// ─── Visual (Chapter 11) ────────────────────────────────────────────────────
export { type VisualValue, type VisualResult, calculateVisual, defaultVisualValue, visualValueSchema } from "./visualAssessmentData.js";
