/**
 * Upper limb slot schema — ADR-0004 pilot.
 *
 * Single source of truth for upper limb fact keys, value types, the D2
 * inference boundary, clarification specs, and required_when conditions.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (condition evaluation)
 *   - validateUpperLimbReadiness wrapper (cross-slot "at least one stream" check)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────
//
// SlotCondition<UpperLimbFactKey> can only reference these keys.
// PresenceSignal keys (e.g. rom_present, nerve_present) can never appear
// in a required_when condition — the type parameter prevents it.

export type UpperLimbFactKey =
  | "side"
  | "rom_joints"
  | "rom_from_nerve"
  | "nerve_selections"
  | "arm_amputation"
  | "finger_amputations"
  | "dbe_selections";

// ── Schema ────────────────────────────────────────────────────────────────────

export const upperLimbSlotSchema: SlotDefinition<UpperLimbFactKey>[] = [
  // ── side ────────────────────────────────────────────────────────────────────
  {
    factKey: "side",
    label: "Affected side",
    description:
      'Which upper limb is affected. Extract "left" or "right" when explicitly stated. ' +
      'Bilateral mentions ("both arms", "bilateral") are not extractable as a single side — ' +
      "emit a clarification PendingObservation; do not guess.",
    valueType: "enum",
    allowedValues: ["left", "right"],
    clinicalInferenceAllowed: true,
    required_when: "always",
    // clarification present even though clinicalInferenceAllowed: true — side is
    // always required, so if missing it must be asked for regardless.
    clarification: {
      question: "Which upper limb is affected — left or right?",
      candidateAnswers: ["Left", "Right"],
      expectedAnswer: { kind: "enum", factKey: "side", choices: ["left", "right"] },
    },
  },

  // ── rom_joints ──────────────────────────────────────────────────────────────
  {
    factKey: "rom_joints",
    label: "Range of motion joint measurements",
    description: `Structured map of joints → movement directions → angle values.

Shape: Record<jointKey, { isAnkylosed: boolean; measurements: Record<directionKey, number> }>

Valid jointKeys:
  shoulder, elbow, wrist,
  thumb_mp, thumb_ip, thumb_cmc,
  finger_dip, finger_pip, finger_mcp,
  index_mcp, middle_mcp, ring_mcp, little_mcp

Valid directionKeys:
  flexion, extension, abduction, adduction,
  internal_rotation, external_rotation,
  pronation, supination,
  radial_deviation, ulnar_deviation,
  flexion_contracture, dorsiflexion, plantarflexion

Extraction rules:
  - Only extract an angle when a named direction appears in the same clause.
    "shoulder flexion 90°" → { shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }
  - A bare angle with no direction ("90 degrees" alone) → PendingObservation asking
    which direction it applies to. Do NOT infer the direction.
  - isAnkylosed: true only when the doctor uses "ankylosed", "fixed at", or "fused".
  - Word-form angles ("ninety degrees", "right angle") map to their numeric equivalent.
  - Multiple joints may be extracted from a single utterance.`,
    valueType: "object",
    // Direction names are always explicit (the movement word is the direction).
    // Bare angles without a direction word are the only miss — those go to PendingObservation.
    clinicalInferenceAllowed: true,
    required_when: "never", // optional stream; "at least one stream" checked in wrapper
  },

  // ── nerve_selections ────────────────────────────────────────────────────────
  {
    factKey: "nerve_selections",
    label: "Nerve deficit findings",
    description: `Array of peripheral nerve findings.

Shape: Array<{ nerveKey: string; deficitType: "sensory" | "motor" | "combined"; lossType: "total" | "partial" }>

Valid nerveKeys:
  median_below, median_above, median_anterior_interosseous,
  ulnar_below, ulnar_above, radial_elbow, radial_upper,
  suprascapular, brachial_c5_t1,
  upper_trunk_c5_c6, middle_trunk_c7, lower_trunk_c8_t1

Extraction rules:
  - nerveKey IS extractable — the nerve name is always explicitly stated.
  - deficitType (sensory / motor / combined): D2 boundary — clinicalInferenceAllowed: false.
    Must be stated explicitly. If missing, emit a PendingObservation using the
    clarification spec below (substitute the actual nerve name for "[nerve]").
  - lossType (total / partial): D2 boundary — clinicalInferenceAllowed: false.
    Must be stated explicitly. If missing, include in the same PendingObservation.
  - Multiple nerves may be extracted from a single utterance.
  - "ulnar deviation" / "radial deviation" are wrist ROM directions, not nerve names.`,
    valueType: "array",
    clinicalInferenceAllowed: false, // deficitType + lossType must never be inferred
    clarification: {
      question:
        "For the [nerve] nerve: is the deficit sensory, motor, or combined? And is it total or partial loss?",
      candidateAnswers: [
        "Sensory — partial",
        "Sensory — total",
        "Motor — partial",
        "Motor — total",
        "Combined — partial",
        "Combined — total",
      ],
      expectedAnswer: {
        kind: "enum",
        factKey: "nerve_selections",
        choices: [
          "sensory_partial",
          "sensory_total",
          "motor_partial",
          "motor_total",
          "combined_partial",
          "combined_total",
        ],
      },
    },
    required_when: "never",
  },

  // ── arm_amputation ──────────────────────────────────────────────────────────
  {
    factKey: "arm_amputation",
    label: "Arm amputation level",
    description: `Level of upper arm or forearm amputation.

Valid values: "none" | "above_elbow" | "below_elbow" | "hand"

Synonyms:
  "trans-humeral" / "transhumeral" → above_elbow
  "trans-radial" / "transradial"   → below_elbow
  "at wrist" / "wrist disarticulation" → hand

Set "none" only when the doctor explicitly negates amputation ("no amputation", "without amputation").
Omit this fact entirely when amputation is not mentioned.`,
    valueType: "enum",
    allowedValues: ["none", "above_elbow", "below_elbow", "hand"],
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── finger_amputations ──────────────────────────────────────────────────────
  {
    factKey: "finger_amputations",
    label: "Finger amputations",
    description: `Per-finger amputation levels.

Shape: Record<fingerKey, levelValue>
fingerKeys: thumb, index, middle, ring, little

levelValues (use the EXACT engine IDs below — do NOT use English descriptions):
  Non-thumb fingers (index, middle, ring, little):
    "dip"     = one phalanx (DIP level)
    "pip"     = two phalanges (PIP level)
    "mp"      = three phalanges (MP level)
    "mc"      = three phalanges + Nth metacarpal
    "mc_only" = Nth metacarpal only
  Thumb:
    "ip"      = one phalanx (IP level)
    "mp"      = both phalanges (MP level)
    "cmc"     = both phalanges + 1st metacarpal
    "mc_only" = 1st metacarpal only
  Any finger: "none" = no amputation

Extraction rules:
  - Only populate a finger key when both the finger name and phalanx count are explicit.
  - "Loss of four fingers" → index, middle, ring, little each at the stated phalanx level.
  - "Loss of left index finger — two phalanges" → { index: "pip" }
  - "Loss of left middle finger — three phalanges and 3rd metacarpal" → { middle: "mc" }
  - "Loss of left thumb — both phalanges and 1st metacarpal" → { thumb: "cmc" }
  - A parenthetical finger qualifier overrides a generic "finger" reference:
    "finger MCP ankylosed: 10° (index finger)" → the ROM entry, not an amputation.`,
    valueType: "object",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── dbe_selections ──────────────────────────────────────────────────────────
  {
    factKey: "dbe_selections",
    label: "Diagnosis-based injury (DBE) selections",
    description: `Array of ontology-matched DBE conditions with doctor-selected PI%.

Shape: Array<{ conditionId: string; selectedPercent: number; selectedAnatomicalKey?: string }>

Extraction rules:
  - conditionId must match a known DBE condition from the upper limb ontology.
    Do NOT fabricate condition IDs. If the condition name sounds plausible but
    you cannot confirm the ID, emit a PendingObservation.
  - selectedPercent is D2 boundary — clinicalInferenceAllowed: false. The PI%
    must be explicitly stated or selected from the workbook range. If the condition
    is named but no PI% is given, emit a PendingObservation (chips populated at
    runtime from the condition's min/max range).
  - selectedAnatomicalKey is optional — only set when the doctor specifies a
    sub-anatomical location for conditions that have anatomical variants.`,
    valueType: "array",
    clinicalInferenceAllowed: false, // selectedPercent must never be inferred
    clarification: {
      question: "What is the PI percentage for this diagnosis-based injury?",
      candidateAnswers: [], // populated dynamically from DBE_CONDITIONS at runtime
      expectedAnswer: {
        kind: "number",
        factKey: "dbe_selections",
        min: 0,
        max: 100,
        unit: "percent",
      },
    },
    required_when: "never",
  },

  // ── rom_from_nerve ──────────────────────────────────────────────────────────
  {
    factKey: "rom_from_nerve",
    label: "ROM source — independent or due to nerve",
    description: `Whether the ROM restrictions are caused by the nerve lesion or are independent findings.
Required only when both rom_joints and nerve_selections are present with content.

true  → ROM is due to the nerve lesion. The ROM stream is suppressed; nerve stream is used.
false → ROM findings are independent. Both streams are assessed separately.

D2 boundary — clinicalInferenceAllowed: false. The doctor must state this or select a chip.
  → true:  "due to nerve", "from nerve lesion", "ROM from nerve", "because of nerve"
  → false: "independent", "separate ROM", "not related to nerve", "not from nerve"`,
    valueType: "boolean",
    clinicalInferenceAllowed: false,
    clarification: {
      question:
        "Are the ROM restrictions due to the nerve lesion, or are they independent ROM findings?",
      candidateAnswers: ["Independent ROM", "Due to nerve lesion"],
      expectedAnswer: { kind: "boolean", factKey: "rom_from_nerve" },
    },
    required_when: {
      and: [
        { fact: "rom_joints", present: true },
        { fact: "nerve_selections", present: true },
      ],
    },
  },
];
