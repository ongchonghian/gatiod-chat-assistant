import { z } from "zod";

// ─── Enums & Types ──────────────────────────────────────────────────────────

export type SpinalRegion = "cervical" | "thoraco_lumbar" | "lumbo_sacral";

export type DiagnosisCategory =
  | "fractures_dislocations"
  | "spinal_cord_injury"
  | "intervertebral_disc"
  | "spondylolysis_spondylolisthesis"
  | "chronic_pain_normal_mri";

export type SpondylolysisPathway = "acute_traumatic" | "pre_existing_superimposed";

export const DEFAULT_SPONDYLOLYSIS_PATHWAY: SpondylolysisPathway = "acute_traumatic";

export type SeverityKey =
  | "mild_sensory_motor"
  | "persistent_radicular"
  | "asia_d"
  | "asia_c"
  | "asia_ba"
  | "compression_gt25"
  | "compression_lt25"
  | "disc31_residual"
  | "disc31_persistent_no_neuro"
  | "disc31_persistent_sensory"
  | "disc31_persistent_motor_or_motor_sensory"
  | "disc32_residual"
  | "disc32_persistent_neuro"
  | "spondy_preexisting_residual"
  | "spondy_preexisting_chronic"
  | "chronic_pain_attributable"
  | "chronic_pain_not_attributable";

export type BladderBowelSeverity =
  | "none"
  | "incomplete_single"
  | "incomplete_both"
  | "complete_single"
  | "complete_both";

// ─── Option Interfaces ──────────────────────────────────────────────────────

export interface SpinalRegionOption {
  key: SpinalRegion;
  label: string;
}

export interface DiagnosisCategoryOption {
  key: DiagnosisCategory;
  label: string;
  description: string;
}

export interface SeverityOption {
  key: SeverityKey;
  label: string;
  /** Whether ASIA modifiers (monoparesis / bladder-bowel) apply. */
  asiaModifiersApplicable: boolean;
  /** Whether monoparesis halving applies (only ASIA C & D). */
  monoparesisApplicable: boolean;
}

export interface BladderBowelOption {
  key: BladderBowelSeverity;
  label: string;
  addPercent: number;
}

// ─── Multi-Category Entry ───────────────────────────────────────────────────

export interface CategoryEntry {
  diagnosisCategory: DiagnosisCategory;
  severity: SeverityKey | "";
  isMonoparesis: boolean;
  bladderBowelSeverity: BladderBowelSeverity;
  /** Section 3 note: if cord involved, route to Section 2. */
  discCordInvolvement: boolean;
  /** Section 4 pathway: acute traumatic vs pre-existing with superimposed injury. */
  spondylolysisPathway: SpondylolysisPathway;
}

export interface EvaluatedCategoryEntry extends CategoryEntry {
  computedPercent: number;
  basePercent: number;
  adjustedPercent: number;
  bladderBowelAddOn: number;
  /** Value before 100% cap. */
  preCapPercent: number;
  suppressed: boolean;
  suppressionReason?: string;
}

// ─── Reference Data ─────────────────────────────────────────────────────────

export const spinalRegions: SpinalRegionOption[] = [
  { key: "cervical", label: "Cervical (C1–C7)" },
  { key: "thoraco_lumbar", label: "Thoraco-Lumbar (T1–L1)" },
  { key: "lumbo_sacral", label: "Lumbo-Sacral (L2–S1)" },
];

