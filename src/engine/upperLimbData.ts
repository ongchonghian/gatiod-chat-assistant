import { z } from "zod";
import { combineMultipleValuesChart as combinedValuesChart } from "./cvcCalculator.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type Side = "left" | "right";
export type FingerKey = "thumb" | "index" | "middle" | "ring" | "little";
export type LossType = "total" | "partial";
export type DeficitType = "sensory" | "motor" | "combined";
export type UpperDbeCategory =
  | "fracture_soft_tissue"
  | "instability"
  | "osteoarthritis"
  | "tenosynovitis";
export type UpperAnatomicalKey =
  | "shoulder"
  | "elbow"
  | "wrist"
  | "thumb_cmc"
  | "thumb_mp"
  | "thumb_ip"
  | "index_mcp"
  | "index_pip"
  | "index_dip"
  | "middle_mcp"
  | "middle_pip"
  | "middle_dip"
  | "ring_mcp"
  | "ring_pip"
  | "ring_dip"
  | "little_mcp"
  | "little_pip"
  | "little_dip";

// ─── Amputation ─────────────────────────────────────────────────────────────

export interface ArmAmputationLevel {
  id: string;
  label: string;
  percent: number;
  /** When selected, disables all structures distal to this level */
  disablesBelow: boolean;
}

export interface FingerAmputationLevel {
  id: string;
  label: string;
  percent: number;
}

export interface AmputationValue {
  armLevel: string; // 'none' | armLevel id
  fingers: Record<FingerKey, string>; // 'none' | phalanx level id
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
  /** Optional ankylosis-specific lookup (if omitted, restricted-motion table is reused). */
  ankylosisTable?: RomLookup[];
}

export interface RomJoint {
  key: string;
  label: string;
  directions: RomDirection[];
  /** If true, applies to specific finger (index/middle vs ring/little variants) */
  perFinger?: boolean;
  directionsRingLittle?: RomDirection[];
}

export interface RomJointValue {
  isAnkylosed: boolean;
  measurements: Record<string, number>; // directionKey → angle
}

export interface RomValue {
  joints: Record<string, RomJointValue>;
  /** Legacy storage from earlier UI; kept optional for backward compatibility. */
  fingerSelections?: Record<string, FingerKey>;
}

// ─── Neurological ───────────────────────────────────────────────────────────

export interface NerveEntry {
  key: string;
  label: string;
  group: "brachial_plexus" | "peripheral" | "digital" | "entrapment";
  sensoryMax?: number;
  motorMax?: number;
  combinedMax?: number;
  /** For digital nerves, which digit */
  digit?: FingerKey;
  side?: "radial" | "ulnar";
  /** Fixed percentage for entrapment conditions */
  fixedPercent?: number;
  severityLevels?: { id: string; label: string; percent: number }[];
}

export interface NerveSelection {
  nerveKey: string;
  deficitType: DeficitType;
  lossType: LossType;
  /** For entrapment: severity level id */
  severityId?: string;
}

export interface NeurologicalValue {
  selectedNerves: NerveSelection[];
  /** Flag: ROM restrictions are due to nerve lesion (prevents double counting) */
  romFromNerve: boolean;
}

// ─── DBE (Diagnosis-Based Estimates) ────────────────────────────────────────

export type DbeEntryType = "fixed" | "range";

export interface DbeCondition {
  id: string;
  label: string;
  category: UpperDbeCategory;
  anatomicalKeys: readonly [UpperAnatomicalKey, ...UpperAnatomicalKey[]];
  entryType: DbeEntryType;
  minPercent: number;
  maxPercent: number;
  description: string;
}

/**
 * Returns true if this condition has a single fixed value (no slider needed).
 */
export function isDbeFixed(cond: DbeCondition): boolean {
  if (cond.entryType !== undefined) return cond.entryType === "fixed";
  return cond.minPercent === cond.maxPercent;
}

export interface DbeSelection {
  conditionId: string;
  selectedAnatomicalKey?: UpperAnatomicalKey;
  selectedPercent: number;
}

export interface DbeValue {
  selectedConditions: DbeSelection[];
}

// ─── Top-Level State ────────────────────────────────────────────────────────

export interface UpperLimbValue {
  side: Side;
  amputations: AmputationValue;
  rom: RomValue;
  neurological: NeurologicalValue;
  dbe: DbeValue;
}

// ─── Result ─────────────────────────────────────────────────────────────────

export interface CategoryResult {
  label: string;
  rawPercent: number;
  notes: string[];
}

