/**
 * GATIOD Calculation Engine — extracted from AcuScore
 * Pure TypeScript functions with no UI dependencies.
 */

export {
  // CVC Calculator
  combineTwoValues,
  combineTwoValuesChart,
  combineMultipleValues,
  combineMultipleValuesChart,
  combineAdditive,
  selectHighest,
} from "./cvcCalculator.js";

export {
  // Types
  type Side,
  type FingerKey,
  type LossType,
  type DeficitType,
  type DbeEntryType,
  type UpperDbeCategory,
  type UpperAnatomicalKey,
  type ArmAmputationLevel,
  type FingerAmputationLevel,
  type AmputationValue,
  type RomLookup,
  type RomDirection,
  type RomJoint,
  type RomJointValue,
  type RomValue,
  type NerveEntry,
  type NerveSelection,
  type NeurologicalValue,
  type DbeCondition,
  type DbeSelection,
  type DbeValue,
  type UpperLimbValue,
  type CategoryResult,
  type UpperLimbResult,

  // Schema
  UpperLimbValueSchema,

  // Lookup tables
  ARM_AMPUTATION_LEVELS,
  FINGER_AMPUTATION_LEVELS,
  ROM_JOINTS,
  UPPER_LIMB_NERVES,
  DBE_CONDITIONS,
  UPPER_ANATOMICAL_LABELS,
  FINGER_LABELS,

  // Calculation functions
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
} from "./upperLimbData.js";