export const diagnosisCategories: DiagnosisCategoryOption[] = [
  {
    key: "fractures_dislocations",
    label: "Fractures and Dislocations",
    description:
      "Chapter 5 Section 1. For compression/burst fractures ≥25% height loss, dislocations, fracture-dislocations, or healed fractures WITH neurological manifestations (rows a–e). Separate rows for fractures with residual pain only.",
  },
  {
    key: "spinal_cord_injury",
    label: "Spinal Cord / Central Cord / Cauda Equina Injury",
    description:
      "Chapter 5 Section 2. Use only when there is NO fracture or dislocation — cord/nerve root injury is standalone. If fracture or dislocation is present, use Section 1 instead.",
  },
  {
    key: "intervertebral_disc",
    label: "Intervertebral Disc",
    description:
      "Chapter 5 Section 3 (3.1 prolapsed disc; 3.2 degenerated disc + superimposed injury). If spinal cord or cauda equina is involved, score under Section 2 instead.",
  },
  {
    key: "spondylolysis_spondylolisthesis",
    label: "Lumbar Spondylolysis / Spondylolisthesis",
    description:
      "Chapter 5 Section 4 — lumbar-specific diagnosis. Acute traumatic: scored using Section 1 rows. Pre-existing lesion with superimposed injury: lumbo-sacral (L2–S1) only.",
  },
  {
    key: "chronic_pain_normal_mri",
    label: "Chronic Pain Syndrome with Normal MRI",
    description:
      "Chapter 5 Section 5. Use only when MRI is normal. If MRI shows disc or structural pathology, score under Section 3 instead.",
  },
];

