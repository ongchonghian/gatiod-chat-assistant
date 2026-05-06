import { z } from "zod";
import { combineMultipleValuesChart as combinedValuesChart } from "./cvcCalculator.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type Side = "left" | "right";
export type ToeKey = "great" | "second" | "third" | "fourth" | "fifth";
export type LossType = "total" | "partial";
export type DeficitType = "sensory" | "motor" | "combined";
export type DbeEntryType = "fixed" | "range";
export type LowerDbeCategory =
  | "fracture_deformity"
  | "ligament_soft_tissue"
  | "osteoarthritis";
export type LowerAnatomicalKey =
  | "pelvis"
  | "sacroiliac"
  | "acetabulum"
  | "hip"
  | "knee"
  | "patellofemoral"
  | "ankle"
  | "subtalar"
  | "talonavicular"
  | "calcaneocuboid"
  | "tarsometatarsal"
  | "first_mtp"
  | "second_mtp"
  | "third_mtp"
  | "fourth_mtp"
  | "fifth_mtp"
  | "great_toe_ip"
  | "lesser_toes_mtp";

// ─── Amputation ─────────────────────────────────────────────────────────────

export interface LegAmputationLevel {
  id: string;
  label: string;
  percent: number;
  disablesBelow: boolean;
}

export interface ToeAmputationLevel {
  id: string;
  label: string;
  percent: number;
}

export interface LowerLimbAmputationValue {
  legLevel: string; // 'none' | level id
  toes: Record<ToeKey, string>; // 'none' | phalanx level id
}

// ─── ROM ────────────────────────────────────────────────────────────────────

export interface RomLookup {
  angle: number;
  percent: number;
}

export interface RomDirection {
  key: string;
  label: string;
  normalRom: number;
  table: RomLookup[];
  ankylosisTable?: RomLookup[];
}

export interface RomJoint {
  key: string;
  label: string;
  directions: RomDirection[];
}

export interface RomJointValue {
  isAnkylosed: boolean;
  measurements: Record<string, number>;
}

export interface LowerLimbRomValue {
  joints: Record<string, RomJointValue>;
}

// ─── Neurological ───────────────────────────────────────────────────────────

export interface NerveEntry {
  key: string;
  label: string;
  group: "lumbosacral_plexus" | "peripheral";
  sensoryMax?: number;
  motorMax?: number;
  combinedMax?: number;
}

export interface NerveSelection {
  nerveKey: string;
  deficitType: DeficitType;
  lossType: LossType;
}

export interface LowerLimbNeurologicalValue {
  selectedNerves: NerveSelection[];
  romFromNerve: boolean;
}

// ─── Shortening ─────────────────────────────────────────────────────────────

export interface ShorteningValue {
  discrepancyCm: number; // 0 to 8 in 0.5 steps
}

// ─── DBE ────────────────────────────────────────────────────────────────────



export interface DbeCondition {
  id: string;
  label: string;
  category: LowerDbeCategory;
  anatomicalKeys: readonly [LowerAnatomicalKey, ...LowerAnatomicalKey[]];
  entryType: DbeEntryType;
  minPercent: number;
  maxPercent: number;
  description: string;
}

/**
 * Returns the conflict-resolution key for a DBE condition.
 * Prefers explicit `anatomicalKey`; falls back to `joint`.
 */

/**
 * Returns true if this condition has a single fixed value (no slider needed).
 */
export function isDbeFixed(cond: DbeCondition): boolean {
  if (cond.entryType !== undefined) return cond.entryType === "fixed";
  return cond.minPercent === cond.maxPercent;
}

export interface DbeSelection {
  conditionId: string;
  selectedAnatomicalKey?: LowerAnatomicalKey;
  selectedPercent: number;
}

export interface LowerLimbDbeValue {
  selectedConditions: DbeSelection[];
}

// ─── Top-Level State ────────────────────────────────────────────────────────

export interface LowerLimbValue {
  side: Side;
  amputations: LowerLimbAmputationValue;
  rom: LowerLimbRomValue;
  neurological: LowerLimbNeurologicalValue;
  shortening: ShorteningValue;
  dbe: LowerLimbDbeValue;
}

// ─── Result ─────────────────────────────────────────────────────────────────

/**
 * Reference back to the authoritative GATIOD source so audit output can cite
 * the table the percent was derived from. This is the structured equivalent
 * of "see GATIOD Chapter 4 Section IV" in a hand-written report.
 */
export interface GatiodReference {
  chapter: string;
  section?: string;
  table?: string;
}

export interface CategoryResult {
  label: string;
  rawPercent: number;
  notes: string[];
  gatiodReference?: GatiodReference;
}

const LOWER_LIMB_REFS = {
  amputation: { chapter: "Chapter 4", section: "Amputations of the Lower Limb", table: "Leg & toe amputation table" },
  rom: { chapter: "Chapter 4", section: "Range of Motion of the Lower Limb" },
  neurological: { chapter: "Chapter 4", section: "Nerves of the Lower Limb" },
  shortening: { chapter: "Chapter 4", section: "Section IV — Shortening of the Lower Limb", table: "cm-to-PI% table" },
  dbe: { chapter: "Chapter 4", section: "Section V — Fractures, ligament/soft-tissue, osteoarthritis" },
} as const;

