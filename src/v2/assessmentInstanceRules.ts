/**
 * Assessment Instance Rules — chat-assistant V2
 *
 * Ported from angle-gauge-ui/src/components/Hub/instanceRules.ts.
 * Defines which systems allow multiple assessment instances, what slots are
 * available, and validation logic to prevent duplicate compensation.
 *
 * Rules are derived from the Sixth Edition GATIOD:
 * - Spine: multiple non-contiguous regions allowed; same region blocked
 * - Upper/Lower Limb: bilateral (L/R) + multiple joints; same joint blocked
 * - Hearing: NID = single global; Injury = per-ear instances
 * - Visual: per-eye + optional diplopia instance
 * - CNS: single global instance
 * - Gastro: multiple anatomical sub-systems allowed
 * - Respiratory: single global instance only
 * - Renal: single global instance only
 *
 */

import { z } from "zod";
import type {
  GatiodSystemKey,
  V2AssessmentInstance,
  V2InstanceStatus,
} from "./contracts.js";

export type { V2AssessmentInstance, V2InstanceStatus };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instance Slot Definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface InstanceSlot {
  slotKey: string;
  label: string;
  group?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Multiplicity Mode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type MultiplicityMode =
  | "single"        // One global instance only (Respiratory, Renal, CNS)
  | "fixed_slots"   // Predefined slots, each at most once (Spine regions, eyes, gastro subsystems)
  | "dynamic_slots" // Slots determined by user input at runtime (Hearing: NID vs injury path)
  | "hierarchical"; // Fixed top-level slots with dynamic children (Upper/Lower Limb: side → joints)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// System Instance Rule
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SystemInstanceRule {
  systemKey: GatiodSystemKey;
  mode: MultiplicityMode;
  /** null = unlimited within slot constraints */
  maxInstances: number | null;
  slots: InstanceSlot[];
  /** For hierarchical mode: child slots per parent slot key */
  childSlots?: Record<string, InstanceSlot[]>;
  ruleDescription: string;
  combinationMethod: "cvc" | "additive" | "highest" | "none";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instance ID Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Deterministic instance ID from system key + slot path.
 * e.g. makeInstanceId("upper_limb", "left", "shoulder") → "upper_limb::left::shoulder"
 */
export function makeInstanceId(
  systemKey: GatiodSystemKey,
  ...slotKeys: string[]
): string {
  return [systemKey, ...slotKeys].join("::");
}

export function parseInstanceId(instanceId: string): {
  systemKey: GatiodSystemKey;
  slotKeys: string[];
} {
  const parts = instanceId.split("::");
  return {
    systemKey: parts[0] as GatiodSystemKey,
    slotKeys: parts.slice(1),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Per-System Rules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Spine ─────────────────────────────────────────────────────────────────

const SPINE_SLOTS: InstanceSlot[] = [
  { slotKey: "cervical",        label: "Cervical (C1–C7)",       group: "region" },
  { slotKey: "thoraco_lumbar",  label: "Thoraco-Lumbar (T1–L1)", group: "region" },
  { slotKey: "lumbo_sacral",    label: "Lumbo-Sacral (L2–S1)",   group: "region" },
];

const spineRule: SystemInstanceRule = {
  systemKey: "spine",
  mode: "fixed_slots",
  maxInstances: 3,
  slots: SPINE_SLOTS,
  ruleDescription:
    "Multiple non-contiguous spinal regions may be assessed separately and combined using the CVC. " +
    "Multiple injuries within the same region use the Highest Award Override.",
  combinationMethod: "cvc",
};

// ── 2. Upper Limb ────────────────────────────────────────────────────────────

const UPPER_LIMB_SIDES: InstanceSlot[] = [
  { slotKey: "left",  label: "Left Upper Limb",  group: "side" },
  { slotKey: "right", label: "Right Upper Limb", group: "side" },
];

const UPPER_LIMB_JOINTS: InstanceSlot[] = [
  { slotKey: "shoulder",      label: "Shoulder",      group: "joint" },
  { slotKey: "elbow",         label: "Elbow",         group: "joint" },
  { slotKey: "wrist",         label: "Wrist",         group: "joint" },
  { slotKey: "thumb",         label: "Thumb",         group: "joint" },
  { slotKey: "index_finger",  label: "Index Finger",  group: "joint" },
  { slotKey: "middle_finger", label: "Middle Finger", group: "joint" },
  { slotKey: "ring_finger",   label: "Ring Finger",   group: "joint" },
  { slotKey: "little_finger", label: "Little Finger", group: "joint" },
];

const upperLimbRule: SystemInstanceRule = {
  systemKey: "upper_limb",
  mode: "hierarchical",
  maxInstances: null,
  slots: UPPER_LIMB_SIDES,
  childSlots: {
    left:  UPPER_LIMB_JOINTS,
    right: UPPER_LIMB_JOINTS,
  },
  ruleDescription:
    "Left and Right limbs assessed separately. Within each limb, multiple distinct joints/parts " +
    "may be added and combined using the CVC. Duplicate joints on the same side are blocked. " +
    "DBE and ROM conflicts for the same joint are resolved by selecting the higher award.",
  combinationMethod: "cvc",
};

// ── 3. Lower Limb ────────────────────────────────────────────────────────────

const LOWER_LIMB_SIDES: InstanceSlot[] = [
  { slotKey: "left",  label: "Left Lower Limb",  group: "side" },
  { slotKey: "right", label: "Right Lower Limb", group: "side" },
];

const LOWER_LIMB_JOINTS: InstanceSlot[] = [
  { slotKey: "hip",          label: "Hip",          group: "joint" },
  { slotKey: "knee",         label: "Knee",         group: "joint" },
  { slotKey: "ankle",        label: "Ankle",        group: "joint" },
  { slotKey: "great_toe",    label: "Great Toe",    group: "joint" },
  { slotKey: "lesser_toes",  label: "Lesser Toes",  group: "joint" },
  { slotKey: "shortening",   label: "Limb Shortening", group: "modifier" },
];

const lowerLimbRule: SystemInstanceRule = {
  systemKey: "lower_limb",
  mode: "hierarchical",
  maxInstances: null,
  slots: LOWER_LIMB_SIDES,
  childSlots: {
    left:  LOWER_LIMB_JOINTS,
    right: LOWER_LIMB_JOINTS,
  },
  ruleDescription:
    "Left and Right limbs assessed separately. Within each limb, multiple distinct joints/parts " +
    "may be added and combined using the CVC. Duplicate joints on the same side are blocked. " +
    "Limb shortening is a distinct slot, not a joint injury.",
  combinationMethod: "cvc",
};

// ── 4. Hearing ───────────────────────────────────────────────────────────────

const HEARING_NID_SLOTS: InstanceSlot[] = [
  { slotKey: "global", label: "Noise Induced Deafness (Both Ears)", group: "nid" },
];

const HEARING_INJURY_SLOTS: InstanceSlot[] = [
  { slotKey: "left_ear",  label: "Left Ear",  group: "injury" },
  { slotKey: "right_ear", label: "Right Ear", group: "injury" },
];

const hearingRule: SystemInstanceRule = {
  systemKey: "hearing",
  mode: "dynamic_slots",
  maxInstances: null,
  slots: [...HEARING_NID_SLOTS, ...HEARING_INJURY_SLOTS],
  ruleDescription:
    "For NID: a single global assessment using the Better Ear Rule. " +
    "For Injuries/Accidents: separate instances per affected ear, combined additively. " +
    "NID and injury instances cannot coexist.",
  combinationMethod: "additive",
};

// ── 5. Visual ────────────────────────────────────────────────────────────────

const VISUAL_SLOTS: InstanceSlot[] = [
  { slotKey: "left_eye",  label: "Left Eye",              group: "eye" },
  { slotKey: "right_eye", label: "Right Eye",             group: "eye" },
  { slotKey: "diplopia",  label: "Diplopia (Binocular)",  group: "binocular" },
];

const visualRule: SystemInstanceRule = {
  systemKey: "visual",
  mode: "fixed_slots",
  maxInstances: 3,
  slots: VISUAL_SLOTS,
  ruleDescription:
    "Each eye is assessed individually and capped at 50%. " +
    "Diplopia is a separate binocular assessment. " +
    "System subtotal uses additive aggregation after per-eye caps.",
  combinationMethod: "additive",
};

// ── 6. CNS ───────────────────────────────────────────────────────────────────

const cnsRule: SystemInstanceRule = {
  systemKey: "cns",
  mode: "single",
  maxInstances: 1,
  slots: [{ slotKey: "global", label: "CNS Chapter 10 (Sections A/B/C)", group: "global" }],
  ruleDescription:
    "CNS Chapter 10 assessed as one global instance: Section A picks the single highest cerebral " +
    "group, Section B combines distinct neurological impairments by CVC, Section C maps paralysis " +
    "to amputation-equivalent values.",
  combinationMethod: "none",
};

// ── 7. Gastro / Digestive ─────────────────────────────────────────────────────

const GASTRO_SLOTS: InstanceSlot[] = [
  { slotKey: "upper_digestive",  label: "Upper Digestive Tract",  group: "subsystem" },
  { slotKey: "colonic_rectal",   label: "Colonic / Rectal / Anal", group: "subsystem" },
  { slotKey: "liver_biliary",    label: "Liver / Biliary Tract",  group: "subsystem" },
  { slotKey: "herniation",       label: "Herniation",             group: "subsystem" },
];

const gastroRule: SystemInstanceRule = {
  systemKey: "gastro_digestive",
  mode: "fixed_slots",
  maxInstances: 4,
  slots: GASTRO_SLOTS,
  ruleDescription:
    "Multiple distinct anatomical sub-systems assessed separately. " +
    "Each sub-system maps to its own severity bracket. Results combined using the CVC.",
  combinationMethod: "cvc",
};

// ── 8. Respiratory ────────────────────────────────────────────────────────────

const respiratoryRule: SystemInstanceRule = {
  systemKey: "respiratory",
  mode: "single",
  maxInstances: 1,
  slots: [{ slotKey: "global", label: "Respiratory Function (Global)", group: "global" }],
  ruleDescription:
    "Evaluates lungs globally based on PFT results (FVC, FEV1, DLCO, VO₂ Max). " +
    "Per-lung instances are physiologically invalid under GATIOD.",
  combinationMethod: "none",
};

// ── 9. Renal ──────────────────────────────────────────────────────────────────

const renalRule: SystemInstanceRule = {
  systemKey: "renal",
  mode: "single",
  maxInstances: 1,
  slots: [{ slotKey: "global", label: "Renal Function (Global)", group: "global" }],
  ruleDescription:
    "Evaluates kidneys globally based on biomarkers (Serum Creatinine, Creatinine Clearance). " +
    "Solitary kidney modifier (+10%) is a toggle within the single instance, not a separate instance.",
  combinationMethod: "none",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Rule Registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const INSTANCE_RULES: Record<GatiodSystemKey, SystemInstanceRule> = {
  spine:             spineRule,
  upper_limb:        upperLimbRule,
  lower_limb:        lowerLimbRule,
  hearing:           hearingRule,
  visual:            visualRule,
  cns:               cnsRule,
  gastro_digestive:  gastroRule,
  respiratory:       respiratoryRule,
  renal:             renalRule,
};

export function getInstanceRule(systemKey: GatiodSystemKey): SystemInstanceRule {
  return INSTANCE_RULES[systemKey];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Validation Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface InstanceValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a new instance can be created for a given system + slot path.
 * Returns { allowed, reason } — reason populated only when blocked.
 *
 * @param hearingPath - required when systemKey === "hearing": "nid" | "injury"
 */
export function canCreateInstance(
  systemKey: GatiodSystemKey,
  slotPath: string[],
  existingInstanceIds: string[],
  hearingPath?: "nid" | "injury"
): InstanceValidationResult {
  const rule = INSTANCE_RULES[systemKey];
  const candidateId = makeInstanceId(systemKey, ...slotPath);

  if (existingInstanceIds.includes(candidateId)) {
    return {
      allowed: false,
      reason: `An assessment for this exact slot already exists. Duplicate instances are not permitted to prevent double compensation.`,
    };
  }

  switch (rule.mode) {
    case "single": {
      if (existingInstanceIds.length >= 1) {
        return {
          allowed: false,
          reason: `${rule.slots[0]?.label ?? systemKey} permits only a single global assessment instance.`,
        };
      }
      return { allowed: true };
    }

    case "fixed_slots": {
      const validSlotKeys = rule.slots.map((s) => s.slotKey);
      if (slotPath.length !== 1 || !validSlotKeys.includes(slotPath[0])) {
        return {
          allowed: false,
          reason: `Invalid slot. Valid options: ${rule.slots.map((s) => s.label).join(", ")}.`,
        };
      }
      if (rule.maxInstances !== null && existingInstanceIds.length >= rule.maxInstances) {
        return {
          allowed: false,
          reason: `Maximum of ${rule.maxInstances} instances reached for this system.`,
        };
      }
      return { allowed: true };
    }

    case "hierarchical": {
      if (slotPath.length < 1) {
        return { allowed: false, reason: "A side (Left/Right) must be selected." };
      }
      const validParents = rule.slots.map((s) => s.slotKey);
      if (!validParents.includes(slotPath[0])) {
        return {
          allowed: false,
          reason: `Invalid side. Valid options: ${rule.slots.map((s) => s.label).join(", ")}.`,
        };
      }
      if (slotPath.length >= 2 && rule.childSlots) {
        const children = rule.childSlots[slotPath[0]];
        if (!children) {
          return { allowed: false, reason: `No sub-slots defined for ${slotPath[0]}.` };
        }
        const validChildren = children.map((c) => c.slotKey);
        if (!validChildren.includes(slotPath[1])) {
          return {
            allowed: false,
            reason: `Invalid joint/part. Valid options: ${children.map((c) => c.label).join(", ")}.`,
          };
        }
      }
      return { allowed: true };
    }

    case "dynamic_slots": {
      if (systemKey === "hearing") {
        if (hearingPath === "nid") {
          if (slotPath[0] !== "global") {
            return {
              allowed: false,
              reason: "NID assessment does not support per-ear instances. Use the single global assessment.",
            };
          }
          if (existingInstanceIds.length >= 1) {
            return { allowed: false, reason: "Only one NID assessment instance is permitted." };
          }
          return { allowed: true };
        }

        if (hearingPath === "injury") {
          const validEarSlots = ["left_ear", "right_ear"];
          if (!validEarSlots.includes(slotPath[0])) {
            return {
              allowed: false,
              reason: "Injury assessments must specify Left Ear or Right Ear.",
            };
          }
          const nidId = makeInstanceId("hearing", "global");
          if (existingInstanceIds.includes(nidId)) {
            return {
              allowed: false,
              reason: "Cannot add ear-specific injury instances when an NID assessment is active. Clear the NID instance first.",
            };
          }
          return { allowed: true };
        }

        return { allowed: false, reason: "A hearing path (NID or Injury) must be selected first." };
      }

      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}

/**
 * Get available (not yet used) slots for a system.
 */
export function getAvailableSlots(
  systemKey: GatiodSystemKey,
  existingInstanceIds: string[],
  parentSlotKey?: string,
  hearingPath?: "nid" | "injury"
): InstanceSlot[] {
  const rule = INSTANCE_RULES[systemKey];

  switch (rule.mode) {
    case "single": {
      if (existingInstanceIds.length >= 1) return [];
      return rule.slots;
    }

    case "fixed_slots": {
      return rule.slots.filter((slot) => {
        const id = makeInstanceId(systemKey, slot.slotKey);
        return !existingInstanceIds.includes(id);
      });
    }

    case "hierarchical": {
      if (!parentSlotKey) {
        return rule.slots;
      }
      const children = rule.childSlots?.[parentSlotKey] ?? [];
      return children.filter((child) => {
        const id = makeInstanceId(systemKey, parentSlotKey, child.slotKey);
        return !existingInstanceIds.includes(id);
      });
    }

    case "dynamic_slots": {
      if (systemKey === "hearing") {
        if (hearingPath === "nid") {
          if (existingInstanceIds.length >= 1) return [];
          return HEARING_NID_SLOTS;
        }
        if (hearingPath === "injury") {
          const nidId = makeInstanceId("hearing", "global");
          if (existingInstanceIds.includes(nidId)) return [];
          return HEARING_INJURY_SLOTS.filter((slot) => {
            const id = makeInstanceId("hearing", slot.slotKey);
            return !existingInstanceIds.includes(id);
          });
        }
        return [];
      }
      return rule.slots;
    }

    default:
      return [];
  }
}

// ── Zod schema (for serialisation / coercion) ─────────────────────────────

export const instanceIdSchema = z.string().regex(
  /^[a-z_]+(::[a-z_]+)*$/,
  "Instance ID must be a :: delimited path of lowercase keys"
);

export const v2AssessmentInstanceSchema = z.object({
  instanceId: instanceIdSchema,
  system: z.string(),
  slotPath: z.array(z.string()),
  facts: z.record(z.unknown()),
  pendingObservations: z.array(z.unknown()),
  confirmation: z.object({ status: z.string() }).passthrough(),
  status: z.enum(["collecting", "ready", "confirmed", "calculated"]),
  piPercent: z.number().nullable(),
  trace: z.unknown().nullable(),
  updatedAt: z.string(),
});