const section12Rows: SeverityOption[] = [
  {
    key: "mild_sensory_motor",
    label: "a. Mild sensory and motor manifestations",
    asiaModifiersApplicable: true,
    monoparesisApplicable: false,
  },
  {
    key: "persistent_radicular",
    label: "b. Persistent radicular pain and/or localised motor weakness",
    asiaModifiersApplicable: true,
    monoparesisApplicable: false,
  },
  {
    key: "asia_d",
    label: "c. Paraparesis or tetraparesis (ASIA D)",
    asiaModifiersApplicable: true,
    monoparesisApplicable: true,
  },
  {
    key: "asia_c",
    label: "d. Paraparesis or tetraparesis (ASIA C)",
    asiaModifiersApplicable: true,
    monoparesisApplicable: true,
  },
  {
    key: "asia_ba",
    label: "e. Paraplegia or tetraplegia (ASIA B and A)",
    // Section 1/2 notes restrict bladder-bowel add-on to rows a-d only.
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
];

const section1CompressionRows: SeverityOption[] = [
  {
    key: "compression_gt25",
    label: "Compression or burst fractures of >25% with residual pain",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "compression_lt25",
    label: "Compression or burst fractures of <25% with residual pain",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
];

const section3Rows: SeverityOption[] = [
  {
    key: "disc31_residual",
    label: "3.1a Residual pain, acceptable level of discomfort",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "disc31_persistent_no_neuro",
    label: "3.1b Persistent pain + restricted motion with no neurological deficit",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "disc31_persistent_sensory",
    label: "3.1c Persistent pain + restricted motion with sensory deficit",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "disc31_persistent_motor_or_motor_sensory",
    label: "3.1d Persistent pain + restricted motion with motor deficit (± sensory)",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "disc32_residual",
    label: "3.2a Degenerated disc + superimposed injury: residual pain",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "disc32_persistent_neuro",
    label: "3.2b Degenerated disc + superimposed injury: persistent pain + neuro symptoms",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
];

const section4PreExistingRows: SeverityOption[] = [
  {
    key: "spondy_preexisting_residual",
    label: "Pre-existing lesion + documented superimposed injury: residual pain",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "spondy_preexisting_chronic",
    label: "Pre-existing lesion + documented superimposed injury: chronic/recurrent pain",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
];

const section5Rows: SeverityOption[] = [
  {
    key: "chronic_pain_attributable",
    label: "a. Residual pain attributable to the injury",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
  {
    key: "chronic_pain_not_attributable",
    label: "b. Residual pain not attributable to the injury",
    asiaModifiersApplicable: false,
    monoparesisApplicable: false,
  },
];

interface SeverityQueryOptions {
  spondylolysisPathway?: SpondylolysisPathway;
}

/** Map diagnosis category → available severity options. */
export function getSeveritiesForCategory(
  category: DiagnosisCategory,
  options: SeverityQueryOptions = {}
): SeverityOption[] {
  switch (category) {
    case "fractures_dislocations":
      return [...section12Rows, ...section1CompressionRows];
    case "spinal_cord_injury":
      return [...section12Rows];
    case "intervertebral_disc":
      return [...section3Rows];
    case "spondylolysis_spondylolisthesis": {
      const pathway = options.spondylolysisPathway ?? DEFAULT_SPONDYLOLYSIS_PATHWAY;
      return pathway === "acute_traumatic"
        ? [...section12Rows, ...section1CompressionRows]
        : [...section4PreExistingRows];
    }
    case "chronic_pain_normal_mri":
      return [...section5Rows];
  }
}

export const bladderBowelOptions: BladderBowelOption[] = [
  { key: "none", label: "None", addPercent: 0 },
  { key: "incomplete_single", label: "Incomplete incontinence (bladder or bowel only)", addPercent: 10 },
  { key: "incomplete_both", label: "Incomplete incontinence (bladder and bowel)", addPercent: 15 },
  { key: "complete_single", label: "Complete incontinence (bladder or bowel only)", addPercent: 20 },
  { key: "complete_both", label: "Complete incontinence (bladder and bowel)", addPercent: 25 },
];

// ─── PI% Lookup Matrix ─────────────────────────────────────────────────────

const PI_MATRIX: Record<SeverityKey, Partial<Record<SpinalRegion, number>>> = {
  // Sections 1 and 2 (rows a-e) and Section 4 acute pathway.
  mild_sensory_motor: { cervical: 20, thoraco_lumbar: 15, lumbo_sacral: 20 },
  persistent_radicular: { cervical: 25, thoraco_lumbar: 20, lumbo_sacral: 25 },
  asia_d: { cervical: 70, thoraco_lumbar: 50, lumbo_sacral: 50 },
  asia_c: { cervical: 100, thoraco_lumbar: 100, lumbo_sacral: 70 },
  asia_ba: { cervical: 100, thoraco_lumbar: 100, lumbo_sacral: 100 },
  compression_gt25: { cervical: 15, thoraco_lumbar: 10, lumbo_sacral: 15 },
  compression_lt25: { cervical: 5, thoraco_lumbar: 5, lumbo_sacral: 5 },

  // Section 3.1
  disc31_residual: { cervical: 10, thoraco_lumbar: 10, lumbo_sacral: 10 },
  disc31_persistent_no_neuro: { cervical: 15, thoraco_lumbar: 15, lumbo_sacral: 15 },
  disc31_persistent_sensory: { cervical: 20, thoraco_lumbar: 15, lumbo_sacral: 20 },
  disc31_persistent_motor_or_motor_sensory: { cervical: 25, thoraco_lumbar: 20, lumbo_sacral: 25 },

  // Section 3.2
  disc32_residual: { cervical: 5, thoraco_lumbar: 5, lumbo_sacral: 5 },
  disc32_persistent_neuro: { cervical: 10, thoraco_lumbar: 10, lumbo_sacral: 10 },

  // Section 4 pre-existing lesion (lumbo-sacral only).
  spondy_preexisting_residual: { lumbo_sacral: 5 },
  spondy_preexisting_chronic: { lumbo_sacral: 10 },

  // Section 5
  chronic_pain_attributable: { cervical: 3, thoraco_lumbar: 3, lumbo_sacral: 3 },
  chronic_pain_not_attributable: { cervical: 0, thoraco_lumbar: 0, lumbo_sacral: 0 },
};

// ─── Zod Schema (output payload) ────────────────────────────────────────────

export const EvaluatedCategoryEntrySchema = z.object({
  diagnosisCategory: z.enum([
    "fractures_dislocations",
    "spinal_cord_injury",
    "intervertebral_disc",
    "spondylolysis_spondylolisthesis",
    "chronic_pain_normal_mri",
  ]),
  severity: z.string(),
  isMonoparesis: z.boolean(),
  bladderBowelSeverity: z.enum([
    "none",
    "incomplete_single",
    "incomplete_both",
    "complete_single",
    "complete_both",
  ]),
  discCordInvolvement: z.boolean(),
  spondylolysisPathway: z.enum(["acute_traumatic", "pre_existing_superimposed"]),
  computedPercent: z.number().min(0).max(100),
  basePercent: z.number().min(0).max(100),
  adjustedPercent: z.number().min(0).max(100),
  bladderBowelAddOn: z.number().min(0).max(25),
  preCapPercent: z.number().min(0),
  suppressed: z.boolean(),
  suppressionReason: z.string().optional(),
});

export const SpineAssessmentResultSchema = z.object({
  spinalRegion: z.enum(["cervical", "thoraco_lumbar", "lumbo_sacral"]),
  evaluatedEntries: z.array(EvaluatedCategoryEntrySchema),
  winnerIndex: z.number(),
  finalPercent: z.number().min(0).max(100),
  firstScheduleFlag: z.boolean(),
});

export type SpineAssessmentResult = z.infer<typeof SpineAssessmentResultSchema>;

// ─── Rule Helpers ────────────────────────────────────────────────────────────

export function isSeverityAvailableForRegion(severity: SeverityKey, region: SpinalRegion): boolean {
  return PI_MATRIX[severity][region] !== undefined;
}

export function isMonoparesisApplicableSeverity(severity: SeverityKey): boolean {
  return severity === "asia_c" || severity === "asia_d";
}

/** Section 1/2 note: only rows a-d are eligible for bladder/bowel add-on. */
export function isBladderBowelApplicableSeverity(severity: SeverityKey): boolean {
  return (
    severity === "mild_sensory_motor" ||
    severity === "persistent_radicular" ||
    severity === "asia_d" ||
    severity === "asia_c"
  );
}

/** Look up the base PI% for a given severity and spinal region. */
export function getBasePercent(severity: SeverityKey, region: SpinalRegion): number | null {
  const value = PI_MATRIX[severity][region];
  return value === undefined ? null : value;
}

/** Apply monoparesis halving (only for ASIA C and D). */
export function applyMonoparesisModifier(
  basePercent: number,
  isMonoparesis: boolean,
  severity: SeverityKey
): number {
  if (isMonoparesis && isMonoparesisApplicableSeverity(severity)) {
    return basePercent / 2;
  }
  return basePercent;
}

/** Get the bladder/bowel add-on percentage. */
export function getBladderBowelAddOn(severity: BladderBowelSeverity): number {
  const option = bladderBowelOptions.find((o) => o.key === severity);
  return option?.addPercent ?? 0;
}

function getAllowedSeverityKeys(entry: CategoryEntry): SeverityKey[] {
  return getSeveritiesForCategory(entry.diagnosisCategory, {
    spondylolysisPathway: entry.spondylolysisPathway,
  }).map((option) => option.key);
}

function getEntryValidationIssue(entry: CategoryEntry, region: SpinalRegion): string | null {
  if (!entry.severity) {
    return "Incomplete — no severity selected";
  }

  if (entry.diagnosisCategory === "intervertebral_disc" && entry.discCordInvolvement) {
    return "Cervical/thoracic cord involvement is present. Score under Chapter 5 Section 2 (Spinal Cord / Central Cord / Cauda Equina Injury), not Section 3 (Intervertebral Disc).";
  }

  if (!getAllowedSeverityKeys(entry).includes(entry.severity as SeverityKey)) {
    return "Selected severity is not valid for the chosen category/pathway.";
  }

  if (!isSeverityAvailableForRegion(entry.severity as SeverityKey, region)) {
    return "Selected severity is not available for the selected spinal region.";
  }

  return null;
}

/**
 * Evaluate a single category entry for a given spinal region.
 * Returns null when the selected severity cannot be scored.
 */
export function evaluateSingleEntry(
  entry: CategoryEntry,
  region: SpinalRegion
): Omit<EvaluatedCategoryEntry, "suppressed" | "suppressionReason"> | null {
  if (!entry.severity) return null;

  const severity = entry.severity as SeverityKey;
  const severityOption = getSeveritiesForCategory(entry.diagnosisCategory, {
    spondylolysisPathway: entry.spondylolysisPathway,
  }).find((s) => s.key === severity);
  if (!severityOption) return null;

  const basePercent = getBasePercent(severity, region);
  if (basePercent === null) return null;

  const useMonoparesis = severityOption.monoparesisApplicable && entry.isMonoparesis;
  const adjustedPercent = applyMonoparesisModifier(basePercent, useMonoparesis, severity);
  const bladderBowelAddOn = severityOption.asiaModifiersApplicable
    ? getBladderBowelAddOn(entry.bladderBowelSeverity)
    : 0;
  const preCapPercent = adjustedPercent + bladderBowelAddOn;
  const computedPercent = Math.min(preCapPercent, 100);

  return {
    ...entry,
    isMonoparesis: useMonoparesis,
    bladderBowelSeverity: severityOption.asiaModifiersApplicable
      ? entry.bladderBowelSeverity
      : "none",
    basePercent,
    adjustedPercent,
    bladderBowelAddOn,
    preCapPercent,
    computedPercent,
  };
}

/**
 * Evaluate all category entries for a spine assessment and apply:
 * - Highest-award override within the same region
 * - 100% hard cap
 * - First Schedule flag when final PI is exactly 100%
 */
export function calculateSpineAssessment(
  region: SpinalRegion,
  categoryEntries: CategoryEntry[]
): SpineAssessmentResult {
  const evaluated: EvaluatedCategoryEntry[] = [];
  let winnerIndex = -1;
  let highestPercent = -1;
  const completeEntryIndexes: number[] = [];

  for (let i = 0; i < categoryEntries.length; i++) {
    const entry = categoryEntries[i];
    const issue = getEntryValidationIssue(entry, region);

    if (issue) {
      evaluated.push({
        ...entry,
        basePercent: 0,
        adjustedPercent: 0,
        bladderBowelAddOn: 0,
        preCapPercent: 0,
        computedPercent: 0,
        suppressed: true,
        suppressionReason: issue,
      });
      continue;
    }

    const result = evaluateSingleEntry(entry, region);
    if (!result) {
      evaluated.push({
        ...entry,
        basePercent: 0,
        adjustedPercent: 0,
        bladderBowelAddOn: 0,
        preCapPercent: 0,
        computedPercent: 0,
        suppressed: true,
        suppressionReason: "Unable to evaluate selected severity.",
      });
      continue;
    }

    evaluated.push({ ...result, suppressed: false });
    completeEntryIndexes.push(evaluated.length - 1);

    if (result.computedPercent > highestPercent) {
      highestPercent = result.computedPercent;
      winnerIndex = evaluated.length - 1;
    }
  }

  if (winnerIndex >= 0 && completeEntryIndexes.length > 1) {
    const winnerCategory = diagnosisCategories.find(
      (category) => category.key === evaluated[winnerIndex].diagnosisCategory
    );
    for (const index of completeEntryIndexes) {
      if (index === winnerIndex) continue;
      evaluated[index].suppressed = true;
      evaluated[index].suppressionReason =
        `Suppressed: "${winnerCategory?.label}" provides the higher award (${highestPercent}%).`;
    }
  }

  const finalPercent = winnerIndex >= 0 ? Math.min(evaluated[winnerIndex].computedPercent, 100) : 0;

  return {
    spinalRegion: region,
    evaluatedEntries: evaluated,
    winnerIndex,
    finalPercent,
    firstScheduleFlag: finalPercent === 100,
  };
}

/**
 * @deprecated Use calculateSpineAssessment with categoryEntries array instead.
 */
export function calculateSpineAssessmentSingle(
  region: SpinalRegion,
  category: DiagnosisCategory,
  severity: SeverityKey,
  isMonoparesis: boolean,
  bladderBowel: BladderBowelSeverity
): SpineAssessmentResult {
  return calculateSpineAssessment(region, [
    {
      diagnosisCategory: category,
      severity,
      isMonoparesis,
      bladderBowelSeverity: bladderBowel,
      discCordInvolvement: false,
      spondylolysisPathway: DEFAULT_SPONDYLOLYSIS_PATHWAY,
    },
  ]);
}