export interface LowerLimbResult {
  amputation: CategoryResult;
  rom: CategoryResult;
  neurological: CategoryResult;
  shortening: CategoryResult;
  dbe: CategoryResult;
  dbeRomConflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[];
  cvcInputs: number[];
  finalPercent: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zod Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const LowerLimbValueSchema = z.object({
  side: z.enum(["left", "right"]),
  amputations: z.object({
    legLevel: z.enum(["none", "above_knee", "below_knee", "syme", "midtarsal", "transmetatarsal"]),
    toes: z.object({
      great: z.enum(["none", "ip", "mtp", "metatarsal"]),
      second: z.enum(["none", "dip", "pip", "mtp", "metatarsal"]),
      third: z.enum(["none", "dip", "pip", "mtp", "metatarsal"]),
      fourth: z.enum(["none", "dip", "pip", "mtp", "metatarsal"]),
      fifth: z.enum(["none", "dip", "pip", "mtp", "metatarsal"]),
    }),
  }),
  rom: z.object({
    joints: z.record(z.object({
      isAnkylosed: z.boolean(),
      measurements: z.record(z.number().min(0).max(200)),
    })),
  }),
  neurological: z.object({
    selectedNerves: z.array(z.object({
      nerveKey: z.string(),
      deficitType: z.enum(["sensory", "motor", "combined"]),
      lossType: z.enum(["total", "partial"]),
    })),
    romFromNerve: z.boolean(),
  }),
  shortening: z.object({
    discrepancyCm: z.number().min(0).max(50),
  }),
  dbe: z.object({
    selectedConditions: z.array(z.object({
      conditionId: z.string(),
      selectedAnatomicalKey: z.string().optional(),
      selectedPercent: z.number().min(0).max(100),
    })),
  }),
}).superRefine((value, ctx) => {
  if (
    value.amputations.legLevel !== "none" &&
    Object.values(value.amputations.toes).some((toeLevel) => toeLevel !== "none")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amputations", "toes"],
      message: "Toe selections must be none when a leg-level amputation is selected.",
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lookup Tables
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function t(...pairs: [number, number][]): RomLookup[] {
  return pairs.map(([angle, percent]) => ({ angle, percent }));
}

// ─── Amputation Levels ──────────────────────────────────────────────────────

export const LEG_AMPUTATION_LEVELS: LegAmputationLevel[] = [
  { id: "above_knee", label: "At or above knee (through femur)", percent: 75, disablesBelow: true },
  { id: "below_knee", label: "Below knee (through tibia)", percent: 65, disablesBelow: true },
  { id: "syme", label: "At ankle (Syme's amputation)", percent: 55, disablesBelow: true },
  { id: "midtarsal", label: "Foot at midtarsal (Chopart's)", percent: 35, disablesBelow: true },
  { id: "transmetatarsal", label: "Transmetatarsal", percent: 20, disablesBelow: true },
];

export const TOE_AMPUTATION_LEVELS: Record<ToeKey, ToeAmputationLevel[]> = {
  great: [
    { id: "ip", label: "Through IP joint", percent: 3 },
    { id: "mtp", label: "Through MTP joint", percent: 14 },
    { id: "metatarsal", label: "With 1st metatarsal", percent: 23 },
  ],
  second: [
    { id: "dip", label: "Through DIP", percent: 1 },
    { id: "pip", label: "Through PIP", percent: 2 },
    { id: "mtp", label: "Through MTP", percent: 3 },
    { id: "metatarsal", label: "With 2nd metatarsal", percent: 7 },
  ],
  third: [
    { id: "dip", label: "Through DIP", percent: 1 },
    { id: "pip", label: "Through PIP", percent: 2 },
    { id: "mtp", label: "Through MTP", percent: 3 },
    { id: "metatarsal", label: "With 3rd metatarsal", percent: 7 },
  ],
  fourth: [
    { id: "dip", label: "Through DIP", percent: 1 },
    { id: "pip", label: "Through PIP", percent: 2 },
    { id: "mtp", label: "Through MTP", percent: 3 },
    { id: "metatarsal", label: "With 4th metatarsal", percent: 7 },
  ],
  fifth: [
    { id: "dip", label: "Through DIP", percent: 1 },
    { id: "pip", label: "Through PIP", percent: 2 },
    { id: "mtp", label: "Through MTP", percent: 3 },
    { id: "metatarsal", label: "With 5th metatarsal", percent: 7 },
  ],
};

/** Maximum total for all toes combined = transmetatarsal value */
export const FOOT_AMPUTATION_CAP = 20;

/** Total lower limb amputation cap */
export const TOTAL_LOWER_LIMB_CAP = 100;

export const TOE_LABELS: Record<ToeKey, string> = {
  great: "Great Toe",
  second: "2nd Toe",
  third: "3rd Toe",
  fourth: "4th Toe",
  fifth: "5th Toe",
};

// ─── ROM Restriction Tables ─────────────────────────────────────────────────

export const ROM_JOINTS: RomJoint[] = [
  {
    key: "hip", label: "Hip",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 100,
        table: t([0, 13], [10, 12], [20, 10], [30, 9], [40, 8], [50, 7], [60, 6], [70, 5], [80, 3], [90, 2], [100, 0]),
        ankylosisTable: t([0, 37], [10, 33], [20, 29], [25, 27], [30, 27], [40, 32], [50, 36], [60, 39], [70, 43], [80, 46], [90, 49], [100, 53]),
      },
      {
        key: "flexion_contracture",
        label: "Flexion Contracture",
        normalRom: 0,
        table: t([0, 0], [10, 5], [20, 10], [30, 15], [40, 20], [50, 30], [100, 30]),
      },
      {
        key: "extension",
        label: "Extension",
        normalRom: 30,
        table: t([0, 4], [10, 4], [20, 2], [30, 0]),
        ankylosisTable: t([0, 37], [10, 45], [20, 51], [30, 56]),
      },
      {
        key: "abduction",
        label: "Abduction",
        normalRom: 40,
        table: t([0, 11], [10, 9], [20, 6], [30, 3], [40, 0]),
        ankylosisTable: t([0, 37], [10, 41], [20, 45], [30, 49], [40, 53]),
      },
      {
        key: "adduction",
        label: "Adduction",
        normalRom: 20,
        table: t([0, 6], [10, 4], [20, 0]),
        ankylosisTable: t([0, 37], [10, 48], [20, 56]),
      },
      {
        key: "internal_rotation",
        label: "Internal Rotation",
        normalRom: 40,
        table: t([0, 8], [10, 6], [20, 4], [30, 2], [40, 0]),
        ankylosisTable: t([0, 37], [10, 44], [20, 48], [30, 53], [40, 56]),
      },
      {
        key: "external_rotation",
        label: "External Rotation",
        normalRom: 50,
        table: t([0, 9], [10, 8], [20, 6], [30, 4], [40, 2], [50, 0]),
        ankylosisTable: t([0, 37], [10, 41], [20, 43], [30, 47], [40, 50], [50, 53]),
      },
    ],
  },
  {
    key: "knee", label: "Knee",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 150,
        table: t([0, 33], [10, 31], [20, 29], [30, 26], [40, 24], [50, 23], [60, 20], [70, 18], [80, 15], [90, 13], [100, 11], [110, 8], [120, 6], [130, 4], [140, 2], [150, 0]),
        ankylosisTable: t([0, 33], [10, 32], [20, 38], [30, 44], [40, 50], [50, 56], [150, 56]),
      },
      {
        key: "flexion_contracture",
        label: "Flexion Contracture",
        normalRom: 0,
        table: t([0, 0], [10, 2], [20, 5], [30, 11], [40, 17], [50, 26], [60, 30], [70, 33], [80, 35], [90, 38], [100, 41], [110, 44], [120, 48], [130, 51], [140, 54], [150, 56]),
      },
    ],
  },
  {
    key: "ankle", label: "Ankle",
    directions: [
      {
        key: "dorsiflexion",
        label: "Extension (Dorsiflexion)",
        normalRom: 20,
        table: t([0, 6], [10, 4], [20, 0]),
        ankylosisTable: t([0, 14], [10, 24], [20, 33]),
      },
      {
        key: "plantarflexion",
        label: "Flexion (Plantarflexion)",
        normalRom: 40,
        table: t([0, 12], [10, 9], [20, 6], [30, 3], [40, 0]),
        ankylosisTable: t([0, 14], [10, 19], [20, 24], [30, 29], [40, 33]),
      },
    ],
  },
  {
    key: "subtalar", label: "Subtalar Joint",
    directions: [
      {
        key: "inversion",
        label: "Inversion",
        normalRom: 30,
        table: t([0, 4], [10, 4], [20, 2], [30, 0]),
        ankylosisTable: t([0, 14], [10, 20], [20, 28], [30, 33]),
      },
      {
        key: "eversion",
        label: "Eversion",
        normalRom: 20,
        table: t([0, 4], [10, 2], [20, 0]),
        ankylosisTable: t([0, 14], [10, 24], [20, 33]),
      },
    ],
  },
  {
    key: "great_toe_mtp", label: "Great Toe — MTP",
    directions: [
      {
        key: "extension",
        label: "Extension (dorsiflexion)",
        normalRom: 50,
        table: t([0, 6], [10, 5], [20, 3], [30, 2], [40, 0], [50, 0]),
        ankylosisTable: t([0, 6], [10, 4], [20, 6], [30, 8], [40, 9], [50, 10]),
      },
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 30,
        table: t([0, 3], [10, 3], [20, 0], [30, 0]),
        ankylosisTable: t([0, 6], [10, 8], [20, 9], [30, 10]),
      },
    ],
  },
  {
    key: "great_toe_ip", label: "Great Toe — IP",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 30,
        table: t([0, 2], [10, 2], [20, 1], [30, 0]),
        ankylosisTable: t([0, 2], [10, 2], [20, 2], [30, 3]),
      },
    ],
  },
  {
    key: "lesser_toes_mtp", label: "2nd–5th Toes — MTP",
    directions: [
      {
        key: "extension",
        label: "Extension",
        normalRom: 40,
        table: t([0, 1], [30, 1], [40, 0]),
        ankylosisTable: t([0, 2], [20, 2], [30, 3], [40, 3]),
      },
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 30,
        table: t([0, 1], [10, 1], [20, 0], [30, 0]),
        ankylosisTable: t([0, 2], [20, 2], [30, 3]),
      },
    ],
  },
];

// ─── Neurological Data ──────────────────────────────────────────────────────

export const LOWER_LIMB_NERVES: NerveEntry[] = [
  { key: "lumbosacral_l3_s1", label: "Lumbosacral Plexus (L3–S1)", group: "lumbosacral_plexus", sensoryMax: 44, motorMax: 55, combinedMax: 75 },
  { key: "femoral", label: "Femoral", group: "peripheral", sensoryMax: 5, motorMax: 16, combinedMax: 20 },
  { key: "obturator", label: "Obturator", group: "peripheral", motorMax: 3 },
  { key: "superior_gluteal", label: "Superior Gluteal", group: "peripheral", motorMax: 20 },
  { key: "inferior_gluteal", label: "Inferior Gluteal", group: "peripheral", motorMax: 15 },
  { key: "lateral_femoral_cutaneous", label: "Lateral Femoral Cutaneous", group: "peripheral", sensoryMax: 1 },
  { key: "sciatic", label: "Sciatic", group: "peripheral", sensoryMax: 15, motorMax: 30, combinedMax: 41 },
  { key: "common_peroneal", label: "Common Peroneal", group: "peripheral", sensoryMax: 2, motorMax: 15, combinedMax: 17 },
  { key: "superficial_peroneal", label: "Superficial Peroneal", group: "peripheral", sensoryMax: 2 },
  { key: "deep_peroneal", label: "Deep Peroneal", group: "peripheral", sensoryMax: 1, motorMax: 5, combinedMax: 6 },
  { key: "tibial", label: "Tibial", group: "peripheral", sensoryMax: 5, motorMax: 15, combinedMax: 19 },
  { key: "sural", label: "Sural", group: "peripheral", sensoryMax: 1 },
  { key: "medial_plantar", label: "Medial Plantar", group: "peripheral", sensoryMax: 5, motorMax: 2, combinedMax: 7 },
  { key: "lateral_plantar", label: "Lateral Plantar", group: "peripheral", sensoryMax: 5, motorMax: 2, combinedMax: 7 },
];