export interface UpperLimbResult {
  amputation: CategoryResult;
  rom: CategoryResult;
  neurological: CategoryResult;
  dbe: CategoryResult;
  /** Conflicts resolved between DBE and ROM */
  dbeRomConflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[];
  /** Individual category values fed into CVC */
  cvcInputs: number[];
  finalPercent: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zod Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UpperLimbValueSchema = z.object({
  side: z.enum(["left", "right"]),
  amputations: z.object({
    armLevel: z.string(),
    fingers: z.record(z.string()),
  }),
  rom: z.object({
    joints: z.record(z.object({
      isAnkylosed: z.boolean(),
      measurements: z.record(z.number()),
    })),
    fingerSelections: z.record(z.string()).optional(),
  }),
  neurological: z.object({
    selectedNerves: z.array(z.object({
      nerveKey: z.string(),
      deficitType: z.enum(["sensory", "motor", "combined"]),
      lossType: z.enum(["total", "partial"]),
      severityId: z.string().optional(),
    })),
    romFromNerve: z.boolean(),
  }),
  dbe: z.object({
    selectedConditions: z.array(z.object({
      conditionId: z.string(),
      selectedAnatomicalKey: z.string().optional(),
      selectedPercent: z.number(),
    })),
  }),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lookup Tables
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Helper
function t(...pairs: [number, number][]): RomLookup[] {
  return pairs.map(([angle, percent]) => ({ angle, percent }));
}

// ─── Amputation Levels ──────────────────────────────────────────────────────

export const ARM_AMPUTATION_LEVELS: ArmAmputationLevel[] = [
  { id: "above_elbow", label: "At or above elbow", percent: 75, disablesBelow: true },
  { id: "below_elbow", label: "Between wrist and elbow", percent: 70, disablesBelow: true },
  { id: "hand", label: "At wrist (loss of hand)", percent: 70, disablesBelow: true },
];

export const FINGER_AMPUTATION_LEVELS: Record<FingerKey, FingerAmputationLevel[]> = {
  thumb: [
    { id: "ip", label: "One phalanx", percent: 20 },
    { id: "mp", label: "Both phalanges", percent: 30 },
    { id: "cmc", label: "Both phalanges + 1st metacarpal", percent: 36 },
    { id: "mc_only", label: "1st metacarpal only", percent: 8 },
  ],
  index: [
    { id: "dip", label: "One phalanx", percent: 9 },
    { id: "pip", label: "Two phalanges", percent: 11 },
    { id: "mp", label: "Three phalanges", percent: 14 },
    { id: "mc", label: "Three phalanges + 2nd metacarpal", percent: 21 },
    { id: "mc_only", label: "2nd metacarpal only", percent: 8 },
  ],
  middle: [
    { id: "dip", label: "One phalanx", percent: 7 },
    { id: "pip", label: "Two phalanges", percent: 9 },
    { id: "mp", label: "Three phalanges", percent: 12 },
    { id: "mc", label: "Three phalanges + 3rd metacarpal", percent: 15 },
    { id: "mc_only", label: "3rd metacarpal only", percent: 3 },
  ],
  ring: [
    { id: "dip", label: "One phalanx", percent: 5 },
    { id: "pip", label: "Two phalanges", percent: 6 },
    { id: "mp", label: "Three phalanges", percent: 7 },
    { id: "mc", label: "Three phalanges + 4th metacarpal", percent: 10 },
    { id: "mc_only", label: "4th metacarpal only", percent: 3 },
  ],
  little: [
    { id: "dip", label: "One phalanx", percent: 5 },
    { id: "pip", label: "Two phalanges", percent: 6 },
    { id: "mp", label: "Three phalanges", percent: 7 },
    { id: "mc", label: "Three phalanges + 5th metacarpal", percent: 10 },
    { id: "mc_only", label: "5th metacarpal only", percent: 3 },
  ],
};

/**
 * GATIOD Hand Amputation Caps:
 * - 70% = loss of whole hand (at wrist) OR four fingers + thumb
 * - 60% = loss of four fingers only (without thumb)
 * Combined finger/metacarpal impairments must never exceed 70%.
 */
export const HAND_AMPUTATION_CAP = 70;
export const FOUR_FINGERS_ONLY_CAP = 60;
export const TOTAL_UPPER_LIMB_CAP = 75;

export const FINGER_LABELS: Record<FingerKey, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  little: "Little",
};

export const NON_THUMB_FINGERS: FingerKey[] = ["index", "middle", "ring", "little"];

/** Return the valid digit set for a ROM joint key. */
export function getRomJointFingers(jointKey: string): FingerKey[] {
  if (jointKey.startsWith("thumb_")) return ["thumb"];
  if (jointKey.startsWith("finger_")) return NON_THUMB_FINGERS;
  return [];
}

/** Canonical storage key for ROM entries. */
export function getRomJointStorageKey(jointKey: string, finger?: FingerKey): string {
  if (!finger) return jointKey;
  return `${jointKey}::${finger}`;
}

// ─── ROM Restriction Tables ─────────────────────────────────────────────────

export const ROM_JOINTS: RomJoint[] = [
  {
    key: "shoulder", label: "Shoulder",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 150,
        table: t([0, 13], [10, 12], [20, 11], [30, 10], [40, 9], [50, 7], [60, 6], [70, 6], [80, 5], [90, 5], [100, 4], [110, 4], [120, 3], [130, 2], [140, 1], [150, 0]),
        ankylosisTable: t([0, 27], [10, 24], [20, 21], [30, 18], [40, 18], [50, 18], [60, 25], [70, 27], [80, 29], [90, 32], [100, 34], [110, 36], [120, 38], [130, 41], [140, 43], [150, 45]),
      },
      {
        key: "extension",
        label: "Extension",
        normalRom: 40,
        table: t([0, 3], [10, 2], [20, 1], [30, 1], [40, 0]),
        ankylosisTable: t([0, 27], [10, 32], [20, 36], [30, 41], [40, 43], [50, 45]),
      },
      {
        key: "abduction",
        label: "Abduction",
        normalRom: 150,
        table: t([0, 13], [10, 12], [20, 11], [30, 10], [40, 9], [50, 9], [60, 8], [70, 7], [80, 6], [90, 5], [100, 4], [110, 4], [120, 3], [130, 2], [140, 1], [150, 0]),
        ankylosisTable: t([0, 27], [10, 25], [20, 18], [30, 18], [40, 18], [50, 18], [60, 22], [70, 25], [80, 27], [90, 30], [100, 32], [110, 35], [120, 38], [130, 40], [140, 43], [150, 45]),
      },
      {
        key: "adduction",
        label: "Adduction",
        normalRom: 40,
        table: t([0, 2], [10, 1], [20, 1], [30, 1], [40, 0]),
        ankylosisTable: t([0, 27], [10, 30], [20, 33], [30, 37], [40, 41], [50, 45]),
      },
      {
        key: "internal_rotation",
        label: "Internal Rotation",
        normalRom: 60,
        table: t([0, 5], [10, 4], [20, 3], [30, 3], [40, 2], [50, 1], [60, 0]),
        ankylosisTable: t([0, 27], [10, 25], [20, 22], [30, 18], [40, 18], [50, 18], [60, 25], [70, 35], [80, 40], [90, 45]),
      },
      {
        key: "external_rotation",
        label: "External Rotation",
        normalRom: 80,
        table: t([0, 5], [10, 5], [20, 4], [30, 4], [40, 3], [50, 2], [60, 2], [70, 1], [80, 0]),
        ankylosisTable: t([0, 27], [10, 29], [20, 32], [30, 34], [40, 36], [50, 38], [60, 40], [70, 42], [80, 44], [90, 45]),
      },
    ],
  },
  {
    key: "elbow", label: "Elbow",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 150,
        table: t([0, 30], [10, 28], [20, 26], [30, 24], [40, 22], [50, 20], [60, 18], [70, 16], [80, 14], [90, 12], [100, 10], [110, 8], [120, 6], [130, 4], [140, 2], [150, 0]),
        ankylosisTable: t([0, 36], [10, 35], [20, 34], [30, 34], [40, 32], [50, 32], [60, 31], [70, 29], [80, 27], [90, 31], [100, 32], [110, 33], [120, 39], [130, 43], [140, 48], [150, 53]),
      },
      {
        key: "flexion_contracture",
        label: "Flexion Contracture",
        normalRom: 140,
        table: t([0, 0], [10, 2], [20, 3], [30, 5], [40, 7], [50, 8], [60, 9], [70, 11], [80, 13], [90, 15], [100, 16], [110, 17], [120, 18], [130, 20], [140, 22]),
        // No separate elbow-ankylosis extension-contracture table in GATIOD.
        ankylosisTable: t([0, 0]),
      },
      {
        key: "pronation",
        label: "Pronation",
        normalRom: 80,
        table: t([0, 10], [10, 8], [20, 4], [30, 3], [40, 3], [50, 2], [60, 1], [70, 1], [80, 0]),
        ankylosisTable: t([0, 36], [10, 33], [20, 27], [30, 31], [40, 33], [50, 36], [60, 40], [70, 45], [80, 53]),
      },
      {
        key: "supination",
        label: "Supination",
        normalRom: 80,
        table: t([0, 6], [10, 5], [20, 5], [30, 4], [40, 3], [50, 2], [60, 2], [70, 1], [80, 0]),
        ankylosisTable: t([0, 36], [10, 39], [20, 42], [30, 44], [40, 46], [50, 48], [60, 50], [70, 51], [80, 53]),
      },
    ],
  },
  {
    key: "wrist", label: "Wrist",
    directions: [
      {
        key: "flexion",
        label: "Flexion (Palmar)",
        normalRom: 70,
        table: t([0, 8], [10, 7], [20, 6], [30, 5], [40, 4], [50, 3], [60, 1], [70, 0]),
        ankylosisTable: t([0, 13], [10, 13], [20, 21], [30, 25], [40, 29], [50, 34], [60, 42]),
      },
      {
        key: "extension",
        label: "Extension (Dorsal)",
        normalRom: 60,
        table: t([0, 8], [10, 7], [20, 5], [30, 4], [40, 3], [50, 2], [60, 0]),
        ankylosisTable: t([0, 13], [10, 13], [20, 14], [30, 19], [40, 21], [50, 32], [60, 42]),
      },
      {
        key: "radial_deviation",
        label: "Radial Deviation",
        normalRom: 20,
        table: t([0, 3], [10, 1], [20, 0]),
        ankylosisTable: t([0, 13], [10, 28], [20, 42]),
      },
      {
        key: "ulnar_deviation",
        label: "Ulnar Deviation",
        normalRom: 30,
        table: t([0, 4], [10, 3], [20, 1], [30, 0]),
        ankylosisTable: t([0, 13], [10, 13], [20, 32], [30, 42]),
      },
    ],
  },
  {
    key: "thumb_ip", label: "Thumb — IP",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 80,
        table: t([0, 6], [10, 5], [20, 5], [30, 4], [40, 3], [50, 2], [60, 1], [70, 1], [80, 0]),
        ankylosisTable: t([0, 6], [10, 5], [20, 5], [30, 6], [40, 6], [50, 7], [60, 7], [70, 9], [80, 10]),
      },
    ],
  },
  {
    key: "thumb_mp", label: "Thumb — MP",
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 60,
        table: t([0, 8], [10, 6], [20, 5], [30, 4], [40, 2], [50, 1], [60, 0]),
        ankylosisTable: t([0, 8], [10, 7], [20, 6], [30, 8], [40, 9], [50, 10], [60, 11]),
      },
    ],
  },
  {
    key: "thumb_cmc", label: "Thumb — CMC",
    directions: [
      {
        key: "opposition",
        label: "Flexion",
        normalRom: 15,
        table: t([0, 8], [10, 4], [15, 0]),
        ankylosisTable: t([0, 7], [10, 11], [15, 16]),
      },
      {
        key: "extension",
        label: "Extension",
        normalRom: 30,
        table: t([0, 8], [10, 6], [20, 2], [30, 0]),
        ankylosisTable: t([0, 7], [10, 11], [20, 13], [30, 16]),
      },
    ],
  },
  {
    key: "finger_dip", label: "Finger — DIP", perFinger: true,
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 70,
        table: t([0, 6], [10, 6], [20, 5], [30, 4], [40, 3], [50, 2], [60, 1], [70, 0]),
        ankylosisTable: t([0, 6], [10, 5], [20, 5], [30, 6], [40, 6], [50, 7], [60, 7], [70, 7]),
      },
    ],
    directionsRingLittle: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 70,
        table: t([0, 4], [10, 4], [20, 3], [30, 3], [40, 2], [50, 1], [60, 1], [70, 0]),
        ankylosisTable: t([0, 4], [10, 3], [20, 3], [30, 4], [40, 4], [50, 5], [60, 5], [70, 5]),
      },
    ],
  },
  {
    key: "finger_pip", label: "Finger — PIP", perFinger: true,
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 100,
        table: t([0, 8], [10, 7], [20, 6], [30, 5], [40, 5], [50, 4], [60, 4], [70, 3], [80, 2], [90, 1], [100, 0]),
        ankylosisTable: t([0, 8], [10, 8], [20, 7], [30, 7], [40, 6], [50, 7], [60, 8], [70, 8], [80, 9], [90, 9], [100, 9]),
      },
    ],
    directionsRingLittle: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 100,
        table: t([0, 6], [10, 5], [20, 4], [30, 3], [40, 3], [50, 3], [60, 3], [70, 2], [80, 1], [90, 1], [100, 0]),
        ankylosisTable: t([0, 6], [10, 6], [20, 5], [30, 5], [40, 4], [50, 5], [60, 6], [70, 6], [80, 6], [90, 6], [100, 6]),
      },
    ],
  },
  {
    key: "finger_mcp", label: "Finger — MCP", perFinger: true,
    directions: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 90,
        table: t([0, 8], [10, 7], [20, 6], [30, 5], [40, 4], [50, 4], [60, 3], [70, 2], [80, 1], [90, 0]),
        ankylosisTable: t([0, 8], [10, 8], [20, 7], [30, 6], [40, 7], [50, 8], [60, 9], [70, 10], [80, 11], [90, 12]),
      },
    ],
    directionsRingLittle: [
      {
        key: "flexion",
        label: "Flexion",
        normalRom: 90,
        table: t([0, 6], [10, 5], [20, 4], [30, 3], [40, 3], [50, 3], [60, 2], [70, 1], [80, 1], [90, 0]),
        ankylosisTable: t([0, 6], [10, 6], [20, 5], [30, 4], [40, 5], [50, 6], [60, 6], [70, 7], [80, 7], [90, 8]),
      },
    ],
  },
];

// ─── Neurological Data ──────────────────────────────────────────────────────

export const UPPER_LIMB_NERVES: NerveEntry[] = [
  // Brachial Plexus
  { key: "brachial_c5_t1", label: "Brachial Plexus (C5–T1)", group: "brachial_plexus", sensoryMax: 28, motorMax: 65, combinedMax: 75 },
  { key: "upper_trunk_c5_c6", label: "Upper Trunk (C5–C6)", group: "brachial_plexus", sensoryMax: 5, motorMax: 30, combinedMax: 34 },
  { key: "middle_trunk_c7", label: "Middle Trunk (C7)", group: "brachial_plexus", sensoryMax: 5, motorMax: 15, combinedMax: 19 },
  { key: "lower_trunk_c8_t1", label: "Lower Trunk (C8–T1)", group: "brachial_plexus", sensoryMax: 20, motorMax: 40, combinedMax: 52 },

  // Peripheral
  { key: "axillary", label: "Axillary", group: "peripheral", sensoryMax: 3, motorMax: 21, combinedMax: 23 },
  { key: "median_above", label: "Median (above mid-forearm)", group: "peripheral", sensoryMax: 23, motorMax: 26, combinedMax: 39 },
  { key: "median_anterior_interosseous", label: "Median (anterior interosseous)", group: "peripheral", motorMax: 9 },
  { key: "median_below", label: "Median (below mid-forearm)", group: "peripheral", sensoryMax: 23, motorMax: 6, combinedMax: 26 },
  { key: "musculocutaneous", label: "Musculocutaneous", group: "peripheral", sensoryMax: 3, motorMax: 20, combinedMax: 22 },
  { key: "radial_upper", label: "Radial (upper arm with loss of triceps)", group: "peripheral", sensoryMax: 3, motorMax: 25, combinedMax: 27 },
  { key: "radial_elbow", label: "Radial (elbow with sparing of triceps)", group: "peripheral", sensoryMax: 3, motorMax: 21, combinedMax: 23 },
  { key: "suprascapular", label: "Suprascapular", group: "peripheral", sensoryMax: 3, motorMax: 10, combinedMax: 12 },
  { key: "ulnar_above", label: "Ulnar (above mid-forearm)", group: "peripheral", sensoryMax: 4, motorMax: 28, combinedMax: 30 },
  { key: "ulnar_below", label: "Ulnar (below mid-forearm)", group: "peripheral", sensoryMax: 4, motorMax: 21, combinedMax: 24 },

  // Digital nerves
  { key: "thumb_radial", label: "Thumb — radial digital nerve", group: "digital", digit: "thumb", side: "radial", sensoryMax: 7 },
  { key: "thumb_ulnar", label: "Thumb — ulnar digital nerve", group: "digital", digit: "thumb", side: "ulnar", sensoryMax: 5 },
  { key: "index_radial", label: "Index — radial digital nerve", group: "digital", digit: "index", side: "radial", sensoryMax: 5 },
  { key: "index_ulnar", label: "Index — ulnar digital nerve", group: "digital", digit: "index", side: "ulnar", sensoryMax: 3 },
  { key: "middle_radial", label: "Middle — radial digital nerve", group: "digital", digit: "middle", side: "radial", sensoryMax: 3 },
  { key: "middle_ulnar", label: "Middle — ulnar digital nerve", group: "digital", digit: "middle", side: "ulnar", sensoryMax: 3 },
  { key: "ring_radial", label: "Ring — radial digital nerve", group: "digital", digit: "ring", side: "radial", sensoryMax: 2 },
  { key: "ring_ulnar", label: "Ring — ulnar digital nerve", group: "digital", digit: "ring", side: "ulnar", sensoryMax: 2 },
  { key: "little_radial", label: "Little — radial digital nerve", group: "digital", digit: "little", side: "radial", sensoryMax: 2 },
  { key: "little_ulnar", label: "Little — ulnar digital nerve", group: "digital", digit: "little", side: "ulnar", sensoryMax: 3 },

  // Entrapment
  {
    key: "carpal_tunnel", label: "Carpal Tunnel Syndrome", group: "entrapment",
    severityLevels: [
      { id: "mild", label: "Mild", percent: 2 },
      { id: "moderate", label: "Moderate", percent: 4 },
      { id: "severe", label: "Severe", percent: 8 },
    ],
  },
  {
    key: "cubital_tunnel", label: "Cubital Tunnel Syndrome", group: "entrapment",
    severityLevels: [
      { id: "mild", label: "Mild", percent: 2 },
      { id: "moderate", label: "Moderate", percent: 4 },
      { id: "severe", label: "Severe", percent: 8 },
    ],
  },
  {
    key: "radial_tunnel", label: "Radial Tunnel Syndrome", group: "entrapment",
    severityLevels: [
      { id: "mild", label: "Mild", percent: 2 },
      { id: "moderate", label: "Moderate", percent: 4 },
      { id: "severe", label: "Severe", percent: 8 },
    ],
  },
];

