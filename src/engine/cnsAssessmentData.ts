/**
 * GATIOD Chapter 10 — Central Nervous System Assessment
 *
 * Section A: Cerebral impairments -> highest-score selection.
 * Section B: Other neurological impairments -> CVC combination.
 * Section C: Paralysed limbs -> amputation-equivalent mapping.
 */

import { z } from "zod";
import { combineMultipleValuesChart } from "./cvcCalculator.js";

// ═══════════════════════════════════════════════════════════════════════════════
// CVC helper (Appendix chart behavior)
// ═══════════════════════════════════════════════════════════════════════════════

export function combineCVC(a: number, b: number): number {
  return combineMultipleValuesChart([a, b]);
}

export function combineMultipleCVC(values: number[]): number {
  return combineMultipleValuesChart(values);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SeverityBracket {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
}

export interface GroupSelection {
  bracketId: string;
  value: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section A: Cerebral impairment brackets
// Source: gatiod.txt lines 3450-3644
// ═══════════════════════════════════════════════════════════════════════════════

export const GROUP1_SUBCATEGORIES = [
  {
    id: "consciousness",
    label: "Group 1A: Consciousness and Awareness",
    brackets: [
      { id: "c_none", label: "None", description: "No ratable disturbance selected.", min: 0, max: 0 },
      {
        id: "c_brief_minimal",
        label: "Brief/Persistent with Minimal ADL Limitation (5-25%)",
        description: "Brief repetitive or persistent alteration with minimal daily living limitation.",
        min: 5,
        max: 25,
      },
      {
        id: "c_brief_moderate",
        label: "Brief/Persistent with Moderate ADL Limitation (26-99%)",
        description: "Brief repetitive or persistent alteration with moderate daily living limitation.",
        min: 26,
        max: 99,
      },
      {
        id: "c_prolonged",
        label: "Prolonged Consciousness Impairment (100%)",
        description: "Prolonged consciousness impairment diminishing personal care and daily activities.",
        min: 100,
        max: 100,
      },
      {
        id: "c_coma",
        label: "Coma/Semi-coma with Total Dependency (100%)",
        description: "Coma or semi-coma requiring total medical or nursing dependency.",
        min: 100,
        max: 100,
      },
    ] as SeverityBracket[],
  },
  {
    id: "episodic",
    label: "Group 1B: Episodic Neurological Impairment (e.g. epileptic seizures)",
    brackets: [
      { id: "e_none", label: "None", description: "No ratable episodic impairment selected.", min: 0, max: 0 },
      {
        id: "e_predictable",
        label: "Paroxysmal Disorder with Risk/Limitation (10-25%)",
        description: "Predictable characteristics with unpredictable occurrence and risk or activity limitation.",
        min: 10,
        max: 25,
      },
      {
        id: "e_interferes",
        label: "Interferes with Some Daily Activities (26-99%)",
        description: "Paroxysmal disorder that interferes with some daily activities.",
        min: 26,
        max: 99,
      },
      {
        id: "e_severe_supervised",
        label: "Severe Frequency with Supervised/Restricted Activities (100%)",
        description: "Severe paroxysmal disorder of such frequency that it limits activities to those that are supervised, protected or restricted, AND additional neurological symptoms or signs of focal or generalized nature are present.",
        min: 100,
        max: 100,
      },
      {
        id: "e_uncontrolled",
        label: "Uncontrolled High-frequency/Constant Disorder (100%)",
        description: "Uncontrolled frequency and constancy severely limiting daily activities.",
        min: 100,
        max: 100,
      },
    ] as SeverityBracket[],
  },
  {
    id: "arousal",
    label: "Group 1C: Arousal and Sleep Disorders",
    brackets: [
      { id: "a_none", label: "None", description: "No ratable arousal/sleep disorder selected.", min: 0, max: 0 },
      {
        id: "a_reduced_most",
        label: "Reduced Alertness, Most ADL Preserved (10-25%)",
        description: "Reduced daytime alertness with ability to perform most activities of daily living.",
        min: 10,
        max: 25,
      },
      {
        id: "a_reduced_some",
        label: "Reduced Alertness, Some ADL Limited (26-99%)",
        description: "Reduced daytime alertness interfering with ability to perform some daily activities.",
        min: 26,
        max: 99,
      },
      {
        id: "a_significant_limit",
        label: "Significantly Limited ADL Ability (100%)",
        description: "Reduced alertness significantly limiting ability to perform activities of daily living.",
        min: 100,
        max: 100,
      },
      {
        id: "a_unable_selfcare",
        label: "Unable to Care for Self in Any Situation (100%)",
        description: "Severe alertness reduction causing inability to care for self in any manner.",
        min: 100,
        max: 100,
      },
    ] as SeverityBracket[],
  },
] as const;

export const GROUP2_BRACKETS: SeverityBracket[] = [
  { id: "ms_none", label: "None", description: "No ratable mental-status impairment selected.", min: 0, max: 0 },
  {
    id: "ms_slight",
    label: "Slight Forgetfulness / Minor Integrative Deficit (5-10%)",
    description: "Fully self-caring with slight forgetfulness and slight impairment in integrative functioning.",
    min: 5,
    max: 10,
  },
  {
    id: "ms_moderate",
    label: "Moderate Memory/Integrative Deficit (11-99%)",
    description: "Moderate memory loss and integrative difficulty affecting everyday activities.",
    min: 11,
    max: 99,
  },
  {
    id: "ms_severe",
    label: "Severe Memory/Integrative Deficit (100%)",
    description: "Severe memory and integrative deficits with significant dependence in personal care.",
    min: 100,
    max: 100,
  },
  {
    id: "ms_fragment_only",
    label: "Fragments Remain / Person-oriented Only (100%)",
    description: "Only memory fragments remain with profound dependency and frequent incontinence.",
    min: 100,
    max: 100,
  },
];

export const GROUP3_BRACKETS: SeverityBracket[] = [
  { id: "co_none", label: "None", description: "No ratable dysphasia/aphasia impairment selected.", min: 0, max: 0 },
  {
    id: "co_minimal",
    label: "Minimal Language Disturbance (10-25%)",
    description: "Minimal disturbance in comprehension and production of language symbols.",
    min: 10,
    max: 25,
  },
  {
    id: "co_moderate",
    label: "Moderate Language Impairment (26-99%)",
    description: "Moderate impairment in comprehension and production of language symbols.",
    min: 26,
    max: 99,
  },
  {
    id: "co_severe_or_complete",
    label: "Unintelligible/Inappropriate Language or Complete Inability (100%)",
    description: "Able to comprehend nonverbal communication; production of unintelligible or inappropriate language for daily activities. OR: Complete inability to communicate or comprehend language symbols.",
    min: 100,
    max: 100,
  },
];

export const GROUP4_BRACKETS: SeverityBracket[] = [
  { id: "em_none", label: "None", description: "No ratable emotional/behavioural impairment selected.", min: 0, max: 0 },
  {
    id: "em_mild",
    label: "Mild ADL/Social Limitation (10-25%)",
    description: "Mild limitation of daily activities and social/interpersonal functioning.",
    min: 10,
    max: 25,
  },
  {
    id: "em_moderate",
    label: "Moderate ADL/Social Limitation (26-99%)",
    description: "Moderate limitation of daily activities and social/interpersonal functioning.",
    min: 26,
    max: 99,
  },
  {
    id: "em_severe",
    label: "Severe Limitation / Total Dependence (100%)",
    description: "Severe limitation in most or all daily activities with major dependence.",
    min: 100,
    max: 100,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Section B: Other neurological impairment brackets
// Source: gatiod.txt lines 3656-3753
// ═══════════════════════════════════════════════════════════════════════════════

export const OLFACTION_BRACKETS: SeverityBracket[] = [
  { id: "ol_none", label: "None", description: "No olfactory impairment selected.", min: 0, max: 0 },
  {
    id: "ol_anosmia",
    label: "Anosmia (Maximum 5%)",
    description: "Maximum impairment from anosmia is 5%.",
    min: 5,
    max: 5,
  },
];

export const FACIAL_NERVE_BRACKETS: SeverityBracket[] = [
  { id: "fn_none", label: "None", description: "No facial nerve impairment selected.", min: 0, max: 0 },
  {
    id: "fn_mild_unilateral",
    label: "Taste Loss / Mild Unilateral Weakness (1-4%)",
    description: "Complete anterior tongue taste loss, or mild unilateral facial weakness.",
    min: 1,
    max: 4,
  },
  {
    id: "fn_mildmoderate_bilateral_or_severe_unilateral",
    label: "Mild-Moderate Bilateral or Severe Unilateral (5-19%)",
    description: "Mild-moderate bilateral weakness or severe unilateral weakness with >=75% involvement and eyelid control loss.",
    min: 5,
    max: 19,
  },
  {
    id: "fn_severe_bilateral",
    label: "Severe Bilateral Paralysis (20-45%)",
    description: "Severe bilateral facial paralysis with >=75% involvement and eyelid control loss.",
    min: 20,
    max: 45,
  },
];

export const EQUILIBRIUM_BRACKETS: SeverityBracket[] = [
  { id: "eq_none", label: "None", description: "No equilibrium impairment selected.", min: 0, max: 0 },
  {
    id: "eq_minimal",
    label: "Minimal Equilibrium Impairment (25-50%)",
    description: "Limitation required only in hazardous surroundings.",
    min: 25,
    max: 50,
  },
  {
    id: "eq_moderate_to_mod_severe",
    label: "Moderate to Moderately Severe Impairment (51-100%)",
    description: "Limitation required for all daily activities, including self-care at higher severity.",
    min: 51,
    max: 100,
  },
  {
    id: "eq_severe_assisted",
    label: "Severe Equilibrium Impairment (100%)",
    description: "Assistance required for self-care and ambulation; confinement may be needed.",
    min: 100,
    max: 100,
  },
];

export const SWALLOWING_BRACKETS: SeverityBracket[] = [
  { id: "sw_none", label: "None", description: "No IX/X/XII swallowing-speech impairment selected.", min: 0, max: 0 },
  {
    id: "sw_mild",
    label: "Mild Dysarthria/Dysphagia with Choking (50%)",
    description: "Mild dysarthria, dystonia, or dysphagia with choking on liquids/semisolids.",
    min: 50,
    max: 50,
  },
  {
    id: "sw_moderately_severe",
    label: "Moderately Severe Dysarthria/Dysphagia (100%)",
    description: "Moderately severe dysarthria/dysphagia with hoarseness, nasal regurgitation and aspiration.",
    min: 100,
    max: 100,
  },
  {
    id: "sw_severe",
    label: "Severe Inability to Swallow Secretions (100%)",
    description: "Severe inability to swallow/handle oral secretions without choking; requires assistance and suctioning.",
    min: 100,
    max: 100,
  },
];

export const STATION_GAIT_BRACKETS: SeverityBracket[] = [
  { id: "sg_none", label: "None", description: "No station/gait impairment selected.", min: 0, max: 0 },
  {
    id: "sg_walks_difficult",
    label: "Walks with Difficulty (25-50%)",
    description: "Can rise and walk but has difficulty with elevations, stairs, and long distances.",
    min: 25,
    max: 50,
  },
  {
    id: "sg_level_only",
    label: "Walks Limited to Level Surfaces (51-99%)",
    description: "Can rise and walk some distance without assistance but limited to level surfaces.",
    min: 51,
    max: 99,
  },
  {
    id: "sg_cannot_walk_or_stand",
    label: "Cannot Walk Without Assistance / Cannot Stand (100%)",
    description: "Maintains standing with difficulty and cannot walk unassisted, or cannot stand without support/device.",
    min: 100,
    max: 100,
  },
];

export const RESPIRATION_BRACKETS: SeverityBracket[] = [
  { id: "re_none", label: "None", description: "No CNS respiratory impairment selected.", min: 0, max: 0 },
  {
    id: "re_limited_ambulation",
    label: "Spontaneous Respiration with Limited Ambulation (100%)",
    description: "Spontaneous respiration present but restricted to sitting, standing, or limited ambulation.",
    min: 100,
    max: 100,
  },
  {
    id: "re_confined_bed",
    label: "Spontaneous Respiration, Confined to Bed (100%)",
    description: "Spontaneous respiration exists but so limited that confinement to bed is required.",
    min: 100,
    max: 100,
  },
  {
    id: "re_no_capacity",
    label: "No Capacity for Spontaneous Respiration (100%)",
    description: "No spontaneous respiration capacity.",
    min: 100,
    max: 100,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Section C: Paralysed limbs mapped to amputation-equivalent values
// Source: gatiod.txt line 3735-3738 + limb amputation tables lines 509-527, 1626-1642
// ═══════════════════════════════════════════════════════════════════════════════

export interface LimbOption {
  id: string;
  label: string;
  percent: number;
  region: "upper" | "lower";
  scope: "single" | "bilateral";
}

export const PARALYSED_LIMB_OPTIONS: LimbOption[] = [
  {
    id: "both_upper_limbs",
    label: "Both upper limbs / both hands",
    percent: 100,
    region: "upper",
    scope: "bilateral",
  },
  {
    id: "upper_limb_at_or_above_elbow",
    label: "One upper limb at or above elbow",
    percent: 75,
    region: "upper",
    scope: "single",
  },
  {
    id: "upper_limb_below_elbow_or_hand",
    label: "One upper limb below elbow / hand at wrist",
    percent: 70,
    region: "upper",
    scope: "single",
  },
  {
    id: "one_hand_four_fingers",
    label: "Four fingers of one hand",
    percent: 60,
    region: "upper",
    scope: "single",
  },
  {
    id: "both_lower_limbs_or_feet",
    label: "Both lower limbs / both feet",
    percent: 100,
    region: "lower",
    scope: "bilateral",
  },
  {
    id: "lower_limb_at_or_above_knee",
    label: "One lower limb at or above knee",
    percent: 75,
    region: "lower",
    scope: "single",
  },
  {
    id: "lower_limb_below_knee",
    label: "One lower limb below knee",
    percent: 65,
    region: "lower",
    scope: "single",
  },
  {
    id: "foot_at_ankle_syme",
    label: "One foot at ankle (Syme)",
    percent: 55,
    region: "lower",
    scope: "single",
  },
  {
    id: "midfoot",
    label: "One midfoot",
    percent: 35,
    region: "lower",
    scope: "single",
  },
  {
    id: "all_toes_one_foot",
    label: "All toes of one foot",
    percent: 20,
    region: "lower",
    scope: "single",
  },
];

const VALID_LIMB_IDS = new Set(PARALYSED_LIMB_OPTIONS.map((option) => option.id));
const UPPER_BILATERAL_ID = "both_upper_limbs";
const LOWER_BILATERAL_ID = "both_lower_limbs_or_feet";

const UPPER_SINGLE_IDS = new Set(
  PARALYSED_LIMB_OPTIONS.filter((option) => option.region === "upper" && option.scope === "single").map(
    (option) => option.id
  )
);

const LOWER_SINGLE_IDS = new Set(
  PARALYSED_LIMB_OPTIONS.filter((option) => option.region === "lower" && option.scope === "single").map(
    (option) => option.id
  )
);

export function normalizeParalysedLimbs(input: string[]): string[] {
  const uniqueOrdered: string[] = [];
  for (const id of input) {
    if (!VALID_LIMB_IDS.has(id)) continue;
    if (!uniqueOrdered.includes(id)) uniqueOrdered.push(id);
  }

  const hasUpperBilateral = uniqueOrdered.includes(UPPER_BILATERAL_ID);
  const hasLowerBilateral = uniqueOrdered.includes(LOWER_BILATERAL_ID);

  const upperSingles = uniqueOrdered.filter((id) => UPPER_SINGLE_IDS.has(id));
  const lowerSingles = uniqueOrdered.filter((id) => LOWER_SINGLE_IDS.has(id));

  const normalized: string[] = [];

  if (hasUpperBilateral) {
    normalized.push(UPPER_BILATERAL_ID);
  } else if (upperSingles.length > 0) {
    normalized.push(upperSingles[upperSingles.length - 1]);
  }

  if (hasLowerBilateral) {
    normalized.push(LOWER_BILATERAL_ID);
  } else if (lowerSingles.length > 0) {
    normalized.push(lowerSingles[lowerSingles.length - 1]);
  }

  return normalized;
}

export function toggleParalysedLimb(current: string[], limbId: string): string[] {
  if (!VALID_LIMB_IDS.has(limbId)) return normalizeParalysedLimbs(current);

  if (current.includes(limbId)) {
    return normalizeParalysedLimbs(current.filter((id) => id !== limbId));
  }

  return normalizeParalysedLimbs([...current, limbId]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Value types
// ═══════════════════════════════════════════════════════════════════════════════

export interface CnsValue {
  // Section A
  group1Consciousness: GroupSelection;
  group1Episodic: GroupSelection;
  group1Arousal: GroupSelection;
  group2: GroupSelection;
  group2NeuropsychologistConfirmed: boolean;
  group3: GroupSelection;
  group4: GroupSelection;
  group4PsychiatristConfirmed: boolean;

  // Section B
  olfaction: GroupSelection;
  facialNerve: GroupSelection;
  equilibrium: GroupSelection;
  equilibriumEntConfirmed: boolean;
  swallowing: GroupSelection;
  stationGait: GroupSelection;
  respiration: GroupSelection;

  // Section C
  paralysedLimbs: string[];
}

export interface CnsResult {
  // Section A
  group1Value: number;
  group1WinnerSubcategory: string;
  group2Value: number;
  group3Value: number;
  group4Value: number;
  sectionAHighest: number;
  sectionAHighestGroup: string;
  sectionATieGroups: string[];
  sectionAScores: { label: string; value: number; winner: boolean }[];

  // Section B
  sectionBValues: { label: string; value: number }[];
  sectionBCombined: number;

  // Section C
  sectionCValues: { label: string; value: number }[];
  sectionCLimbIds: string[];
  sectionCTotal: number;
  firstScheduleBonus: boolean;

  // Final
  combinedAB: number;
  finalBeforeCap: number;
  finalPercent: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════════

const ZERO: GroupSelection = { bracketId: "", value: 0 };

export function defaultCnsValue(): CnsValue {
  return {
    group1Consciousness: { ...ZERO },
    group1Episodic: { ...ZERO },
    group1Arousal: { ...ZERO },
    group2: { ...ZERO },
    group2NeuropsychologistConfirmed: false,
    group3: { ...ZERO },
    group4: { ...ZERO },
    group4PsychiatristConfirmed: false,
    olfaction: { ...ZERO },
    facialNerve: { ...ZERO },
    equilibrium: { ...ZERO },
    equilibriumEntConfirmed: false,
    swallowing: { ...ZERO },
    stationGait: { ...ZERO },
    respiration: { ...ZERO },
    paralysedLimbs: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calculation
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateCns(val: CnsValue): CnsResult {
  const normalizedLimbs = normalizeParalysedLimbs(val.paralysedLimbs);

  // Section A
  const group1SubValues = [
    { label: "Group 1A: Consciousness and awareness", value: val.group1Consciousness.value },
    { label: "Group 1B: Episodic neurological impairment", value: val.group1Episodic.value },
    { label: "Group 1C: Arousal and sleep disorders", value: val.group1Arousal.value },
  ];

  const group1Winner = group1SubValues.reduce(
    (best, current) => (current.value > best.value ? current : best),
    group1SubValues[0]
  );

  const group1Value = group1Winner.value;
  const group1WinnerSubcategory = group1Winner.label;

  const group2Value = val.group2.value > 0 && !val.group2NeuropsychologistConfirmed ? 0 : val.group2.value;
  const group3Value = val.group3.value;
  const group4Value = val.group4.value > 0 && !val.group4PsychiatristConfirmed ? 0 : val.group4.value;

  const sectionAGroups = [
    { label: "Group 1: Consciousness, awareness, arousal", value: group1Value },
    { label: "Group 2: Mental status and cognition", value: group2Value },
    { label: "Group 3: Dysphasia/aphasia", value: group3Value },
    { label: "Group 4: Emotional/behavioural", value: group4Value },
  ];

  const sectionAWinner = sectionAGroups.reduce(
    (best, current) => (current.value > best.value ? current : best),
    sectionAGroups[0]
  );

  const sectionAHighest = sectionAWinner.value;
  const sectionAHighestGroup = sectionAWinner.label;
  const sectionATieGroups =
    sectionAHighest > 0
      ? sectionAGroups.filter((group) => group.value === sectionAHighest).map((group) => group.label)
      : [];

  const sectionAScores = sectionAGroups.map((g) => ({
    label: g.label,
    value: g.value,
    winner: g.label === sectionAHighestGroup,
  }));

  // Section B
  const sectionBValues: { label: string; value: number }[] = [];
  if (val.olfaction.value > 0) sectionBValues.push({ label: "Olfaction", value: val.olfaction.value });
  if (val.facialNerve.value > 0) sectionBValues.push({ label: "Facial nerves", value: val.facialNerve.value });
  const equilibriumValue = val.equilibrium.value > 0 && val.equilibriumEntConfirmed === false ? 0 : val.equilibrium.value;
  if (equilibriumValue > 0) sectionBValues.push({ label: "Equilibrium", value: equilibriumValue });
  if (val.swallowing.value > 0) sectionBValues.push({ label: "Cranial nerves IX/X/XII (swallowing/speech)", value: val.swallowing.value });
  if (val.stationGait.value > 0) sectionBValues.push({ label: "Station and gait", value: val.stationGait.value });
  if (val.respiration.value > 0) sectionBValues.push({ label: "Neurological respiration", value: val.respiration.value });

  const sectionBCombined = combineMultipleCVC(sectionBValues.map((entry) => entry.value));

  // Section C
  const sectionCValues = normalizedLimbs
    .map((id) => PARALYSED_LIMB_OPTIONS.find((option) => option.id === id))
    .filter((option): option is LimbOption => Boolean(option))
    .map((option) => ({ label: option.label, value: option.percent }));

  const sectionCTotal = combineMultipleCVC(sectionCValues.map((entry) => entry.value));
  const firstScheduleBonus = normalizedLimbs.includes(UPPER_BILATERAL_ID);

  // Final
  const combinedAB = combineMultipleCVC([sectionAHighest, sectionBCombined]);
  const finalBeforeCap = combineMultipleCVC([sectionAHighest, sectionBCombined, sectionCTotal]);
  const finalPercent = Math.min(Math.max(finalBeforeCap, 0), 100);

  return {
    group1Value,
    group1WinnerSubcategory,
    group2Value,
    group3Value,
    group4Value,
    sectionAHighest,
    sectionAHighestGroup,
    sectionATieGroups,
    sectionAScores,
    sectionBValues,
    sectionBCombined,
    sectionCValues,
    sectionCLimbIds: normalizedLimbs,
    sectionCTotal,
    firstScheduleBonus,
    combinedAB,
    finalBeforeCap,
    finalPercent,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zod schema
// ═══════════════════════════════════════════════════════════════════════════════

const groupSelectionSchema = z.object({
  bracketId: z.string(),
  value: z.number().min(0).max(100),
});

export const cnsValueSchema = z.object({
  group1Consciousness: groupSelectionSchema,
  group1Episodic: groupSelectionSchema,
  group1Arousal: groupSelectionSchema,
  group2: groupSelectionSchema,
  group2NeuropsychologistConfirmed: z.boolean(),
  group3: groupSelectionSchema,
  group4: groupSelectionSchema,
  group4PsychiatristConfirmed: z.boolean(),
  olfaction: groupSelectionSchema,
  facialNerve: groupSelectionSchema,
  equilibrium: groupSelectionSchema,
  equilibriumEntConfirmed: z.boolean(),
  swallowing: groupSelectionSchema,
  stationGait: groupSelectionSchema,
  respiration: groupSelectionSchema,
  paralysedLimbs: z.array(z.string()).transform(normalizeParalysedLimbs),
});