// ─── Shortening Mapping ────────────────────────────────────────────────────

export const SHORTENING_TABLE: { cm: number; percent: number }[] = [
  { cm: 0, percent: 0 },
  { cm: 0.5, percent: 2 },
  { cm: 1.0, percent: 4 },
  { cm: 1.5, percent: 6 },
  { cm: 2.0, percent: 8 },
  { cm: 2.5, percent: 10 },
  { cm: 3.0, percent: 12 },
  { cm: 3.5, percent: 14 },
  { cm: 4.0, percent: 16 },
  { cm: 4.5, percent: 18 },
  { cm: 5.0, percent: 20 },
  { cm: 5.5, percent: 22 },
  { cm: 6.0, percent: 24 },
  { cm: 6.5, percent: 26 },
  { cm: 7.0, percent: 28 },
  { cm: 7.5, percent: 30 },
];

// ─── DBE Conditions (GATIOD Chapter 4, Section V — canonical entries only) ───
//
// All entries are discrete fixed-value rows from the GATIOD tables.
// Non-canonical / synthetic range rows (e.g. THR, TKR) are intentionally excluded.
// Legacy saved condition IDs not present here are dropped at hydration time
// and a clinician-facing warning is surfaced (see hydrateLowerLimbDbe).

export const DBE_CONDITIONS: DbeCondition[] = [
  // Chapter 4, Section V(A): Fractures with complications and deformities
  { id: "pelvis_symphysis_no_separation", label: "Pelvis — Symphysis pubis (no separation)", category: "fracture_deformity", anatomicalKeys: ["pelvis"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Healed fracture with displacement without residual signs." },
  { id: "pelvis_sacrum_no_residual_signs", label: "Pelvis — Sacrum (no residual signs)", category: "fracture_deformity", anatomicalKeys: ["sacroiliac"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Healed fracture with displacement without residual signs." },
  { id: "pelvis_rami_bilateral", label: "Pelvis — Rami, bilateral", category: "fracture_deformity", anatomicalKeys: ["pelvis"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Healed fracture with displacement, deformity and residual signs." },
  { id: "pelvis_ilium_deformity", label: "Pelvis — Ilium", category: "fracture_deformity", anatomicalKeys: ["pelvis"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Healed fracture with displacement, deformity and residual signs." },
  { id: "pelvis_ischium_displaced_ge_1inch", label: "Pelvis — Ischium displaced 1 inch or more", category: "fracture_deformity", anatomicalKeys: ["pelvis"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Healed fracture with displacement, deformity and residual signs." },
  { id: "pelvis_symphysis_separated", label: "Pelvis — Symphysis pubis (separated)", category: "fracture_deformity", anatomicalKeys: ["pelvis"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Healed fracture with displacement, deformity and residual signs." },
  { id: "pelvis_sacrum_into_sacroiliac", label: "Pelvis — Sacrum into sacroiliac joint", category: "fracture_deformity", anatomicalKeys: ["sacroiliac"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Healed fracture with displacement, deformity and residual signs." },
  { id: "pelvis_coccyx_nonunion_or_excision", label: "Pelvis — Coccyx (nonunion or excision)", category: "fracture_deformity", anatomicalKeys: ["pelvis"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Residual coccygeal deformity." },
  { id: "acetabular_fracture_undisplaced", label: "Acetabular fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["acetabulum"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Acetabular fracture, undisplaced." },
  { id: "acetabular_fracture_displaced", label: "Acetabular fracture — Displaced", category: "fracture_deformity", anatomicalKeys: ["acetabulum"], entryType: "fixed", minPercent: 20, maxPercent: 20, description: "Acetabular fracture, displaced." },
  { id: "femoral_neck_head_malunion", label: "Hip — Femoral neck/head fracture malunion", category: "fracture_deformity", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 15, maxPercent: 15, description: "Femoral neck/head fracture with malunion." },
  { id: "femoral_neck_head_nonunion", label: "Hip — Femoral neck/head fracture nonunion", category: "fracture_deformity", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 18, maxPercent: 18, description: "Femoral neck/head fracture with nonunion." },
  { id: "femoral_neck_head_avascular_necrosis", label: "Hip — Femoral neck/head fracture avascular necrosis", category: "fracture_deformity", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 20, maxPercent: 20, description: "Femoral neck/head fracture with avascular necrosis." },
  { id: "femoral_shaft_angulation_10_14", label: "Femoral shaft fracture — Angulation 10-14°", category: "fracture_deformity", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Healed with angular deformity 10-14°." },
  { id: "femoral_shaft_angulation_15_19", label: "Femoral shaft fracture — Angulation 15-19°", category: "fracture_deformity", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Healed with angular deformity 15-19°." },
  { id: "femoral_shaft_angulation_20_plus", label: "Femoral shaft fracture — Angulation ≥20°", category: "fracture_deformity", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Healed with angular deformity ≥20°." },
  { id: "patellar_fracture_undisplaced", label: "Patellar fracture (intra-articular) — Undisplaced, healed", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Patellar intra-articular fracture, undisplaced." },
  { id: "patellar_fracture_articular_displaced_gt3mm", label: "Patellar fracture — Articular surface displaced >3 mm", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Patellar intra-articular fracture with displaced articular surface." },
  { id: "patellar_fracture_displaced_nonunion", label: "Patellar fracture — Displaced with nonunion", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 9, maxPercent: 9, description: "Patellar displaced fracture with nonunion." },
  { id: "patellectomy_partial", label: "Patellectomy — Partial", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Partial patellectomy." },
  { id: "patellectomy_total", label: "Patellectomy — Total", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 9, maxPercent: 9, description: "Total patellectomy." },
  { id: "tibial_plateau_undisplaced", label: "Tibial plateau fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Intra-articular plateau fracture, undisplaced." },
  { id: "tibial_plateau_mild_depression", label: "Tibial plateau fracture — Mild angulation/depression", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Displaced with mild depression/angulation." },
  { id: "tibial_plateau_moderate_depression", label: "Tibial plateau fracture — Moderate angulation/depression", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Displaced with moderate depression/angulation." },
  { id: "tibial_plateau_severe_depression", label: "Tibial plateau fracture — Severe angulation/depression", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 12, maxPercent: 12, description: "Displaced with severe depression/angulation." },
  { id: "supracondylar_angulation_5_9", label: "Supracondylar fracture — Angulation 5-9°", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Displaced supracondylar fracture with 5-9° angulation." },
  { id: "supracondylar_angulation_10_19", label: "Supracondylar fracture — Angulation 10-19°", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Displaced supracondylar fracture with 10-19° angulation." },
  { id: "supracondylar_angulation_20_plus", label: "Supracondylar fracture — Angulation ≥20°", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 9, maxPercent: 9, description: "Displaced supracondylar fracture with ≥20° angulation." },
  { id: "intercondylar_undisplaced", label: "Intercondylar fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Intercondylar fracture, undisplaced." },
  { id: "intercondylar_displaced", label: "Intercondylar fracture — Displaced", category: "fracture_deformity", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 12, maxPercent: 12, description: "Intercondylar fracture, displaced." },
  { id: "tibial_shaft_malalignment_10_14", label: "Tibial shaft fracture — Malalignment 10-14°", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Tibial shaft fracture with 10-14° malalignment." },
  { id: "tibial_shaft_malalignment_15_19", label: "Tibial shaft fracture — Malalignment 15-19°", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Tibial shaft fracture with 15-19° malalignment." },
  { id: "tibial_shaft_malalignment_20_plus", label: "Tibial shaft fracture — Malalignment ≥20°", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Tibial shaft fracture with ≥20° malalignment." },
  { id: "ankle_extra_articular_10_14", label: "Ankle fracture extra-articular — Angulation 10-14°", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Extra-articular ankle fracture with 10-14° angulation." },
  { id: "ankle_extra_articular_15_19", label: "Ankle fracture extra-articular — Angulation 15-19°", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Extra-articular ankle fracture with 15-19° angulation." },
  { id: "ankle_extra_articular_20_plus", label: "Ankle fracture extra-articular — Angulation ≥20°", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 9, maxPercent: 9, description: "Extra-articular ankle fracture with ≥20° angulation." },
  { id: "ankle_intra_articular_undisplaced", label: "Ankle fracture intra-articular — No displacement", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Intra-articular ankle fracture with no displacement." },
  { id: "ankle_intra_articular_displaced", label: "Ankle fracture intra-articular — Displaced", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 12, maxPercent: 12, description: "Intra-articular ankle fracture with displacement." },
  { id: "calcaneal_extra_articular_lt20", label: "Calcaneal fracture (extra-articular) — Angulation <20°", category: "fracture_deformity", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Calcaneal extra-articular fracture with varus/valgus angulation <20°." },
  { id: "calcaneal_extra_articular_ge20", label: "Calcaneal fracture (extra-articular) — Angulation ≥20°", category: "fracture_deformity", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Calcaneal extra-articular fracture with varus/valgus angulation ≥20°." },
  { id: "subtalar_fracture_undisplaced", label: "Subtalar fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 7, maxPercent: 7, description: "Intra-articular subtalar fracture, undisplaced." },
  { id: "subtalar_fracture_displaced", label: "Subtalar fracture — Displaced", category: "fracture_deformity", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 15, maxPercent: 15, description: "Intra-articular subtalar fracture, displaced." },
  { id: "talonavicular_fracture_undisplaced", label: "Talonavicular fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["talonavicular"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Talonavicular fracture, undisplaced." },
  { id: "talonavicular_fracture_displaced", label: "Talonavicular fracture — Displaced", category: "fracture_deformity", anatomicalKeys: ["talonavicular"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Talonavicular fracture, displaced." },
  { id: "calcaneocuboid_fracture_undisplaced", label: "Calcaneocuboid fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["calcaneocuboid"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Calcaneocuboid fracture, undisplaced." },
  { id: "calcaneocuboid_fracture_displaced", label: "Calcaneocuboid fracture — Displaced", category: "fracture_deformity", anatomicalKeys: ["calcaneocuboid"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Calcaneocuboid fracture, displaced." },
  { id: "midfoot_lisfranc_cavus_mild", label: "Midfoot deformity (Lisfranc/cavus) — Mild", category: "fracture_deformity", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Midfoot deformity following fracture." },
  { id: "midfoot_lisfranc_cavus_moderate", label: "Midfoot deformity (Lisfranc/cavus) — Moderate", category: "fracture_deformity", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Midfoot deformity following fracture." },
  { id: "rocker_bottom_mild", label: "Rocker bottom deformity — Mild", category: "fracture_deformity", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Rocker-bottom deformity, mild." },
  { id: "rocker_bottom_moderate", label: "Rocker bottom deformity — Moderate", category: "fracture_deformity", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Rocker-bottom deformity, moderate." },
  { id: "rocker_bottom_severe", label: "Rocker bottom deformity — Severe", category: "fracture_deformity", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 9, maxPercent: 9, description: "Rocker-bottom deformity, severe." },
  { id: "talus_fracture_undisplaced", label: "Talus fracture — Undisplaced", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Talus fracture, undisplaced." },
  { id: "talus_fracture_displaced", label: "Talus fracture — Displaced", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Talus fracture, displaced." },
  { id: "talus_fracture_nonunion", label: "Talus fracture — Non-union", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Talus fracture with nonunion." },
  { id: "talus_fracture_avascular_necrosis", label: "Talus fracture — Avascular necrosis", category: "fracture_deformity", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 15, maxPercent: 15, description: "Talus fracture with avascular necrosis." },
  { id: "metatarsal_1_fracture_angulation", label: "Metatarsal fracture with angulation — 1st metatarsal", category: "fracture_deformity", anatomicalKeys: ["first_mtp"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "1st metatarsal dorsal/plantar angulation." },
  { id: "metatarsal_2_fracture_angulation", label: "Metatarsal fracture with angulation — 2nd metatarsal", category: "fracture_deformity", anatomicalKeys: ["second_mtp"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "2nd metatarsal dorsal/plantar angulation." },
  { id: "metatarsal_3_fracture_angulation", label: "Metatarsal fracture with angulation — 3rd metatarsal", category: "fracture_deformity", anatomicalKeys: ["third_mtp"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "3rd metatarsal dorsal/plantar angulation." },
  { id: "metatarsal_4_fracture_angulation", label: "Metatarsal fracture with angulation — 4th metatarsal", category: "fracture_deformity", anatomicalKeys: ["fourth_mtp"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "4th metatarsal dorsal/plantar angulation." },
  { id: "metatarsal_5_fracture_angulation", label: "Metatarsal fracture with angulation — 5th metatarsal", category: "fracture_deformity", anatomicalKeys: ["fifth_mtp"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "5th metatarsal dorsal/plantar angulation." },
  { id: "phalangeal_big_toe_angulation", label: "Phalangeal fracture with angulation — Big toe", category: "fracture_deformity", anatomicalKeys: ["first_mtp"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Big toe phalangeal angulation." },
  { id: "phalangeal_2nd_toe_angulation", label: "Phalangeal fracture with angulation — 2nd toe", category: "fracture_deformity", anatomicalKeys: ["lesser_toes_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "2nd toe phalangeal angulation." },
  { id: "phalangeal_3rd_toe_angulation", label: "Phalangeal fracture with angulation — 3rd toe", category: "fracture_deformity", anatomicalKeys: ["lesser_toes_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "3rd toe phalangeal angulation." },
  { id: "phalangeal_4th_toe_angulation", label: "Phalangeal fracture with angulation — 4th toe", category: "fracture_deformity", anatomicalKeys: ["lesser_toes_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "4th toe phalangeal angulation." },
  { id: "phalangeal_5th_toe_angulation", label: "Phalangeal fracture with angulation — 5th toe", category: "fracture_deformity", anatomicalKeys: ["lesser_toes_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "5th toe phalangeal angulation." },

  // Chapter 4, Section V(B): Ligament and soft tissue injuries
  { id: "patellar_subluxation", label: "Knee — Patellar subluxation", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Persistent patellar subluxation." },
  { id: "patellar_dislocation_recurrent", label: "Knee — Patellar dislocation (recurrent)", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Recurrent patellar dislocation." },
  { id: "meniscectomy_partial", label: "Meniscectomy (medial or lateral) — Partial", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Partial meniscectomy of one side." },
  { id: "meniscectomy_total", label: "Meniscectomy (medial or lateral) — Total", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 7, maxPercent: 7, description: "Total meniscectomy of one side." },
  { id: "meniscectomy_bilateral_partial", label: "Meniscectomy (medial and lateral) — Partial", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Partial meniscectomy involving both medial and lateral." },
  { id: "meniscectomy_bilateral_total", label: "Meniscectomy (medial and lateral) — Total", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Total meniscectomy involving both medial and lateral." },
  { id: "acl_mild", label: "Anterior cruciate ligament laxity — Mild", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "ACL laxity, mild." },
  { id: "acl_moderate", label: "Anterior cruciate ligament laxity — Moderate", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "ACL laxity, moderate." },
  { id: "acl_severe", label: "Anterior cruciate ligament laxity — Severe", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 12, maxPercent: 12, description: "ACL laxity, severe." },
  { id: "pcl_mild", label: "Posterior cruciate ligament laxity — Mild", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "PCL laxity, mild." },
  { id: "pcl_moderate", label: "Posterior cruciate ligament laxity — Moderate", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 7, maxPercent: 7, description: "PCL laxity, moderate." },
  { id: "pcl_severe", label: "Posterior cruciate ligament laxity — Severe", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "PCL laxity, severe." },
  { id: "mcl_mild", label: "Medial collateral ligament laxity — Mild", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "MCL laxity, mild." },
  { id: "mcl_moderate", label: "Medial collateral ligament laxity — Moderate", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "MCL laxity, moderate." },
  { id: "mcl_severe", label: "Medial collateral ligament laxity — Severe", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 7, maxPercent: 7, description: "MCL laxity, severe." },
  { id: "lcl_mild", label: "Lateral collateral ligament laxity — Mild", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "LCL laxity, mild." },
  { id: "lcl_moderate", label: "Lateral collateral ligament laxity — Moderate", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "LCL laxity, moderate." },
  { id: "lcl_severe", label: "Lateral collateral ligament laxity — Severe", category: "ligament_soft_tissue", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 7, maxPercent: 7, description: "LCL laxity, severe." },
  { id: "ankle_ligament_mild", label: "Ankle ligamentous instability — Mild", category: "ligament_soft_tissue", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Chronic ankle ligament instability, mild." },
  { id: "ankle_ligament_moderate", label: "Ankle ligamentous instability — Moderate", category: "ligament_soft_tissue", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Chronic ankle ligament instability, moderate." },
  { id: "ankle_ligament_severe", label: "Ankle ligamentous instability — Severe", category: "ligament_soft_tissue", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Chronic ankle ligament instability, severe." },

  // Chapter 4, Section V(C): Osteoarthritis (post-traumatic)
  { id: "oa_sacroiliac_mild", label: "Osteoarthritis Sacroiliac — Mild", category: "osteoarthritis", anatomicalKeys: ["sacroiliac"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_sacroiliac_moderate", label: "Osteoarthritis Sacroiliac — Moderate", category: "osteoarthritis", anatomicalKeys: ["sacroiliac"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_sacroiliac_severe", label: "Osteoarthritis Sacroiliac — Severe", category: "osteoarthritis", anatomicalKeys: ["sacroiliac"], entryType: "fixed", minPercent: 12, maxPercent: 12, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_hip_mild", label: "Osteoarthritis Hip — Mild", category: "osteoarthritis", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_hip_moderate", label: "Osteoarthritis Hip — Moderate", category: "osteoarthritis", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_hip_severe", label: "Osteoarthritis Hip — Severe", category: "osteoarthritis", anatomicalKeys: ["hip"], entryType: "fixed", minPercent: 20, maxPercent: 20, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_knee_mild", label: "Osteoarthritis Knee — Mild", category: "osteoarthritis", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_knee_moderate", label: "Osteoarthritis Knee — Moderate", category: "osteoarthritis", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_knee_severe", label: "Osteoarthritis Knee — Severe", category: "osteoarthritis", anatomicalKeys: ["knee"], entryType: "fixed", minPercent: 20, maxPercent: 20, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_patellofemoral_mild", label: "Osteoarthritis Patellofemoral — Mild", category: "osteoarthritis", anatomicalKeys: ["patellofemoral"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_patellofemoral_moderate", label: "Osteoarthritis Patellofemoral — Moderate", category: "osteoarthritis", anatomicalKeys: ["patellofemoral"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_patellofemoral_severe", label: "Osteoarthritis Patellofemoral — Severe", category: "osteoarthritis", anatomicalKeys: ["patellofemoral"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_ankle_mild", label: "Osteoarthritis Ankle — Mild", category: "osteoarthritis", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_ankle_moderate", label: "Osteoarthritis Ankle — Moderate", category: "osteoarthritis", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_ankle_severe", label: "Osteoarthritis Ankle — Severe", category: "osteoarthritis", anatomicalKeys: ["ankle"], entryType: "fixed", minPercent: 12, maxPercent: 12, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_subtalar_mild", label: "Osteoarthritis Subtalar — Mild", category: "osteoarthritis", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_subtalar_moderate", label: "Osteoarthritis Subtalar — Moderate", category: "osteoarthritis", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_subtalar_severe", label: "Osteoarthritis Subtalar — Severe", category: "osteoarthritis", anatomicalKeys: ["subtalar"], entryType: "fixed", minPercent: 10, maxPercent: 10, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_talonavicular_mild", label: "Osteoarthritis Talonavicular — Mild", category: "osteoarthritis", anatomicalKeys: ["talonavicular"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_talonavicular_moderate", label: "Osteoarthritis Talonavicular — Moderate", category: "osteoarthritis", anatomicalKeys: ["talonavicular"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_talonavicular_severe", label: "Osteoarthritis Talonavicular — Severe", category: "osteoarthritis", anatomicalKeys: ["talonavicular"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_calcaneocuboid_mild", label: "Osteoarthritis Calcaneocuboid — Mild", category: "osteoarthritis", anatomicalKeys: ["calcaneocuboid"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_calcaneocuboid_moderate", label: "Osteoarthritis Calcaneocuboid — Moderate", category: "osteoarthritis", anatomicalKeys: ["calcaneocuboid"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_calcaneocuboid_severe", label: "Osteoarthritis Calcaneocuboid — Severe", category: "osteoarthritis", anatomicalKeys: ["calcaneocuboid"], entryType: "fixed", minPercent: 6, maxPercent: 6, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_tarsometatarsal_mild", label: "Osteoarthritis Tarso-metatarsal — Mild", category: "osteoarthritis", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_tarsometatarsal_moderate", label: "Osteoarthritis Tarso-metatarsal — Moderate", category: "osteoarthritis", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 4, maxPercent: 4, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_tarsometatarsal_severe", label: "Osteoarthritis Tarso-metatarsal — Severe", category: "osteoarthritis", anatomicalKeys: ["tarsometatarsal"], entryType: "fixed", minPercent: 8, maxPercent: 8, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_first_mtp_mild", label: "Osteoarthritis First metatarsal-phalangeal — Mild", category: "osteoarthritis", anatomicalKeys: ["first_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, mild." },
  { id: "oa_first_mtp_moderate", label: "Osteoarthritis First metatarsal-phalangeal — Moderate", category: "osteoarthritis", anatomicalKeys: ["first_mtp"], entryType: "fixed", minPercent: 2, maxPercent: 2, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_first_mtp_severe", label: "Osteoarthritis First metatarsal-phalangeal — Severe", category: "osteoarthritis", anatomicalKeys: ["first_mtp"], entryType: "fixed", minPercent: 5, maxPercent: 5, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_second_mtp_moderate", label: "Osteoarthritis Second metatarsal-phalangeal — Moderate", category: "osteoarthritis", anatomicalKeys: ["second_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_second_mtp_severe", label: "Osteoarthritis Second metatarsal-phalangeal — Severe", category: "osteoarthritis", anatomicalKeys: ["second_mtp"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_third_mtp_moderate", label: "Osteoarthritis Third metatarsal-phalangeal — Moderate", category: "osteoarthritis", anatomicalKeys: ["third_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_third_mtp_severe", label: "Osteoarthritis Third metatarsal-phalangeal — Severe", category: "osteoarthritis", anatomicalKeys: ["third_mtp"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_fourth_mtp_moderate", label: "Osteoarthritis Fourth metatarsal-phalangeal — Moderate", category: "osteoarthritis", anatomicalKeys: ["fourth_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_fourth_mtp_severe", label: "Osteoarthritis Fourth metatarsal-phalangeal — Severe", category: "osteoarthritis", anatomicalKeys: ["fourth_mtp"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Post-traumatic osteoarthritis, severe." },
  { id: "oa_fifth_mtp_moderate", label: "Osteoarthritis Fifth metatarsal-phalangeal — Moderate", category: "osteoarthritis", anatomicalKeys: ["fifth_mtp"], entryType: "fixed", minPercent: 1, maxPercent: 1, description: "Post-traumatic osteoarthritis, moderate." },
  { id: "oa_fifth_mtp_severe", label: "Osteoarthritis Fifth metatarsal-phalangeal — Severe", category: "osteoarthritis", anatomicalKeys: ["fifth_mtp"], entryType: "fixed", minPercent: 3, maxPercent: 3, description: "Post-traumatic osteoarthritis, severe." },

];

/** Set of canonical lower-limb DBE condition IDs for legacy hydration checks. */
export const CANONICAL_LOWER_DBE_IDS: ReadonlySet<string> = new Set(DBE_CONDITIONS.map((c) => c.id));

export interface LowerLimbDbeHydrationResult {
  value: LowerLimbDbeValue;
  hasLegacyRows: boolean;
  droppedIds: string[];
}

/**
 * Hydrate (validate) a persisted lower-limb DBE value.
 * Drops any condition IDs that are not present in the canonical DBE_CONDITIONS table
 * (e.g. non-canonical synthetic rows saved by older versions) and signals the caller
 * so a clinician-facing warning can be shown requiring re-selection.
 */
export function hydrateLowerLimbDbe(dbe: LowerLimbDbeValue): LowerLimbDbeHydrationResult {
  const validConditions = dbe.selectedConditions.filter((s) => CANONICAL_LOWER_DBE_IDS.has(s.conditionId));
  const droppedIds = dbe.selectedConditions
    .filter((s) => !CANONICAL_LOWER_DBE_IDS.has(s.conditionId))
    .map((s) => s.conditionId);
  return {
    value: { selectedConditions: validConditions },
    hasLegacyRows: droppedIds.length > 0,
    droppedIds,
  };
}

export const LOWER_ANATOMICAL_LABELS: Record<LowerAnatomicalKey, string> = {
  pelvis: "Pelvis",
  sacroiliac: "Sacroiliac",
  acetabulum: "Acetabulum",
  hip: "Hip",
  knee: "Knee",
  patellofemoral: "Patellofemoral",
  ankle: "Ankle",
  subtalar: "Subtalar",
  talonavicular: "Talonavicular",
  calcaneocuboid: "Calcaneocuboid",
  tarsometatarsal: "Tarso-metatarsal",
  first_mtp: "1st MTP",
  second_mtp: "2nd MTP",
  third_mtp: "3rd MTP",
  fourth_mtp: "4th MTP",
  fifth_mtp: "5th MTP",
  great_toe_ip: "Great Toe IP",
  lesser_toes_mtp: "Lesser Toes MTP",
};

const LOWER_DBE_BY_ID = new Map(DBE_CONDITIONS.map((entry) => [entry.id, entry] as const));

export interface LowerDbeHydrationSanitization {
  droppedCount: number;
  droppedConditionIds: string[];
}

export function sanitizeLowerLimbDbeSelections(value: LowerLimbValue): {
  value: LowerLimbValue;
  dropped: LowerDbeHydrationSanitization;
} {
  const droppedConditionIds: string[] = [];
  const sanitizedSelections = value.dbe.selectedConditions.filter((selection) => {
    const condition = LOWER_DBE_BY_ID.get(selection.conditionId);
    if (!condition) {
      droppedConditionIds.push(selection.conditionId);
      return false;
    }
    // Force re-entry for legacy ranged rows now represented as canonical fixed entries.
    if (condition.entryType === "fixed" && selection.selectedPercent !== condition.minPercent) {
      droppedConditionIds.push(selection.conditionId);
      return false;
    }
    return true;
  });

  return {
    value: {
      ...value,
      dbe: {
        selectedConditions: sanitizedSelections,
      },
    },
    dropped: {
      droppedCount: droppedConditionIds.length,
      droppedConditionIds,
    },

  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Amputation Suppression Logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Determine which ROM joint keys are suppressed by the current amputation state.
 * Proximal amputations disable all distal structures.
 */
export function getAmputationSuppressedJoints(amp: LowerLimbAmputationValue): Set<string> {
  const suppressedAnatomical = getAmputationSuppressedAnatomicalKeys(amp);
  const suppressed = new Set<string>();
  for (const key of suppressedAnatomical) {
    if (key === "hip") {
      suppressed.add("hip");
    } else if (key === "knee" || key === "patellofemoral") {
      suppressed.add("knee");
    } else if (key === "ankle") {
      suppressed.add("ankle");
    } else if (key === "subtalar") {
      suppressed.add("subtalar");
    } else if (key === "first_mtp") {
      suppressed.add("great_toe_mtp");
    } else if (key === "great_toe_ip") {
      suppressed.add("great_toe_ip");
    } else if (
      key === "second_mtp" ||
      key === "third_mtp" ||
      key === "fourth_mtp" ||
      key === "fifth_mtp" ||
      key === "lesser_toes_mtp"
    ) {
      suppressed.add("lesser_toes_mtp");
    }
  }
  return suppressed;
}

function getRomJointAnatomicalKey(jointKey: string): LowerAnatomicalKey | null {
  if (jointKey === "hip") return "hip";
  if (jointKey === "knee") return "knee";
  if (jointKey === "ankle") return "ankle";
  if (jointKey === "subtalar") return "subtalar";
  if (jointKey === "great_toe_mtp") return "first_mtp";
  if (jointKey === "great_toe_ip") return "great_toe_ip";
  if (jointKey === "lesser_toes_mtp") return "lesser_toes_mtp";
  return null;
}

function getAmputationSuppressedAnatomicalKeys(amp: LowerLimbAmputationValue): Set<LowerAnatomicalKey> {
  const suppressed = new Set<LowerAnatomicalKey>();
  const distalKeys: LowerAnatomicalKey[] = [
    "ankle",
    "subtalar",
    "talonavicular",
    "calcaneocuboid",
    "tarsometatarsal",
    "first_mtp",
    "second_mtp",
    "third_mtp",
    "fourth_mtp",
    "fifth_mtp",
    "great_toe_ip",
    "lesser_toes_mtp",
  ];

  switch (amp.legLevel) {
    case "above_knee":
      suppressed.add("knee");
      suppressed.add("patellofemoral");
      distalKeys.forEach((key) => suppressed.add(key));
      break;
    case "below_knee":
      distalKeys.forEach((key) => suppressed.add(key));
      break;
    case "syme":
      suppressed.add("ankle");
      distalKeys.filter((key) => key !== "ankle").forEach((key) => suppressed.add(key));
      break;
    case "midtarsal":
    case "transmetatarsal":
      [
        "first_mtp",
        "second_mtp",
        "third_mtp",
        "fourth_mtp",
        "fifth_mtp",
        "great_toe_ip",
        "lesser_toes_mtp",
      ].forEach((key) => suppressed.add(key as LowerAnatomicalKey));
      break;
  }

  const greatToeLevel = amp.toes.great;
  if (greatToeLevel && greatToeLevel !== "none") {
    if (greatToeLevel === "ip") {
      suppressed.add("great_toe_ip");
    } else {
      suppressed.add("first_mtp");
      suppressed.add("great_toe_ip");
    }
  }

  const lesserToeToKey: Record<Exclude<ToeKey, "great">, LowerAnatomicalKey> = {
    second: "second_mtp",
    third: "third_mtp",
    fourth: "fourth_mtp",
    fifth: "fifth_mtp",
  };
  const lesserToes: Array<Exclude<ToeKey, "great">> = ["second", "third", "fourth", "fifth"];
  lesserToes.forEach((toe) => {
    if (amp.toes[toe] && amp.toes[toe] !== "none") {
      suppressed.add(lesserToeToKey[toe]);
    }
  });

  const allLesserAmputated = lesserToes.every((toe) => amp.toes[toe] && amp.toes[toe] !== "none");
  if (allLesserAmputated) {
    suppressed.add("lesser_toes_mtp");
  }

  return suppressed;
}

function isLowerAnatomicalKeySuppressed(
  amp: LowerLimbAmputationValue,
  key: LowerAnatomicalKey
): boolean {
  return getAmputationSuppressedAnatomicalKeys(amp).has(key);
}

/**
 * Check if a ROM joint is suppressed by the current amputation.
 */
export function isRomJointSuppressed(amp: LowerLimbAmputationValue, jointKey: string): boolean {
  const anatomicalKey = getRomJointAnatomicalKey(jointKey);
  if (!anatomicalKey) return false;
  return isLowerAnatomicalKeySuppressed(amp, anatomicalKey);
}

/**
 * Check if a DBE condition's anatomical key is suppressed by amputation.
 */
export function isDbeJointSuppressed(amp: LowerLimbAmputationValue, joint: string | undefined): boolean {
  if (!joint) return false;
  return isLowerAnatomicalKeySuppressed(amp, joint as LowerAnatomicalKey);
}

export function isDbeAnatomicalSuppressed(
  amp: LowerLimbAmputationValue,
  anatomicalKeys: readonly LowerAnatomicalKey[] | LowerAnatomicalKey | undefined,
  selectedAnatomicalKey?: LowerAnatomicalKey
): boolean {
  if (!anatomicalKeys) return false;
  const keys = Array.isArray(anatomicalKeys) ? anatomicalKeys : [anatomicalKeys];
  const resolved =
    selectedAnatomicalKey && keys.includes(selectedAnatomicalKey) ? [selectedAnatomicalKey] : keys;
  return resolved.every((key) => isLowerAnatomicalKeySuppressed(amp, key));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure Calculation Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function lookupRom(table: RomLookup[], angle: number): number {
  if (table.length === 0) return 0;
  if (angle <= table[0].angle) return table[0].percent;
  if (angle >= table[table.length - 1].angle) return table[table.length - 1].percent;
  for (let i = 0; i < table.length - 1; i++) {
    const lo = table[i];
    const hi = table[i + 1];
    if (angle >= lo.angle && angle <= hi.angle) {
      if (lo.angle === hi.angle) return lo.percent;
      const frac = (angle - lo.angle) / (hi.angle - lo.angle);
      const val = lo.percent + frac * (hi.percent - lo.percent);
      return Math.round(val * 10) / 10;
    }
  }
  return table[table.length - 1].percent;
}

export function lookupShortening(cm: number): number {
  if (cm <= 0) return 0;
  // Find exact or interpolate
  for (let i = 0; i < SHORTENING_TABLE.length - 1; i++) {
    const lo = SHORTENING_TABLE[i];
    const hi = SHORTENING_TABLE[i + 1];
    if (cm >= lo.cm && cm <= hi.cm) {
      if (lo.cm === hi.cm) return lo.percent;
      const frac = (cm - lo.cm) / (hi.cm - lo.cm);
      const val = lo.percent + frac * (hi.percent - lo.percent);
      return Math.round(val * 10) / 10;
    }
  }
  // Beyond table → cap at 30%
  return 30;
}

export function calculateAmputation(amp: LowerLimbAmputationValue): CategoryResult {
  const notes: string[] = [];

  if (amp.legLevel !== "none") {
    const level = LEG_AMPUTATION_LEVELS.find((l) => l.id === amp.legLevel);
    if (level) {
      notes.push(`${level.label}: ${level.percent}%`);
      return {
        label: "Amputations",
        rawPercent: level.percent,
        notes,
        gatiodReference: LOWER_LIMB_REFS.amputation,
      };
    }
  }

  let toeTotal = 0;
  const toeKeys: ToeKey[] = ["great", "second", "third", "fourth", "fifth"];
  for (const tk of toeKeys) {
    const levelId = amp.toes[tk];
    if (levelId && levelId !== "none") {
      const level = TOE_AMPUTATION_LEVELS[tk].find((l) => l.id === levelId);
      if (level) {
        toeTotal += level.percent;
        notes.push(`${TOE_LABELS[tk]} (${level.label}): ${level.percent}%`);
      }
    }
  }

  if (toeTotal > FOOT_AMPUTATION_CAP) {
    notes.push(`Toe total ${toeTotal}% capped at foot value ${FOOT_AMPUTATION_CAP}%`);
    toeTotal = FOOT_AMPUTATION_CAP;
  }

  return {
    label: "Amputations",
    rawPercent: toeTotal,
    notes,
    gatiodReference: LOWER_LIMB_REFS.amputation,
  };
}

function getRomLookupTable(direction: RomDirection, isAnkylosed: boolean): RomLookup[] {
  return isAnkylosed && direction.ankylosisTable ? direction.ankylosisTable : direction.table;
}

export function calculateRomJointPercent(
  joint: RomJoint,
  jointValue: RomJointValue
): { total: number; details: { label: string; percent: number }[] } {
  const details: { label: string; percent: number }[] = [];

  for (const direction of joint.directions) {
    const angle = jointValue.measurements[direction.key];
    if (angle === undefined || angle === null) continue;
    const pct = lookupRom(getRomLookupTable(direction, jointValue.isAnkylosed), angle);
    if (pct > 0) {
      details.push({ label: direction.label, percent: pct });
    }
  }

  if (details.length === 0) {
    return { total: 0, details };
  }

  if (jointValue.isAnkylosed) {
    return { total: Math.max(...details.map((d) => d.percent)), details };
  }

  return {
    total: details.reduce((sum, d) => sum + d.percent, 0),
    details,
  };
}

export function calculateRom(rom: LowerLimbRomValue): CategoryResult {
  const notes: string[] = [];
  const jointPercents: number[] = [];

  for (const joint of ROM_JOINTS) {
    const jointValue = rom.joints[joint.key];
    if (!jointValue) continue;

    const evaluated = calculateRomJointPercent(joint, jointValue);
    if (evaluated.total <= 0) continue;

    if (jointValue.isAnkylosed) {
      notes.push(`${joint.label} (ankylosed): highest = ${evaluated.total}%`);
    } else {
      notes.push(`${joint.label}: ${evaluated.details.map((d) => `${d.label} ${d.percent}%`).join(" + ")} = ${evaluated.total}%`);
    }
    jointPercents.push(evaluated.total);
  }

  const total = jointPercents.length > 1 ? combinedValuesChart(jointPercents) : (jointPercents[0] ?? 0);
  if (jointPercents.length > 1) {
    notes.push(`CVC across ${jointPercents.length} joints: ${total}%`);
  }

  return { label: "ROM", rawPercent: total, notes, gatiodReference: LOWER_LIMB_REFS.rom };
}

export function calculateNeurological(neuro: LowerLimbNeurologicalValue): CategoryResult {
  const notes: string[] = [];
  const values: number[] = [];
  const bestByNerve = new Map<string, { label: string; pct: number; note: string }>();

  for (const sel of neuro.selectedNerves) {
    const nerve = LOWER_LIMB_NERVES.find((n) => n.key === sel.nerveKey);
    if (!nerve) continue;

    let maxPct = 0;
    if (sel.deficitType === "sensory") maxPct = nerve.sensoryMax ?? 0;
    else if (sel.deficitType === "motor") maxPct = nerve.motorMax ?? 0;
    else maxPct = nerve.combinedMax ?? 0;

    const pct = sel.lossType === "partial" ? maxPct / 2 : maxPct;
    if (pct <= 0) continue;
    const note = `${nerve.label} (${sel.deficitType}, ${sel.lossType}): ${pct}%`;
    const prev = bestByNerve.get(nerve.key);
    if (!prev) {
      bestByNerve.set(nerve.key, { label: nerve.label, pct, note });
    } else if (pct > prev.pct) {
      notes.push(`${nerve.label}: duplicate entry ignored (kept ${pct}%, dropped ${prev.pct}%)`);
      bestByNerve.set(nerve.key, { label: nerve.label, pct, note });
    } else {
      notes.push(`${nerve.label}: duplicate entry ignored (kept ${prev.pct}%, dropped ${pct}%)`);
    }
  }

  for (const entry of bestByNerve.values()) {
    values.push(entry.pct);
    notes.push(entry.note);
  }

  const total = combinedValuesChart(values);
  return {
    label: "Neurological",
    rawPercent: total,
    notes,
    gatiodReference: LOWER_LIMB_REFS.neurological,
  };
}

export function calculateShortening(shortening: ShorteningValue): CategoryResult {
  const notes: string[] = [];
  const pct = lookupShortening(shortening.discrepancyCm);
  if (pct > 0) {
    notes.push(`${shortening.discrepancyCm} cm discrepancy: ${pct}%`);
  }
  return {
    label: "Shortening",
    rawPercent: pct,
    notes,
    gatiodReference: LOWER_LIMB_REFS.shortening,
  };
}

export function calculateDbe(dbe: LowerLimbDbeValue, amp?: LowerLimbAmputationValue): CategoryResult {
  const notes: string[] = [];
  const values: number[] = [];
  const bestByConditionAndTarget = new Map<
    string,
    { cond: DbeCondition; pct: number; anatomicalKey: LowerAnatomicalKey }
  >();

  for (const sel of dbe.selectedConditions) {
    const cond = LOWER_DBE_BY_ID.get(sel.conditionId);
    if (!cond) continue;
    const anatomicalKey =
      sel.selectedAnatomicalKey && cond.anatomicalKeys.includes(sel.selectedAnatomicalKey)
        ? sel.selectedAnatomicalKey
        : cond.anatomicalKeys[0];
    const pct = Math.min(Math.max(sel.selectedPercent, cond.minPercent), cond.maxPercent);
    const dedupeKey = `${cond.id}::${anatomicalKey}`;
    const prev = bestByConditionAndTarget.get(dedupeKey);
    if (!prev) {
      bestByConditionAndTarget.set(dedupeKey, { cond, pct, anatomicalKey });
    } else if (pct > prev.pct) {
      notes.push(`${cond.label}: duplicate entry ignored (kept ${pct}%, dropped ${prev.pct}%)`);
      bestByConditionAndTarget.set(dedupeKey, { cond, pct, anatomicalKey });
    } else {
      notes.push(`${cond.label}: duplicate entry ignored (kept ${prev.pct}%, dropped ${pct}%)`);
    }
  }

  for (const { cond, pct, anatomicalKey } of bestByConditionAndTarget.values()) {
    if (amp && isDbeAnatomicalSuppressed(amp, cond.anatomicalKeys, anatomicalKey)) {
      notes.push(`${cond.label}: suppressed by amputation`);
      continue;
    }
    values.push(pct);
    notes.push(`${cond.label} (${LOWER_ANATOMICAL_LABELS[anatomicalKey] ?? anatomicalKey}): ${pct}%`);
  }

  const total = combinedValuesChart(values);
  return { label: "DBE", rawPercent: total, notes, gatiodReference: LOWER_LIMB_REFS.dbe };
}

export function buildRomByAnatomicalKey(
  rom: LowerLimbRomValue,
  amp?: LowerLimbAmputationValue
): Record<string, number> {
  const grouped: Record<string, number[]> = {};

  for (const joint of ROM_JOINTS) {
    if (amp && isRomJointSuppressed(amp, joint.key)) continue;
    const jointValue = rom.joints[joint.key];
    if (!jointValue) continue;
    const evaluated = calculateRomJointPercent(joint, jointValue);
    if (evaluated.total <= 0) continue;
    const anatomicalKey = getRomJointAnatomicalKey(joint.key);
    if (!anatomicalKey) continue;
    grouped[anatomicalKey] = grouped[anatomicalKey] ?? [];
    grouped[anatomicalKey].push(evaluated.total);
  }

  const byJoint: Record<string, number> = {};
  for (const [joint, values] of Object.entries(grouped)) {
    byJoint[joint] = combinedValuesChart(values);
  }

  return byJoint;
}

export function buildRomByJoint(rom: LowerLimbRomValue, amp?: LowerLimbAmputationValue): Record<string, number> {
  return buildRomByAnatomicalKey(rom, amp);
}

export function buildDbeByAnatomicalKey(
  dbe: LowerLimbDbeValue,
  amp?: LowerLimbAmputationValue
): Record<string, number> {
  const grouped: Record<string, number[]> = {};
  const bestByConditionAndTarget = new Map<
    string,
    { cond: DbeCondition; pct: number; anatomicalKey: LowerAnatomicalKey }
  >();

  for (const sel of dbe.selectedConditions) {
    const cond = LOWER_DBE_BY_ID.get(sel.conditionId);
    if (!cond) continue;
    const anatomicalKey =
      sel.selectedAnatomicalKey && cond.anatomicalKeys.includes(sel.selectedAnatomicalKey)
        ? sel.selectedAnatomicalKey
        : cond.anatomicalKeys[0];
    const pct = Math.min(Math.max(sel.selectedPercent, cond.minPercent), cond.maxPercent);
    const dedupeKey = `${cond.id}::${anatomicalKey}`;
    const prev = bestByConditionAndTarget.get(dedupeKey);
    if (!prev || pct > prev.pct) {
      bestByConditionAndTarget.set(dedupeKey, { cond, pct, anatomicalKey });
    }
  }

  for (const { cond, pct, anatomicalKey } of bestByConditionAndTarget.values()) {
    if (amp && isDbeAnatomicalSuppressed(amp, cond.anatomicalKeys, anatomicalKey)) continue;
    grouped[anatomicalKey] = grouped[anatomicalKey] ?? [];
    grouped[anatomicalKey].push(pct);
  }

  const byJoint: Record<string, number> = {};
  for (const [joint, values] of Object.entries(grouped)) {
    byJoint[joint] = combinedValuesChart(values);
  }

  return byJoint;
}

export function buildDbeByJoint(dbe: LowerLimbDbeValue, amp?: LowerLimbAmputationValue): Record<string, number> {
  return buildDbeByAnatomicalKey(dbe, amp);
}

export function resolveDbeRomConflicts(
  rom: LowerLimbRomValue,
  dbe: LowerLimbDbeValue,
  amp?: LowerLimbAmputationValue
): { joint: string; romPercent: number; dbePercent: number; winner: string }[] {
  const conflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[] = [];

  const romByJoint = buildRomByAnatomicalKey(rom, amp);
  const dbeByJoint = buildDbeByAnatomicalKey(dbe, amp);

  for (const [joint, romPct] of Object.entries(romByJoint)) {
    const dbePct = dbeByJoint[joint];
    if (!dbePct || romPct <= 0) continue;
    conflicts.push({
      joint,
      romPercent: romPct,
      dbePercent: dbePct,
      winner: dbePct >= romPct ? "DBE" : "ROM",
    });
  }

  return conflicts;
}

export function calculateLowerLimb(value: LowerLimbValue): LowerLimbResult {
  const ampResult = calculateAmputation(value.amputations);
  const romResult = calculateRom(value.rom);
  const neuroResult = calculateNeurological(value.neurological);
  const shortResult = calculateShortening(value.shortening);
  const dbeResult = calculateDbe(value.dbe, value.amputations);

  // ── Cross-stream invariant: toe amputation + shortening ────────────────────
  // Per GATIOD Chapter 4, a toe amputation is assessed under amputations and a
  // shortening percent is only ever derived from a measured limb-length
  // discrepancy in cm. If both streams are non-zero on the same submission, it
  // is almost always a classification error — the LLM has routed an amputation
  // into the shortening field. Warn loudly on both streams so it surfaces in
  // the audit trail; don't auto-zero either, since a clinician may have a
  // legitimate combined finding (e.g. a real measured discrepancy alongside a
  // separate toe loss).
  const hasToeAmp = Object.values(value.amputations.toes).some((t) => t !== "none");
  if (hasToeAmp && value.shortening.discrepancyCm > 0) {
    const warning =
      "⚠ Cross-stream check: a toe amputation is present AND shortening > 0 cm. " +
      "Confirm this is a measured limb-length discrepancy in cm, not a toe loss " +
      "mis-routed into shortening (GATIOD Chapter 4 keeps these streams separate).";
    ampResult.notes.push(warning);
    shortResult.notes.push(warning);
  }

  const rawRomByJoint = buildRomByAnatomicalKey(value.rom);
  let romByJoint = buildRomByAnatomicalKey(value.rom, value.amputations);
  const rawDbeByJoint = buildDbeByAnatomicalKey(value.dbe);
  const dbeByJoint = buildDbeByAnatomicalKey(value.dbe, value.amputations);

  // ── Rule 1: Proximal Amputation Suppression ──────────────────────────────
  if (Object.keys(rawRomByJoint).length > Object.keys(romByJoint).length) {
    romResult.notes.push("ROM suppressed: proximal amputation absorbs distal functional loss");
  }
  if (Object.keys(rawDbeByJoint).length > Object.keys(dbeByJoint).length) {
    dbeResult.notes.push("DBE suppressed: proximal amputation absorbs distal assessments");
  }

  // ── Rule 3: Nerve vs ROM Conflict ────────────────────────────────────────
  if (value.neurological.romFromNerve) {
    romByJoint = {};
    romResult.notes.push("ROM excluded: restrictions attributed to nerve lesion per Rule R0022.");
  }

  // ── Rule 5: DBE vs ROM Conflict Resolution ───────────────────────────────
  const conflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[] = [];
  for (const [joint, romPct] of Object.entries(romByJoint)) {
    const dbePct = dbeByJoint[joint];
    if (!dbePct || romPct <= 0) continue;
    const winner = dbePct >= romPct ? "DBE" : "ROM";
    conflicts.push({
      joint,
      romPercent: romPct,
      dbePercent: dbePct,
      winner,
    });
    if (winner === "DBE") delete romByJoint[joint];
    else delete dbeByJoint[joint];
  }

  const adjustedRom = combinedValuesChart(Object.values(romByJoint));
  const adjustedDbe = combinedValuesChart(Object.values(dbeByJoint));

  // ── Rule 8: Global CVC Aggregation ───────────────────────────────────────
  const cvcInputs = [
    ampResult.rawPercent,
    adjustedRom,
    neuroResult.rawPercent,
    shortResult.rawPercent,
    adjustedDbe,
  ].filter((v) => v > 0);

  const finalPercent = Math.min(combinedValuesChart(cvcInputs), TOTAL_LOWER_LIMB_CAP);

  return {
    amputation: ampResult,
    rom: { ...romResult, rawPercent: adjustedRom },
    neurological: neuroResult,
    shortening: shortResult,
    dbe: { ...dbeResult, rawPercent: adjustedDbe },
    dbeRomConflicts: conflicts,
    cvcInputs,
    finalPercent,
  };
}

export function defaultLowerLimbValue(): LowerLimbValue {
  return {
    side: "right",
    amputations: {
      legLevel: "none",
      toes: { great: "none", second: "none", third: "none", fourth: "none", fifth: "none" },
    },
    rom: { joints: {} },
    neurological: { selectedNerves: [], romFromNerve: false },
    shortening: { discrepancyCm: 0 },
    dbe: { selectedConditions: [] },
  };
}