// ─── DBE Conditions ─────────────────────────────────────────────────────────

type LegacyUpperDbeJointClass = "shoulder" | "elbow" | "wrist" | "hand" | "finger" | "thumb";

interface LegacyUpperDbeCondition {
  id: string;
  label: string;
  joint: LegacyUpperDbeJointClass;
  minPercent: number;
  maxPercent: number;
  description: string;
}

const LEGACY_UPPER_DBE_CONDITIONS: LegacyUpperDbeCondition[] = [
  // A. Fractures with complications and deformities / soft tissue injuries
  { id: "fracture_scapula_undisplaced", label: "Scapular Fracture — Undisplaced", joint: "shoulder", minPercent: 1, maxPercent: 1, description: "Scapular fracture (undisplaced)." },
  { id: "fracture_scapula_displaced", label: "Scapular Fracture — Displaced", joint: "shoulder", minPercent: 3, maxPercent: 3, description: "Scapular fracture (displaced)." },
  { id: "fracture_clavicle_shortening_2cm", label: "Clavicle Fracture (2 cm Shortening)", joint: "shoulder", minPercent: 2, maxPercent: 2, description: "Clavicle fracture with shortening of 2 cm." },
  { id: "fracture_glenoid_undisplaced", label: "Glenoid Fracture — Undisplaced", joint: "shoulder", minPercent: 3, maxPercent: 3, description: "Glenoid fracture (undisplaced)." },
  { id: "fracture_glenoid_displaced", label: "Glenoid Fracture — Displaced", joint: "shoulder", minPercent: 6, maxPercent: 6, description: "Glenoid fracture (displaced)." },
  { id: "fracture_humeral_neck_head_malunion", label: "Humeral Neck/Head Fracture — Mal-union", joint: "shoulder", minPercent: 4, maxPercent: 4, description: "Humeral neck/head fracture with mal-union." },
  { id: "fracture_humeral_neck_head_nonunion", label: "Humeral Neck/Head Fracture — Non-union", joint: "shoulder", minPercent: 8, maxPercent: 8, description: "Humeral neck/head fracture with non-union." },
  { id: "fracture_humeral_neck_head_avascular_necrosis", label: "Humeral Neck/Head Fracture — Avascular Necrosis", joint: "shoulder", minPercent: 12, maxPercent: 12, description: "Humeral neck/head fracture with avascular necrosis." },
  { id: "fracture_humeral_shaft_angulation_mild", label: "Humeral Shaft Fracture — Mild Angulation", joint: "shoulder", minPercent: 3, maxPercent: 3, description: "Humeral shaft fracture healed with mild angulation." },
  { id: "fracture_humeral_shaft_angulation_moderate", label: "Humeral Shaft Fracture — Moderate Angulation", joint: "shoulder", minPercent: 6, maxPercent: 6, description: "Humeral shaft fracture healed with moderate angulation." },
  { id: "fracture_humeral_shaft_angulation_severe", label: "Humeral Shaft Fracture — Severe Angulation", joint: "shoulder", minPercent: 9, maxPercent: 9, description: "Humeral shaft fracture healed with severe angulation." },
  { id: "rotator_cuff_symptomatic", label: "Rotator Cuff Tear (Symptomatic)", joint: "shoulder", minPercent: 5, maxPercent: 5, description: "Symptomatic rotator cuff tear." },

  { id: "fracture_olecranon_undisplaced", label: "Olecranon Fracture — Undisplaced", joint: "elbow", minPercent: 3, maxPercent: 3, description: "Olecranon fracture (undisplaced)." },
  { id: "fracture_olecranon_malunion", label: "Olecranon Fracture — Mal-union", joint: "elbow", minPercent: 6, maxPercent: 6, description: "Olecranon fracture with mal-union." },
  { id: "fracture_olecranon_nonunion", label: "Olecranon Fracture — Non-union", joint: "elbow", minPercent: 9, maxPercent: 9, description: "Olecranon fracture with non-union." },
  { id: "fracture_supracondylar_intercondylar_undisplaced", label: "Supracondylar/Intercondylar Fracture — Undisplaced", joint: "elbow", minPercent: 3, maxPercent: 3, description: "Supracondylar or intercondylar fracture (undisplaced)." },
  { id: "fracture_supracondylar_intercondylar_angulation_mild", label: "Supracondylar/Intercondylar Fracture — Mild Angulation", joint: "elbow", minPercent: 4, maxPercent: 4, description: "Displaced supracondylar/intercondylar fracture with mild angulation." },
  { id: "fracture_supracondylar_intercondylar_angulation_moderate", label: "Supracondylar/Intercondylar Fracture — Moderate Angulation", joint: "elbow", minPercent: 8, maxPercent: 8, description: "Displaced supracondylar/intercondylar fracture with moderate angulation." },
  { id: "fracture_supracondylar_intercondylar_angulation_severe", label: "Supracondylar/Intercondylar Fracture — Severe Angulation", joint: "elbow", minPercent: 12, maxPercent: 12, description: "Displaced supracondylar/intercondylar fracture with severe angulation." },
  { id: "fracture_radial_ulnar_shaft_angulation_mild", label: "Radial/Ulnar Shaft Fracture — Mild Angulation", joint: "elbow", minPercent: 4, maxPercent: 4, description: "Radial or ulnar shaft fracture healed with mild angulation." },
  { id: "fracture_radial_ulnar_shaft_angulation_moderate", label: "Radial/Ulnar Shaft Fracture — Moderate Angulation", joint: "elbow", minPercent: 6, maxPercent: 6, description: "Radial or ulnar shaft fracture healed with moderate angulation." },
  { id: "fracture_radial_ulnar_shaft_angulation_severe", label: "Radial/Ulnar Shaft Fracture — Severe Angulation", joint: "elbow", minPercent: 9, maxPercent: 9, description: "Radial or ulnar shaft fracture healed with severe angulation." },

  { id: "fracture_distal_radius_articular_undisplaced", label: "Distal Radial (Articular) Fracture — Undisplaced", joint: "wrist", minPercent: 3, maxPercent: 3, description: "Distal radial articular fracture (undisplaced)." },
  { id: "fracture_distal_radius_articular_angulation_mild", label: "Distal Radial (Articular) Fracture — Mild Angulation", joint: "wrist", minPercent: 4, maxPercent: 4, description: "Distal radial articular fracture displaced with mild angulation." },
  { id: "fracture_distal_radius_articular_angulation_moderate", label: "Distal Radial (Articular) Fracture — Moderate Angulation", joint: "wrist", minPercent: 8, maxPercent: 8, description: "Distal radial articular fracture displaced with moderate angulation." },
  { id: "fracture_distal_radius_articular_angulation_severe", label: "Distal Radial (Articular) Fracture — Severe Angulation", joint: "wrist", minPercent: 12, maxPercent: 12, description: "Distal radial articular fracture displaced with severe angulation." },
  { id: "fracture_scaphoid_lunate_undisplaced", label: "Scaphoid/Lunate Fracture — Undisplaced", joint: "wrist", minPercent: 3, maxPercent: 3, description: "Scaphoid or lunate fracture (undisplaced)." },
  { id: "fracture_scaphoid_lunate_nonunion", label: "Scaphoid/Lunate Fracture — Non-union", joint: "wrist", minPercent: 9, maxPercent: 9, description: "Scaphoid or lunate fracture with non-union." },
  { id: "fracture_scaphoid_lunate_avascular_necrosis", label: "Scaphoid/Lunate Fracture — Avascular Necrosis", joint: "wrist", minPercent: 15, maxPercent: 15, description: "Scaphoid or lunate fracture with avascular necrosis." },
  { id: "fracture_other_carpal_undisplaced", label: "Other Carpal Bone Fracture — Undisplaced", joint: "wrist", minPercent: 2, maxPercent: 2, description: "Other carpal bone fracture (undisplaced)." },
  { id: "fracture_other_carpal_displaced", label: "Other Carpal Bone Fracture — Displaced", joint: "wrist", minPercent: 4, maxPercent: 4, description: "Other carpal bone fracture (displaced)." },
  { id: "fracture_metacarpal_1st_angulation", label: "Metacarpal/Phalangeal Fracture — 1st Metacarpal", joint: "hand", minPercent: 6, maxPercent: 6, description: "Healed with angulation: 1st metacarpal." },
  { id: "fracture_metacarpal_2nd_angulation", label: "Metacarpal/Phalangeal Fracture — 2nd Metacarpal", joint: "hand", minPercent: 4, maxPercent: 4, description: "Healed with angulation: 2nd metacarpal." },
  { id: "fracture_metacarpal_3rd_angulation", label: "Metacarpal/Phalangeal Fracture — 3rd Metacarpal", joint: "hand", minPercent: 4, maxPercent: 4, description: "Healed with angulation: 3rd metacarpal." },
  { id: "fracture_metacarpal_4th_angulation", label: "Metacarpal/Phalangeal Fracture — 4th Metacarpal", joint: "hand", minPercent: 2, maxPercent: 2, description: "Healed with angulation: 4th metacarpal." },
  { id: "fracture_metacarpal_5th_angulation", label: "Metacarpal/Phalangeal Fracture — 5th Metacarpal", joint: "hand", minPercent: 2, maxPercent: 2, description: "Healed with angulation: 5th metacarpal." },

  // B. Joint instability (post-traumatic)
  { id: "instability_shoulder_glenohumeral_subluxation_persistent", label: "Shoulder Gleno-humeral Instability — Persistent Subluxation", joint: "shoulder", minPercent: 4, maxPercent: 4, description: "Persistent subluxation." },
  { id: "instability_shoulder_glenohumeral_dislocation_recurrent", label: "Shoulder Gleno-humeral Instability — Recurrent Dislocation", joint: "shoulder", minPercent: 10, maxPercent: 10, description: "Recurrent dislocation." },
  { id: "instability_shoulder_glenohumeral_dislocation_persistent", label: "Shoulder Gleno-humeral Instability — Persistent Dislocation (Untreated)", joint: "shoulder", minPercent: 16, maxPercent: 16, description: "Persistent untreated dislocation." },
  { id: "instability_shoulder_acromioclavicular_subluxation_persistent", label: "Shoulder Acromio-clavicular Instability — Persistent Subluxation", joint: "shoulder", minPercent: 2, maxPercent: 2, description: "Persistent subluxation." },
  { id: "instability_shoulder_acromioclavicular_dislocation_persistent", label: "Shoulder Acromio-clavicular Instability — Persistent Dislocation (Untreated)", joint: "shoulder", minPercent: 6, maxPercent: 6, description: "Persistent untreated dislocation." },
  { id: "instability_shoulder_sternoclavicular_subluxation_persistent", label: "Shoulder Sterno-clavicular Instability — Persistent Subluxation", joint: "shoulder", minPercent: 2, maxPercent: 2, description: "Persistent subluxation." },
  { id: "instability_shoulder_sternoclavicular_dislocation_persistent", label: "Shoulder Sterno-clavicular Instability — Persistent Dislocation (Untreated)", joint: "shoulder", minPercent: 6, maxPercent: 6, description: "Persistent untreated dislocation." },
  { id: "instability_elbow_ulnohumeral_subluxation_persistent", label: "Elbow Instability — Persistent Subluxation", joint: "elbow", minPercent: 4, maxPercent: 4, description: "Persistent ulnohumeral subluxation." },
  { id: "instability_elbow_ulnohumeral_dislocation_recurrent", label: "Elbow Instability — Recurrent Dislocation", joint: "elbow", minPercent: 10, maxPercent: 10, description: "Recurrent ulnohumeral dislocation." },
  { id: "instability_elbow_ulnohumeral_dislocation_persistent", label: "Elbow Instability — Persistent Dislocation (Untreated)", joint: "elbow", minPercent: 16, maxPercent: 16, description: "Persistent untreated ulnohumeral dislocation." },
  { id: "instability_wrist_radiocarpal_subluxation_persistent", label: "Wrist Radiocarpal Instability — Persistent Subluxation", joint: "wrist", minPercent: 4, maxPercent: 4, description: "Persistent subluxation." },
  { id: "instability_wrist_radiocarpal_dislocation_persistent", label: "Wrist Radiocarpal Instability — Persistent Dislocation (Untreated)", joint: "wrist", minPercent: 12, maxPercent: 12, description: "Persistent untreated dislocation." },
  { id: "instability_wrist_distal_carpal_row_subluxation_persistent", label: "Wrist Distal Carpal Row Instability — Persistent Subluxation", joint: "wrist", minPercent: 2, maxPercent: 2, description: "Persistent subluxation." },
  { id: "instability_wrist_distal_carpal_row_dislocation_persistent", label: "Wrist Distal Carpal Row Instability — Persistent Dislocation (Untreated)", joint: "wrist", minPercent: 6, maxPercent: 6, description: "Persistent untreated dislocation." },
  { id: "instability_thumb_cmc_subluxation_persistent", label: "Thumb CMC Instability — Persistent Subluxation", joint: "thumb", minPercent: 4, maxPercent: 4, description: "Persistent subluxation." },
  { id: "instability_thumb_cmc_dislocation_persistent", label: "Thumb CMC Instability — Persistent Dislocation (Untreated)", joint: "thumb", minPercent: 8, maxPercent: 8, description: "Persistent untreated dislocation." },
  { id: "instability_thumb_mcp_subluxation_persistent", label: "Thumb MCP Instability — Persistent Subluxation", joint: "thumb", minPercent: 1, maxPercent: 1, description: "Persistent subluxation." },
  { id: "instability_thumb_mcp_dislocation_persistent", label: "Thumb MCP Instability — Persistent Dislocation (Untreated)", joint: "thumb", minPercent: 6, maxPercent: 6, description: "Persistent untreated dislocation." },
  { id: "instability_thumb_ip_subluxation_persistent", label: "Thumb IP Instability — Persistent Subluxation", joint: "thumb", minPercent: 1, maxPercent: 1, description: "Persistent subluxation." },
  { id: "instability_thumb_ip_dislocation_persistent", label: "Thumb IP Instability — Persistent Dislocation (Untreated)", joint: "thumb", minPercent: 4, maxPercent: 4, description: "Persistent untreated dislocation." },
  { id: "instability_index_middle_mcp_subluxation_persistent", label: "Index/Middle MCP Instability — Persistent Subluxation", joint: "finger", minPercent: 2, maxPercent: 2, description: "Persistent subluxation." },
  { id: "instability_index_middle_mcp_dislocation_persistent", label: "Index/Middle MCP Instability — Persistent Dislocation (Untreated)", joint: "finger", minPercent: 6, maxPercent: 6, description: "Persistent untreated dislocation." },
  { id: "instability_index_middle_pip_subluxation_persistent", label: "Index/Middle PIP Instability — Persistent Subluxation", joint: "finger", minPercent: 2, maxPercent: 2, description: "Persistent subluxation." },
  { id: "instability_index_middle_pip_dislocation_persistent", label: "Index/Middle PIP Instability — Persistent Dislocation (Untreated)", joint: "finger", minPercent: 4, maxPercent: 4, description: "Persistent untreated dislocation." },
  { id: "instability_index_middle_dip_subluxation_persistent", label: "Index/Middle DIP Instability — Persistent Subluxation", joint: "finger", minPercent: 1, maxPercent: 1, description: "Persistent subluxation." },
  { id: "instability_index_middle_dip_dislocation_persistent", label: "Index/Middle DIP Instability — Persistent Dislocation (Untreated)", joint: "finger", minPercent: 2, maxPercent: 2, description: "Persistent untreated dislocation." },
  { id: "instability_ring_little_mcp_subluxation_persistent", label: "Ring/Little MCP Instability — Persistent Subluxation", joint: "finger", minPercent: 1, maxPercent: 1, description: "Persistent subluxation." },
  { id: "instability_ring_little_mcp_dislocation_persistent", label: "Ring/Little MCP Instability — Persistent Dislocation (Untreated)", joint: "finger", minPercent: 4, maxPercent: 4, description: "Persistent untreated dislocation." },
  { id: "instability_ring_little_pip_subluxation_persistent", label: "Ring/Little PIP Instability — Persistent Subluxation", joint: "finger", minPercent: 1, maxPercent: 1, description: "Persistent subluxation." },
  { id: "instability_ring_little_pip_dislocation_persistent", label: "Ring/Little PIP Instability — Persistent Dislocation (Untreated)", joint: "finger", minPercent: 3, maxPercent: 3, description: "Persistent untreated dislocation." },
  { id: "instability_ring_little_dip_subluxation_persistent", label: "Ring/Little DIP Instability — Persistent Subluxation", joint: "finger", minPercent: 0, maxPercent: 0, description: "Persistent subluxation." },
  { id: "instability_ring_little_dip_dislocation_persistent", label: "Ring/Little DIP Instability — Persistent Dislocation (Untreated)", joint: "finger", minPercent: 2, maxPercent: 2, description: "Persistent untreated dislocation." },

  // C. Osteoarthritis (post-traumatic)
  { id: "oa_shoulder_glenohumeral_mild", label: "Osteoarthritis Shoulder Gleno-humeral — Mild", joint: "shoulder", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, mild." },
  { id: "oa_shoulder_glenohumeral_moderate", label: "Osteoarthritis Shoulder Gleno-humeral — Moderate", joint: "shoulder", minPercent: 8, maxPercent: 8, description: "Post-traumatic OA, moderate." },
  { id: "oa_shoulder_glenohumeral_severe", label: "Osteoarthritis Shoulder Gleno-humeral — Severe", joint: "shoulder", minPercent: 18, maxPercent: 18, description: "Post-traumatic OA, severe." },
  { id: "oa_shoulder_acromioclavicular_mild", label: "Osteoarthritis Shoulder Acromio-clavicular — Mild", joint: "shoulder", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, mild." },
  { id: "oa_shoulder_acromioclavicular_moderate", label: "Osteoarthritis Shoulder Acromio-clavicular — Moderate", joint: "shoulder", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, moderate." },
  { id: "oa_shoulder_acromioclavicular_severe", label: "Osteoarthritis Shoulder Acromio-clavicular — Severe", joint: "shoulder", minPercent: 6, maxPercent: 6, description: "Post-traumatic OA, severe." },
  { id: "oa_shoulder_sternoclavicular_mild", label: "Osteoarthritis Shoulder Sterno-clavicular — Mild", joint: "shoulder", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, mild." },
  { id: "oa_shoulder_sternoclavicular_moderate", label: "Osteoarthritis Shoulder Sterno-clavicular — Moderate", joint: "shoulder", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, moderate." },
  { id: "oa_shoulder_sternoclavicular_severe", label: "Osteoarthritis Shoulder Sterno-clavicular — Severe", joint: "shoulder", minPercent: 6, maxPercent: 6, description: "Post-traumatic OA, severe." },
  { id: "oa_elbow_ulnohumeral_mild", label: "Osteoarthritis Elbow Ulnohumeral — Mild", joint: "elbow", minPercent: 3, maxPercent: 3, description: "Post-traumatic OA, mild." },
  { id: "oa_elbow_ulnohumeral_moderate", label: "Osteoarthritis Elbow Ulnohumeral — Moderate", joint: "elbow", minPercent: 8, maxPercent: 8, description: "Post-traumatic OA, moderate." },
  { id: "oa_elbow_ulnohumeral_severe", label: "Osteoarthritis Elbow Ulnohumeral — Severe", joint: "elbow", minPercent: 16, maxPercent: 16, description: "Post-traumatic OA, severe." },
  { id: "oa_radio_ulnar_joint_mild", label: "Osteoarthritis Proximal/Distal Radio-Ulnar Joint — Mild", joint: "elbow", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, mild." },
  { id: "oa_radio_ulnar_joint_moderate", label: "Osteoarthritis Proximal/Distal Radio-Ulnar Joint — Moderate", joint: "elbow", minPercent: 8, maxPercent: 8, description: "Post-traumatic OA, moderate." },
  { id: "oa_radio_ulnar_joint_severe", label: "Osteoarthritis Proximal/Distal Radio-Ulnar Joint — Severe", joint: "elbow", minPercent: 16, maxPercent: 16, description: "Post-traumatic OA, severe." },
  { id: "oa_wrist_radiocarpal_mild", label: "Osteoarthritis Wrist Radiocarpal — Mild", joint: "wrist", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, mild." },
  { id: "oa_wrist_radiocarpal_moderate", label: "Osteoarthritis Wrist Radiocarpal — Moderate", joint: "wrist", minPercent: 8, maxPercent: 8, description: "Post-traumatic OA, moderate." },
  { id: "oa_wrist_radiocarpal_severe", label: "Osteoarthritis Wrist Radiocarpal — Severe", joint: "wrist", minPercent: 16, maxPercent: 16, description: "Post-traumatic OA, severe." },
  { id: "oa_wrist_distal_carpal_row_mild", label: "Osteoarthritis Wrist Distal Carpal Row — Mild", joint: "wrist", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, mild." },
  { id: "oa_wrist_distal_carpal_row_moderate", label: "Osteoarthritis Wrist Distal Carpal Row — Moderate", joint: "wrist", minPercent: 6, maxPercent: 6, description: "Post-traumatic OA, moderate." },
  { id: "oa_wrist_distal_carpal_row_severe", label: "Osteoarthritis Wrist Distal Carpal Row — Severe", joint: "wrist", minPercent: 8, maxPercent: 8, description: "Post-traumatic OA, severe." },
  { id: "oa_thumb_cmc_mild", label: "Osteoarthritis Thumb CMC — Mild", joint: "thumb", minPercent: 3, maxPercent: 3, description: "Post-traumatic OA, mild." },
  { id: "oa_thumb_cmc_moderate", label: "Osteoarthritis Thumb CMC — Moderate", joint: "thumb", minPercent: 6, maxPercent: 6, description: "Post-traumatic OA, moderate." },
  { id: "oa_thumb_cmc_severe", label: "Osteoarthritis Thumb CMC — Severe", joint: "thumb", minPercent: 10, maxPercent: 10, description: "Post-traumatic OA, severe." },
  { id: "oa_thumb_mcp_mild", label: "Osteoarthritis Thumb MCP — Mild", joint: "thumb", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, mild." },
  { id: "oa_thumb_mcp_moderate", label: "Osteoarthritis Thumb MCP — Moderate", joint: "thumb", minPercent: 3, maxPercent: 3, description: "Post-traumatic OA, moderate." },
  { id: "oa_thumb_mcp_severe", label: "Osteoarthritis Thumb MCP — Severe", joint: "thumb", minPercent: 6, maxPercent: 6, description: "Post-traumatic OA, severe." },
  { id: "oa_thumb_ip_mild", label: "Osteoarthritis Thumb IP — Mild", joint: "thumb", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, mild." },
  { id: "oa_thumb_ip_moderate", label: "Osteoarthritis Thumb IP — Moderate", joint: "thumb", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, moderate." },
  { id: "oa_thumb_ip_severe", label: "Osteoarthritis Thumb IP — Severe", joint: "thumb", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, severe." },
  { id: "oa_index_middle_mcp_mild", label: "Osteoarthritis Index/Middle MCP — Mild", joint: "finger", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, mild." },
  { id: "oa_index_middle_mcp_moderate", label: "Osteoarthritis Index/Middle MCP — Moderate", joint: "finger", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, moderate." },
  { id: "oa_index_middle_mcp_severe", label: "Osteoarthritis Index/Middle MCP — Severe", joint: "finger", minPercent: 6, maxPercent: 6, description: "Post-traumatic OA, severe." },
  { id: "oa_index_middle_pip_mild", label: "Osteoarthritis Index/Middle PIP — Mild", joint: "finger", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, mild." },
  { id: "oa_index_middle_pip_moderate", label: "Osteoarthritis Index/Middle PIP — Moderate", joint: "finger", minPercent: 3, maxPercent: 3, description: "Post-traumatic OA, moderate." },
  { id: "oa_index_middle_pip_severe", label: "Osteoarthritis Index/Middle PIP — Severe", joint: "finger", minPercent: 5, maxPercent: 5, description: "Post-traumatic OA, severe." },
  { id: "oa_index_middle_dip_mild", label: "Osteoarthritis Index/Middle DIP — Mild", joint: "finger", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, mild." },
  { id: "oa_index_middle_dip_moderate", label: "Osteoarthritis Index/Middle DIP — Moderate", joint: "finger", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, moderate." },
  { id: "oa_index_middle_dip_severe", label: "Osteoarthritis Index/Middle DIP — Severe", joint: "finger", minPercent: 3, maxPercent: 3, description: "Post-traumatic OA, severe." },
  { id: "oa_ring_little_mcp_mild", label: "Osteoarthritis Ring/Little MCP — Mild", joint: "finger", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, mild." },
  { id: "oa_ring_little_mcp_moderate", label: "Osteoarthritis Ring/Little MCP — Moderate", joint: "finger", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, moderate." },
  { id: "oa_ring_little_mcp_severe", label: "Osteoarthritis Ring/Little MCP — Severe", joint: "finger", minPercent: 4, maxPercent: 4, description: "Post-traumatic OA, severe." },
  { id: "oa_ring_little_pip_mild", label: "Osteoarthritis Ring/Little PIP — Mild", joint: "finger", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, mild." },
  { id: "oa_ring_little_pip_moderate", label: "Osteoarthritis Ring/Little PIP — Moderate", joint: "finger", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, moderate." },
  { id: "oa_ring_little_pip_severe", label: "Osteoarthritis Ring/Little PIP — Severe", joint: "finger", minPercent: 3, maxPercent: 3, description: "Post-traumatic OA, severe." },
  { id: "oa_ring_little_dip_mild", label: "Osteoarthritis Ring/Little DIP — Mild", joint: "finger", minPercent: 0, maxPercent: 0, description: "Post-traumatic OA, mild." },
  { id: "oa_ring_little_dip_moderate", label: "Osteoarthritis Ring/Little DIP — Moderate", joint: "finger", minPercent: 1, maxPercent: 1, description: "Post-traumatic OA, moderate." },
  { id: "oa_ring_little_dip_severe", label: "Osteoarthritis Ring/Little DIP — Severe", joint: "finger", minPercent: 2, maxPercent: 2, description: "Post-traumatic OA, severe." },

  // D. Constrictive tenosynovitis
  { id: "tenosynovitis_constrictive_mild", label: "Constrictive Tenosynovitis — Mild", joint: "finger", minPercent: 1, maxPercent: 1, description: "Residual mild incapacity after treatment (e.g. trigger finger / De Quervain's)." },
  { id: "tenosynovitis_constrictive_moderate", label: "Constrictive Tenosynovitis — Moderate", joint: "finger", minPercent: 2, maxPercent: 2, description: "Residual moderate incapacity after treatment (e.g. trigger finger / De Quervain's)." },
  { id: "tenosynovitis_constrictive_severe", label: "Constrictive Tenosynovitis — Severe", joint: "finger", minPercent: 5, maxPercent: 5, description: "Residual severe incapacity after treatment (e.g. trigger finger / De Quervain's)." },
  // Canonical short-form aliases (preferred IDs per acceptance criteria)
  { id: "tenosynovitis_mild", label: "Constrictive Tenosynovitis — Mild", joint: "finger", minPercent: 1, maxPercent: 1, description: "Residual mild incapacity after treatment (e.g. trigger finger / De Quervain's)." },
  { id: "tenosynovitis_moderate", label: "Constrictive Tenosynovitis — Moderate", joint: "finger", minPercent: 2, maxPercent: 2, description: "Residual moderate incapacity after treatment (e.g. trigger finger / De Quervain's)." },
  { id: "tenosynovitis_severe", label: "Constrictive Tenosynovitis — Severe", joint: "finger", minPercent: 5, maxPercent: 5, description: "Residual severe incapacity after treatment (e.g. trigger finger / De Quervain's)." },
];

export const UPPER_ANATOMICAL_LABELS: Record<UpperAnatomicalKey, string> = {
  shoulder: "Shoulder",
  elbow: "Elbow",
  wrist: "Wrist",
  thumb_cmc: "Thumb CMC",
  thumb_mp: "Thumb MCP",
  thumb_ip: "Thumb IP",
  index_mcp: "Index MCP",
  index_pip: "Index PIP",
  index_dip: "Index DIP",
  middle_mcp: "Middle MCP",
  middle_pip: "Middle PIP",
  middle_dip: "Middle DIP",
  ring_mcp: "Ring MCP",
  ring_pip: "Ring PIP",
  ring_dip: "Ring DIP",
  little_mcp: "Little MCP",
  little_pip: "Little PIP",
  little_dip: "Little DIP",
};

const DEFAULT_UPPER_ANATOMICAL_KEYS_BY_JOINT: Record<
  LegacyUpperDbeJointClass,
  readonly [UpperAnatomicalKey, ...UpperAnatomicalKey[]]
> = {
  shoulder: ["shoulder"],
  elbow: ["elbow"],
  wrist: ["wrist"],
  hand: ["wrist"],
  finger: ["index_mcp", "middle_mcp", "ring_mcp", "little_mcp"],
  thumb: ["thumb_cmc"],
};

const UPPER_DBE_ANATOMICAL_OVERRIDES: Record<
  string,
  readonly [UpperAnatomicalKey, ...UpperAnatomicalKey[]]
> = {
  fracture_metacarpal_1st_angulation: ["wrist"],
  fracture_metacarpal_2nd_angulation: ["wrist"],
  fracture_metacarpal_3rd_angulation: ["wrist"],
  fracture_metacarpal_4th_angulation: ["wrist"],
  fracture_metacarpal_5th_angulation: ["wrist"],
  instability_thumb_cmc_subluxation_persistent: ["thumb_cmc"],
  instability_thumb_cmc_dislocation_persistent: ["thumb_cmc"],
  instability_thumb_mcp_subluxation_persistent: ["thumb_mp"],
  instability_thumb_mcp_dislocation_persistent: ["thumb_mp"],
  instability_thumb_ip_subluxation_persistent: ["thumb_ip"],
  instability_thumb_ip_dislocation_persistent: ["thumb_ip"],
  instability_index_middle_mcp_subluxation_persistent: ["index_mcp", "middle_mcp"],
  instability_index_middle_mcp_dislocation_persistent: ["index_mcp", "middle_mcp"],
  instability_index_middle_pip_subluxation_persistent: ["index_pip", "middle_pip"],
  instability_index_middle_pip_dislocation_persistent: ["index_pip", "middle_pip"],
  instability_index_middle_dip_subluxation_persistent: ["index_dip", "middle_dip"],
  instability_index_middle_dip_dislocation_persistent: ["index_dip", "middle_dip"],
  instability_ring_little_mcp_subluxation_persistent: ["ring_mcp", "little_mcp"],
  instability_ring_little_mcp_dislocation_persistent: ["ring_mcp", "little_mcp"],
  instability_ring_little_pip_subluxation_persistent: ["ring_pip", "little_pip"],
  instability_ring_little_pip_dislocation_persistent: ["ring_pip", "little_pip"],
  instability_ring_little_dip_subluxation_persistent: ["ring_dip", "little_dip"],
  instability_ring_little_dip_dislocation_persistent: ["ring_dip", "little_dip"],
  oa_thumb_cmc_mild: ["thumb_cmc"],
  oa_thumb_cmc_moderate: ["thumb_cmc"],
  oa_thumb_cmc_severe: ["thumb_cmc"],
  oa_thumb_mcp_mild: ["thumb_mp"],
  oa_thumb_mcp_moderate: ["thumb_mp"],
  oa_thumb_mcp_severe: ["thumb_mp"],
  oa_thumb_ip_mild: ["thumb_ip"],
  oa_thumb_ip_moderate: ["thumb_ip"],
  oa_thumb_ip_severe: ["thumb_ip"],
  oa_index_middle_mcp_mild: ["index_mcp", "middle_mcp"],
  oa_index_middle_mcp_moderate: ["index_mcp", "middle_mcp"],
  oa_index_middle_mcp_severe: ["index_mcp", "middle_mcp"],
  oa_index_middle_pip_mild: ["index_pip", "middle_pip"],
  oa_index_middle_pip_moderate: ["index_pip", "middle_pip"],
  oa_index_middle_pip_severe: ["index_pip", "middle_pip"],
  oa_index_middle_dip_mild: ["index_dip", "middle_dip"],
  oa_index_middle_dip_moderate: ["index_dip", "middle_dip"],
  oa_index_middle_dip_severe: ["index_dip", "middle_dip"],
  oa_ring_little_mcp_mild: ["ring_mcp", "little_mcp"],
  oa_ring_little_mcp_moderate: ["ring_mcp", "little_mcp"],
  oa_ring_little_mcp_severe: ["ring_mcp", "little_mcp"],
  oa_ring_little_pip_mild: ["ring_pip", "little_pip"],
  oa_ring_little_pip_moderate: ["ring_pip", "little_pip"],
  oa_ring_little_pip_severe: ["ring_pip", "little_pip"],
  oa_ring_little_dip_mild: ["ring_dip", "little_dip"],
  oa_ring_little_dip_moderate: ["ring_dip", "little_dip"],
  oa_ring_little_dip_severe: ["ring_dip", "little_dip"],
  tenosynovitis_constrictive_mild: [
    "thumb_cmc",
    "thumb_mp",
    "thumb_ip",
    "index_mcp",
    "middle_mcp",
    "ring_mcp",
    "little_mcp",
  ],
  tenosynovitis_constrictive_moderate: [
    "thumb_cmc",
    "thumb_mp",
    "thumb_ip",
    "index_mcp",
    "middle_mcp",
    "ring_mcp",
    "little_mcp",
  ],
  tenosynovitis_constrictive_severe: [
    "thumb_cmc",
    "thumb_mp",
    "thumb_ip",
    "index_mcp",
    "middle_mcp",
    "ring_mcp",
    "little_mcp",
  ],
  tenosynovitis_mild: [
    "thumb_cmc",
    "thumb_mp",
    "thumb_ip",
    "index_mcp",
    "middle_mcp",
    "ring_mcp",
    "little_mcp",
  ],
  tenosynovitis_moderate: [
    "thumb_cmc",
    "thumb_mp",
    "thumb_ip",
    "index_mcp",
    "middle_mcp",
    "ring_mcp",
    "little_mcp",
  ],
  tenosynovitis_severe: [
    "thumb_cmc",
    "thumb_mp",
    "thumb_ip",
    "index_mcp",
    "middle_mcp",
    "ring_mcp",
    "little_mcp",
  ],
};

function inferUpperDbeCategory(id: string): UpperDbeCategory {
  if (id.startsWith("fracture_") || id.startsWith("rotator_cuff_")) return "fracture_soft_tissue";
  if (id.startsWith("instability_")) return "instability";
  if (id.startsWith("oa_")) return "osteoarthritis";
  if (id.startsWith("tenosynovitis_")) return "tenosynovitis";
  return "fracture_soft_tissue";
}

function inferUpperDbeAnatomicalKeys(
  entry: LegacyUpperDbeCondition
): readonly [UpperAnatomicalKey, ...UpperAnatomicalKey[]] {
  const override = UPPER_DBE_ANATOMICAL_OVERRIDES[entry.id];
  if (override) return override;
  const mapped = DEFAULT_UPPER_ANATOMICAL_KEYS_BY_JOINT[entry.joint];
  if (mapped) return mapped;
  throw new Error(`Upper DBE condition "${entry.id}" is missing anatomical key mapping.`);
}

export const DBE_CONDITIONS: DbeCondition[] = LEGACY_UPPER_DBE_CONDITIONS.map((entry) => {
  const anatomicalKeys = inferUpperDbeAnatomicalKeys(entry);
  return {
    id: entry.id,
    label: entry.label,
    category: inferUpperDbeCategory(entry.id),
    anatomicalKeys,
    entryType: entry.minPercent === entry.maxPercent ? "fixed" : "range",
    minPercent: entry.minPercent,
    maxPercent: entry.maxPercent,
    description: entry.description,
  };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure Calculation Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Amputation Suppression Logic ───────────────────────────────────────────

/**
 * Determine which anatomical structures are suppressed by the current amputation state.
 * Suppression must stay distal to the amputation level.
 */
const UPPER_HAND_ANATOMICAL_KEYS: readonly UpperAnatomicalKey[] = [
  "thumb_cmc",
  "thumb_mp",
  "thumb_ip",
  "index_mcp",
  "index_pip",
  "index_dip",
  "middle_mcp",
  "middle_pip",
  "middle_dip",
  "ring_mcp",
  "ring_pip",
  "ring_dip",
  "little_mcp",
  "little_pip",
  "little_dip",
];

const UPPER_FINGER_LEVEL_SUPPRESSION: Record<FingerKey, Record<string, readonly UpperAnatomicalKey[]>> = {
  thumb: {
    ip: ["thumb_ip"],
    mp: ["thumb_ip", "thumb_mp"],
    cmc: ["thumb_ip", "thumb_mp", "thumb_cmc"],
    mc_only: ["thumb_cmc"],
  },
  index: {
    dip: ["index_dip"],
    pip: ["index_dip", "index_pip"],
    mp: ["index_dip", "index_pip", "index_mcp"],
    mc: ["index_dip", "index_pip", "index_mcp"],
    mc_only: ["index_mcp"],
  },
  middle: {
    dip: ["middle_dip"],
    pip: ["middle_dip", "middle_pip"],
    mp: ["middle_dip", "middle_pip", "middle_mcp"],
    mc: ["middle_dip", "middle_pip", "middle_mcp"],
    mc_only: ["middle_mcp"],
  },
  ring: {
    dip: ["ring_dip"],
    pip: ["ring_dip", "ring_pip"],
    mp: ["ring_dip", "ring_pip", "ring_mcp"],
    mc: ["ring_dip", "ring_pip", "ring_mcp"],
    mc_only: ["ring_mcp"],
  },
  little: {
    dip: ["little_dip"],
    pip: ["little_dip", "little_pip"],
    mp: ["little_dip", "little_pip", "little_mcp"],
    mc: ["little_dip", "little_pip", "little_mcp"],
    mc_only: ["little_mcp"],
  },
};

function getRomJointAnatomicalKey(
  jointKey: string,
  fingerSelection?: FingerKey
): UpperAnatomicalKey | null {
  if (jointKey === "shoulder" || jointKey === "elbow" || jointKey === "wrist") {
    return jointKey;
  }
  if (jointKey === "thumb_cmc" || jointKey === "thumb_mp" || jointKey === "thumb_ip") {
    return jointKey;
  }
  if (jointKey === "finger_mcp" || jointKey === "finger_pip" || jointKey === "finger_dip") {
    const finger = fingerSelection ?? "index";
    if (jointKey === "finger_mcp") {
      if (finger === "index") return "index_mcp";
      if (finger === "middle") return "middle_mcp";
      if (finger === "ring") return "ring_mcp";
      if (finger === "little") return "little_mcp";
      return null;
    }
    if (jointKey === "finger_pip") {
      if (finger === "index") return "index_pip";
      if (finger === "middle") return "middle_pip";
      if (finger === "ring") return "ring_pip";
      if (finger === "little") return "little_pip";
      return null;
    }
    if (finger === "index") return "index_dip";
    if (finger === "middle") return "middle_dip";
    if (finger === "ring") return "ring_dip";
    if (finger === "little") return "little_dip";
    return null;
  }
  return null;
}

function getAmputationSuppressedAnatomicalKeys(amp: AmputationValue): Set<UpperAnatomicalKey> {
  const suppressed = new Set<UpperAnatomicalKey>();

  if (amp.armLevel === "above_elbow") {
    suppressed.add("elbow");
    suppressed.add("wrist");
    UPPER_HAND_ANATOMICAL_KEYS.forEach((key) => suppressed.add(key));
  } else if (amp.armLevel === "below_elbow") {
    suppressed.add("wrist");
    UPPER_HAND_ANATOMICAL_KEYS.forEach((key) => suppressed.add(key));
  } else if (amp.armLevel === "hand") {
    UPPER_HAND_ANATOMICAL_KEYS.forEach((key) => suppressed.add(key));
  }

  for (const finger of ["thumb", "index", "middle", "ring", "little"] as FingerKey[]) {
    const level = amp.fingers[finger];
    if (!level || level === "none") continue;
    const mapped = UPPER_FINGER_LEVEL_SUPPRESSION[finger][level];
    if (mapped) {
      mapped.forEach((key) => suppressed.add(key));
      continue;
    }
    Object.values(UPPER_FINGER_LEVEL_SUPPRESSION[finger]).flat().forEach((key) => suppressed.add(key));
  }

  return suppressed;
}

function isUpperAnatomicalKeySuppressed(amp: AmputationValue, key: UpperAnatomicalKey): boolean {
  return getAmputationSuppressedAnatomicalKeys(amp).has(key);
}

/**
 * Backward-compatible helper used by UI/tests that expect ROM storage keys.
 */
export function getAmputationSuppressedJoints(amp: AmputationValue): Set<string> {
  const suppressed = new Set<string>();
  for (const key of getAmputationSuppressedAnatomicalKeys(amp)) {
    if (key === "shoulder" || key === "elbow" || key === "wrist") {
      suppressed.add(key);
      continue;
    }
    if (key === "thumb_cmc" || key === "thumb_mp" || key === "thumb_ip") {
      suppressed.add(getRomJointStorageKey(key, "thumb"));
      continue;
    }
    if (key.endsWith("_mcp")) {
      const finger = key.replace("_mcp", "") as FingerKey;
      suppressed.add(getRomJointStorageKey("finger_mcp", finger));
      continue;
    }
    if (key.endsWith("_pip")) {
      const finger = key.replace("_pip", "") as FingerKey;
      suppressed.add(getRomJointStorageKey("finger_pip", finger));
      continue;
    }
    if (key.endsWith("_dip")) {
      const finger = key.replace("_dip", "") as FingerKey;
      suppressed.add(getRomJointStorageKey("finger_dip", finger));
    }
  }
  return suppressed;
}

/**
 * Check if a DBE condition target is fully suppressed by amputation.
 * If a selected anatomical key is provided, suppression is evaluated only for that target.
 */
export function isDbeJointSuppressed(
  amp: AmputationValue,
  anatomicalKeys: readonly UpperAnatomicalKey[] | UpperAnatomicalKey | undefined,
  selectedAnatomicalKey?: UpperAnatomicalKey
): boolean {
  if (!anatomicalKeys) return false;
  const keys = Array.isArray(anatomicalKeys) ? anatomicalKeys : [anatomicalKeys];
  const resolvedKeys =
    selectedAnatomicalKey && keys.includes(selectedAnatomicalKey) ? [selectedAnatomicalKey] : keys;
  return resolvedKeys.every((key) => isUpperAnatomicalKeySuppressed(amp, key));
}

/**
 * Check if a ROM joint is suppressed by the current amputation.
 * For finger joints, also checks the specific finger selection.
 */
export function isRomJointSuppressed(
  amp: AmputationValue,
  jointKey: string,
  fingerSelection?: FingerKey
): boolean {
  const anatomicalKey = getRomJointAnatomicalKey(jointKey, fingerSelection);
  if (!anatomicalKey) return false;
  return isUpperAnatomicalKeySuppressed(amp, anatomicalKey);
}

/**
 * Check if a neurological nerve entry is suppressed by amputation.
 *
 * Arm-level amputations apply distal-only suppression:
 * - above_elbow: keeps brachial plexus trunks and shoulder/upper-arm nerves
 *   (axillary, suprascapular, musculocutaneous, radial_upper); suppresses all else.
 * - below_elbow: additionally keeps elbow-level nerves (radial_elbow, cubital_tunnel);
 *   suppresses forearm/wrist/hand nerves.
 * - hand: suppresses only digital nerves and carpal_tunnel.
 *
 * Finger-level amputations suppress digital nerves for the amputated digit.
 */
export function isUpperLimbNerveSuppressed(amp: AmputationValue, nerveKey: string): boolean {
  if (amp.armLevel === "above_elbow") {
    const proximalNerves = new Set([
      "brachial_c5_t1", "upper_trunk_c5_c6", "middle_trunk_c7", "lower_trunk_c8_t1",
      "axillary", "suprascapular", "musculocutaneous", "radial_upper",
    ]);
    if (!proximalNerves.has(nerveKey)) return true;
  } else if (amp.armLevel === "below_elbow") {
    const proximalNerves = new Set([
      "brachial_c5_t1", "upper_trunk_c5_c6", "middle_trunk_c7", "lower_trunk_c8_t1",
      "axillary", "suprascapular", "musculocutaneous", "radial_upper",
      "radial_elbow", "cubital_tunnel",
    ]);
    if (!proximalNerves.has(nerveKey)) return true;
  } else if (amp.armLevel === "hand") {
    const nerve = UPPER_LIMB_NERVES.find((e) => e.key === nerveKey);
    if (nerve?.group === "digital") return true;
    if (nerveKey === "carpal_tunnel") return true;
  }

  const nerve = UPPER_LIMB_NERVES.find((entry) => entry.key === nerveKey);
  if (!nerve || nerve.group !== "digital" || !nerve.digit) return false;

  return amp.fingers[nerve.digit] !== "none";
}

/** Interpolate a value from a lookup table. */
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

/** Resolve the active lookup table for a ROM direction by motion mode. */
export function getRomLookupTable(direction: RomDirection, isAnkylosed: boolean): RomLookup[] {
  return isAnkylosed ? (direction.ankylosisTable ?? direction.table) : direction.table;
}

interface ResolvedRomEntry {
  storageKey: string;
  finger?: FingerKey;
  value: RomJointValue;
  directions: RomDirection[];
}

function getLegacyFingerSelection(rom: RomValue, jointKey: string): FingerKey | undefined {
  const legacy = rom.fingerSelections?.[jointKey];
  if (legacy === "thumb") return "thumb";
  if (legacy === "index") return "index";
  if (legacy === "middle") return "middle";
  if (legacy === "ring") return "ring";
  if (legacy === "little") return "little";
  return undefined;
}

function getJointDirections(joint: RomJoint, finger?: FingerKey): RomDirection[] {
  const isRingLittle = finger === "ring" || finger === "little";
  if (joint.perFinger && isRingLittle && joint.directionsRingLittle) {
    return joint.directionsRingLittle;
  }
  return joint.directions;
}

function resolveRomEntriesForJoint(rom: RomValue, joint: RomJoint): ResolvedRomEntry[] {
  if (!joint.perFinger) {
    const base = rom.joints[joint.key];
    if (!base) return [];
    return [{
      storageKey: joint.key,
      value: base,
      directions: joint.directions,
    }];
  }

  const entriesByFinger = new Map<FingerKey, ResolvedRomEntry>();
  for (const finger of getRomJointFingers(joint.key)) {
    const key = getRomJointStorageKey(joint.key, finger);
    const value = rom.joints[key];
    if (!value) continue;
    entriesByFinger.set(finger, {
      storageKey: key,
      finger,
      value,
      directions: getJointDirections(joint, finger),
    });
  }

  // Backward compatibility: older state kept a single unsuffixed key + optional fingerSelections.
  const legacy = rom.joints[joint.key];
  if (legacy) {
    const fallbackFinger = getLegacyFingerSelection(rom, joint.key)
      ?? (joint.key.startsWith("thumb_") ? "thumb" : "index");
    if (!entriesByFinger.has(fallbackFinger)) {
      entriesByFinger.set(fallbackFinger, {
        storageKey: joint.key,
        finger: fallbackFinger,
        value: legacy,
        directions: getJointDirections(joint, fallbackFinger),
      });
    }
  }

  return [...entriesByFinger.values()];
}

function calculateRomEntryPercent(entry: ResolvedRomEntry): number {
  const dirPercents: number[] = [];
  for (const dir of entry.directions) {
    const angle = entry.value.measurements[dir.key];
    if (angle === undefined || angle === null) continue;
    dirPercents.push(lookupRom(getRomLookupTable(dir, entry.value.isAnkylosed), angle));
  }
  if (dirPercents.length === 0) return 0;
  if (entry.value.isAnkylosed) return Math.max(...dirPercents);
  return dirPercents.reduce((sum, v) => sum + v, 0);
}

/** Calculate amputation percentage. Finger sum capped at hand value. */
export function calculateAmputation(amp: AmputationValue): CategoryResult {
  const notes: string[] = [];

  // If arm-level amputation, that's the definitive value
  if (amp.armLevel !== "none") {
    const level = ARM_AMPUTATION_LEVELS.find((l) => l.id === amp.armLevel);
    if (level) {
      notes.push(`${level.label}: ${level.percent}%`);
      return { label: "Amputations", rawPercent: level.percent, notes };
    }
  }

  // Sum finger amputations
  let fingerTotal = 0;
  let thumbIncluded = false;
  const fingers: FingerKey[] = ["thumb", "index", "middle", "ring", "little"];
  for (const f of fingers) {
    const levelId = amp.fingers[f];
    if (levelId && levelId !== "none") {
      const levels = FINGER_AMPUTATION_LEVELS[f];
      const level = levels.find((l) => l.id === levelId);
      if (level) {
        fingerTotal += level.percent;
        if (f === "thumb") thumbIncluded = true;
        notes.push(`${FINGER_LABELS[f]} (${level.label}): ${level.percent}%`);
      }
    }
  }

  // Apply GATIOD cap: 70% with thumb, 60% without thumb (four fingers only)
  const applicableCap = thumbIncluded ? HAND_AMPUTATION_CAP : FOUR_FINGERS_ONLY_CAP;
  if (fingerTotal > applicableCap) {
    const capLabel = thumbIncluded
      ? `whole hand (four fingers + thumb) cap ${HAND_AMPUTATION_CAP}%`
      : `four fingers only cap ${FOUR_FINGERS_ONLY_CAP}%`;
    notes.push(`Finger total ${fingerTotal}% capped at ${capLabel}`);
    fingerTotal = applicableCap;
  }

  return { label: "Amputations", rawPercent: fingerTotal, notes };
}

/** Calculate ROM impairment. Additive for restricted motion, highest for ankylosis. */
export function calculateRom(rom: RomValue): CategoryResult {
  const notes: string[] = [];
  const jointPercents: number[] = [];

  for (const joint of ROM_JOINTS) {
    const entries = resolveRomEntriesForJoint(rom, joint);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      const dirPercents: { label: string; percent: number }[] = [];
      for (const dir of entry.directions) {
        const angle = entry.value.measurements[dir.key];
        if (angle === undefined || angle === null) continue;
        const pct = lookupRom(getRomLookupTable(dir, entry.value.isAnkylosed), angle);
        if (pct > 0) dirPercents.push({ label: dir.label, percent: pct });
      }
      if (dirPercents.length === 0) continue;

      const entryLabel = joint.perFinger && entry.finger
        ? `${joint.label} (${FINGER_LABELS[entry.finger]})`
        : joint.label;
      const jointTotal = entry.value.isAnkylosed
        ? Math.max(...dirPercents.map((d) => d.percent))
        : dirPercents.reduce((sum, d) => sum + d.percent, 0);

      if (entry.value.isAnkylosed) {
        notes.push(`${entryLabel} (ankylosed): highest = ${jointTotal}%`);
      } else {
        notes.push(`${entryLabel}: ${dirPercents.map((d) => `${d.label} ${d.percent}%`).join(" + ")} = ${jointTotal}%`);
      }

      jointPercents.push(jointTotal);
    }
  }

  // Multiple joints: combine with CVC
  const total = jointPercents.length > 1 ? combinedValuesChart(jointPercents) : (jointPercents[0] ?? 0);
  if (jointPercents.length > 1) {
    notes.push(`CVC across ${jointPercents.length} joints: ${total}%`);
  }

  return { label: "ROM", rawPercent: total, notes };
}

/** Calculate neurological impairment. */
export function calculateNeurological(neuro: NeurologicalValue): CategoryResult {
  const notes: string[] = [];
  const values: number[] = [];
  const bestByNerve = new Map<string, { label: string; pct: number; note: string }>();

  for (const sel of neuro.selectedNerves) {
    const nerve = UPPER_LIMB_NERVES.find((n) => n.key === sel.nerveKey);
    if (!nerve) continue;

    let pct = 0;
    let note = "";

    if (nerve.group === "entrapment" && nerve.severityLevels) {
      const sev = nerve.severityLevels.find((s) => s.id === sel.severityId);
      pct = sev?.percent ?? 0;
      note = `${nerve.label} (${sev?.label ?? "?"}): ${pct}%`;
    } else {
      let maxPct = 0;
      if (sel.deficitType === "sensory") maxPct = nerve.sensoryMax ?? 0;
      else if (sel.deficitType === "motor") maxPct = nerve.motorMax ?? 0;
      else maxPct = nerve.combinedMax ?? 0;

      pct = sel.lossType === "partial" ? maxPct / 2 : maxPct;
      note = `${nerve.label} (${sel.deficitType}, ${sel.lossType}): ${pct}%`;
    }

    if (pct <= 0) continue;
    const prev = bestByNerve.get(nerve.key);
    if (!prev || pct > prev.pct) {
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
  return { label: "Neurological", rawPercent: total, notes };
}

/** Calculate DBE impairment. */
const UPPER_DBE_BY_ID = new Map(DBE_CONDITIONS.map((condition) => [condition.id, condition] as const));

function resolveUpperDbeSelectionAnatomicalKey(
  selection: DbeSelection,
  condition: DbeCondition
): UpperAnatomicalKey {
  if (
    selection.selectedAnatomicalKey &&
    condition.anatomicalKeys.includes(selection.selectedAnatomicalKey)
  ) {
    return selection.selectedAnatomicalKey;
  }
  return condition.anatomicalKeys[0];
}

export function calculateDbe(dbe: DbeValue, amp?: AmputationValue): CategoryResult {
  const notes: string[] = [];
  const values: number[] = [];
  const bestByConditionAndTarget = new Map<
    string,
    { cond: DbeCondition; pct: number; anatomicalKey: UpperAnatomicalKey }
  >();

  for (const sel of dbe.selectedConditions) {
    const cond = UPPER_DBE_BY_ID.get(sel.conditionId);
    if (!cond) continue;
    const anatomicalKey = resolveUpperDbeSelectionAnatomicalKey(sel, cond);
    const pct = Math.min(Math.max(sel.selectedPercent, cond.minPercent), cond.maxPercent);
    const dedupeKey = `${cond.id}::${anatomicalKey}`;
    const prev = bestByConditionAndTarget.get(dedupeKey);
    if (!prev || pct > prev.pct) {
      bestByConditionAndTarget.set(dedupeKey, { cond, pct, anatomicalKey });
    }
  }

  for (const { cond, pct, anatomicalKey } of bestByConditionAndTarget.values()) {
    const targetLabel = UPPER_ANATOMICAL_LABELS[anatomicalKey] ?? anatomicalKey;
    if (amp && isDbeJointSuppressed(amp, cond.anatomicalKeys, anatomicalKey)) {
      notes.push(`${cond.label}: suppressed by amputation`);
      continue;
    }
    values.push(pct);
    notes.push(`${cond.label} (${targetLabel}): ${pct}%`);
  }

  const total = combinedValuesChart(values);
  return { label: "DBE", rawPercent: total, notes };
}

/** Build ROM impairment map grouped by exact anatomical structure key. */
export function buildRomByAnatomicalKey(rom: RomValue, amp?: AmputationValue): Record<string, number> {
  const grouped: Record<string, number[]> = {};

  for (const joint of ROM_JOINTS) {
    const entries = resolveRomEntriesForJoint(rom, joint);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      if (amp && isRomJointSuppressed(amp, joint.key, entry.finger)) continue;
      const total = calculateRomEntryPercent(entry);
      if (total <= 0) continue;
      const anatomicalKey = getRomJointAnatomicalKey(joint.key, entry.finger);
      if (!anatomicalKey) continue;
      grouped[anatomicalKey] = grouped[anatomicalKey] ?? [];
      grouped[anatomicalKey].push(total);
    }
  }

  const romByAnatomicalKey: Record<string, number> = {};
  for (const [anatomicalKey, values] of Object.entries(grouped)) {
    romByAnatomicalKey[anatomicalKey] = combinedValuesChart(values);
  }
  return romByAnatomicalKey;
}

/** Backward-compatible alias kept for downstream callers. */
export function buildRomByJoint(rom: RomValue, amp?: AmputationValue): Record<string, number> {
  return buildRomByAnatomicalKey(rom, amp);
}

/** Build DBE impairment map grouped by exact anatomical structure key. */
export function buildDbeByAnatomicalKey(dbe: DbeValue, amp?: AmputationValue): Record<string, number> {
  const byAnatomicalKeyRaw: Record<string, number[]> = {};
  const bestByConditionAndTarget = new Map<
    string,
    { cond: DbeCondition; pct: number; anatomicalKey: UpperAnatomicalKey }
  >();

  for (const sel of dbe.selectedConditions) {
    const cond = UPPER_DBE_BY_ID.get(sel.conditionId);
    if (!cond) continue;
    const anatomicalKey = resolveUpperDbeSelectionAnatomicalKey(sel, cond);
    const pct = Math.min(Math.max(sel.selectedPercent, cond.minPercent), cond.maxPercent);
    const dedupeKey = `${cond.id}::${anatomicalKey}`;
    const prev = bestByConditionAndTarget.get(dedupeKey);
    if (!prev || pct > prev.pct) {
      bestByConditionAndTarget.set(dedupeKey, { cond, pct, anatomicalKey });
    }
  }

  for (const { cond, pct, anatomicalKey } of bestByConditionAndTarget.values()) {
    if (amp && isDbeJointSuppressed(amp, cond.anatomicalKeys, anatomicalKey)) continue;
    const key = anatomicalKey;
    byAnatomicalKeyRaw[key] = byAnatomicalKeyRaw[key] ?? [];
    byAnatomicalKeyRaw[key].push(pct);
  }

  const byAnatomicalKey: Record<string, number> = {};
  for (const [anatomicalKey, vals] of Object.entries(byAnatomicalKeyRaw)) {
    byAnatomicalKey[anatomicalKey] = combinedValuesChart(vals);
  }

  return byAnatomicalKey;
}

/** Backward-compatible alias kept for downstream callers. */
export function buildDbeByJoint(dbe: DbeValue, amp?: AmputationValue): Record<string, number> {
  return buildDbeByAnatomicalKey(dbe, amp);
}

/** Resolve DBE vs ROM conflicts for the same joint. Returns the higher value. */
export function resolveDbeRomConflicts(
  rom: RomValue,
  dbe: DbeValue,
  amp?: AmputationValue
): { joint: string; romPercent: number; dbePercent: number; winner: string }[] {
  const conflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[] = [];
  const romByAnatomicalKey = buildRomByAnatomicalKey(rom, amp);
  const dbeByAnatomicalKey = buildDbeByAnatomicalKey(dbe, amp);

  for (const [anatomicalKey, romPct] of Object.entries(romByAnatomicalKey)) {
    const dbePct = dbeByAnatomicalKey[anatomicalKey];
    if (!dbePct || romPct <= 0) continue;
    conflicts.push({
      joint: anatomicalKey,
      romPercent: romPct,
      dbePercent: dbePct,
      winner: dbePct >= romPct ? "DBE" : "ROM",
    });
  }

  return conflicts;
}

/** Master calculation for the entire upper limb. */
export function calculateUpperLimb(value: UpperLimbValue): UpperLimbResult {
  const ampResult = calculateAmputation(value.amputations);
  const romResult = calculateRom(value.rom);
  const activeNeurologicalSelections = value.neurological.selectedNerves.filter(
    (selection) => !isUpperLimbNerveSuppressed(value.amputations, selection.nerveKey)
  );
  const suppressedNeurologicalCount =
    value.neurological.selectedNerves.length - activeNeurologicalSelections.length;
  const neuroResult = calculateNeurological({
    ...value.neurological,
    selectedNerves: activeNeurologicalSelections,
  });
  if (suppressedNeurologicalCount > 0) {
    neuroResult.notes.push(
      `${suppressedNeurologicalCount} neurological entr${suppressedNeurologicalCount === 1 ? "y" : "ies"} suppressed by amputation`
    );
  }
  const dbeResult = calculateDbe(value.dbe, value.amputations);

  const rawRomByAnatomicalKey = buildRomByAnatomicalKey(value.rom);
  let romByAnatomicalKey = buildRomByAnatomicalKey(value.rom, value.amputations);
  const rawDbeByAnatomicalKey = buildDbeByAnatomicalKey(value.dbe);
  const dbeByAnatomicalKey = buildDbeByAnatomicalKey(value.dbe, value.amputations);

  // ── Rule 1: Distal amputation suppression only ───────────────────────────
  if (Object.keys(rawRomByAnatomicalKey).length > Object.keys(romByAnatomicalKey).length) {
    romResult.notes.push("ROM suppressed: only distal structures are absorbed by amputation");
  }
  if (Object.keys(rawDbeByAnatomicalKey).length > Object.keys(dbeByAnatomicalKey).length) {
    dbeResult.notes.push("DBE suppressed: only distal structures are absorbed by amputation");
  }

  // ── Rule 4: Nerve vs ROM Conflict (R0017) ────────────────────────────────
  if (value.neurological.romFromNerve) {
    romByAnatomicalKey = {};
    romResult.notes.push("ROM excluded: restrictions attributed to nerve lesion per Rule R0017.");
  }

  // ── Rule 6: DBE vs ROM Conflict Resolution ───────────────────────────────
  const conflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[] = [];
  for (const [anatomicalKey, romPct] of Object.entries(romByAnatomicalKey)) {
    const dbePct = dbeByAnatomicalKey[anatomicalKey];
    if (!dbePct || romPct <= 0) continue;
    const winner = dbePct >= romPct ? "DBE" : "ROM";
    conflicts.push({
      joint: anatomicalKey,
      romPercent: romPct,
      dbePercent: dbePct,
      winner,
    });
    if (winner === "DBE") delete romByAnatomicalKey[anatomicalKey];
    else delete dbeByAnatomicalKey[anatomicalKey];
  }

  const adjustedRom = combinedValuesChart(Object.values(romByAnatomicalKey));
  const adjustedDbe = combinedValuesChart(Object.values(dbeByAnatomicalKey));

  // ── Rule 8: Global CVC Aggregation ───────────────────────────────────────
  const cvcInputs = [ampResult.rawPercent, adjustedRom, neuroResult.rawPercent, adjustedDbe].filter((v) => v > 0);
  const finalPercent = Math.min(combinedValuesChart(cvcInputs), TOTAL_UPPER_LIMB_CAP);

  return {
    amputation: ampResult,
    rom: { ...romResult, rawPercent: adjustedRom },
    neurological: neuroResult,
    dbe: { ...dbeResult, rawPercent: adjustedDbe },
    dbeRomConflicts: conflicts,
    cvcInputs,
    finalPercent,
  };
}

// ─── Default Values ─────────────────────────────────────────────────────────

export function defaultUpperLimbValue(): UpperLimbValue {
  return {
    side: "right",
    amputations: {
      armLevel: "none",
      fingers: { thumb: "none", index: "none", middle: "none", ring: "none", little: "none" },
    },
    rom: {
      joints: {},
    },
    neurological: {
      selectedNerves: [],
      romFromNerve: false,
    },
    dbe: {
      selectedConditions: [],
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Joint Instability Lookup Table (GATIOD Ch3 Section B)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type InstabilityType =
  | "subluxation_persistent"
  | "dislocation_recurrent"
  | "dislocation_persistent_untreated";

export interface JointInstabilityEntry {
  joint: string;
  label: string;
  subluxation_persistent: number | null;
  dislocation_recurrent: number | null;
  dislocation_persistent_untreated: number | null;
}

export const JOINT_INSTABILITY_TABLE: JointInstabilityEntry[] = [
  { joint: "shoulder_glenohumeral",      label: "Shoulder Gleno-humeral",          subluxation_persistent: 4,  dislocation_recurrent: 10,   dislocation_persistent_untreated: 16 },
  { joint: "shoulder_acromioclavicular", label: "Shoulder Acromio-clavicular",     subluxation_persistent: 2,  dislocation_recurrent: null, dislocation_persistent_untreated: 6  },
  { joint: "shoulder_sternoclavicular",  label: "Shoulder Sterno-clavicular",      subluxation_persistent: 2,  dislocation_recurrent: null, dislocation_persistent_untreated: 6  },
  { joint: "elbow",                      label: "Elbow (ulnohumeral)",             subluxation_persistent: 4,  dislocation_recurrent: 10,   dislocation_persistent_untreated: 16 },
  { joint: "wrist_radiocarpal",          label: "Wrist Radiocarpal",               subluxation_persistent: 4,  dislocation_recurrent: null, dislocation_persistent_untreated: 12 },
  { joint: "wrist_distal_carpal_row",    label: "Wrist Distal Carpal Row",         subluxation_persistent: 2,  dislocation_recurrent: null, dislocation_persistent_untreated: 6  },
  { joint: "thumb_cmc",                  label: "Thumb Carpometacarpal",           subluxation_persistent: 4,  dislocation_recurrent: null, dislocation_persistent_untreated: 8  },
  { joint: "thumb_mcp",                  label: "Thumb Metacarpophalangeal",       subluxation_persistent: 1,  dislocation_recurrent: null, dislocation_persistent_untreated: 6  },
  { joint: "thumb_ip",                   label: "Thumb Interphalangeal",           subluxation_persistent: 1,  dislocation_recurrent: null, dislocation_persistent_untreated: 4  },
  { joint: "index_middle_mcp",           label: "Index/Middle Finger MCP",         subluxation_persistent: 2,  dislocation_recurrent: null, dislocation_persistent_untreated: 6  },
  { joint: "index_middle_pip",           label: "Index/Middle Finger PIP",         subluxation_persistent: 2,  dislocation_recurrent: null, dislocation_persistent_untreated: 4  },
  { joint: "index_middle_dip",           label: "Index/Middle Finger DIP",         subluxation_persistent: 1,  dislocation_recurrent: null, dislocation_persistent_untreated: 2  },
  { joint: "ring_little_mcp",            label: "Ring/Little Finger MCP",          subluxation_persistent: 1,  dislocation_recurrent: null, dislocation_persistent_untreated: 4  },
  { joint: "ring_little_pip",            label: "Ring/Little Finger PIP",          subluxation_persistent: 1,  dislocation_recurrent: null, dislocation_persistent_untreated: 3  },
  { joint: "ring_little_dip",            label: "Ring/Little Finger DIP",          subluxation_persistent: 0,  dislocation_recurrent: null, dislocation_persistent_untreated: 2  },
];
