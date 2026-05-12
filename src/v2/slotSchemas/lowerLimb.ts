/**
 * Lower limb slot schema — ADR-0004.
 *
 * Single source of truth for lower limb fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * Lower limb mirrors the upper limb structure: side + ROM + nerve + amputation
 * + DBE, with additional shortening_cm and toe amputation per-level detail.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (per-slot conditions)
 *   - validateLowerLimbReadinessFromSchema wrapper (cross-slot stream check + gates)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type LowerLimbFactKey =
  | "side"
  | "rom_joints"
  | "rom_from_nerve"
  | "nerve_selections"
  | "leg_amputation"
  | "toe_amputations"
  | "shortening_cm"
  | "dbe_selections";

// ── Schema ────────────────────────────────────────────────────────────────────

export const lowerLimbSlotSchema: SlotDefinition<LowerLimbFactKey>[] = [
  // ── side ────────────────────────────────────────────────────────────────────
  {
    factKey: "side",
    label: "Affected side",
    description:
      'Which lower limb is affected. Extract "left" or "right" when explicitly stated.\n' +
      'Bilateral mentions ("both legs", "bilateral") are not extractable as a single side — ' +
      "emit a clarification PendingObservation; do not guess.",
    valueType: "enum",
    allowedValues: ["left", "right"],
    clinicalInferenceAllowed: true,
    required_when: "always",
    clarification: {
      question: "Which lower limb is affected — left or right?",
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
  hip, knee, ankle, subtalar,
  great_toe_mtp, great_toe_ip, lesser_toes_mtp

Valid directionKeys:
  flexion, extension, abduction, adduction,
  internal_rotation, external_rotation,
  flexion_contracture,
  dorsiflexion, plantarflexion,
  inversion, eversion

Clinical note — ankle direction aliases:
  When joint is "ankle", the doctor may say "extension" meaning dorsiflexion,
  or "flexion" meaning plantarflexion. Normalise these to the engine keys
  (dorsiflexion, plantarflexion) when the ankle joint context is clear.

Extraction rules:
  - Only extract an angle when a named direction appears in the same clause.
    "knee flexion 90°" → { knee: { isAnkylosed: false, measurements: { flexion: 90 } } }
  - A bare angle with no direction ("90 degrees" alone) → PendingObservation asking
    which direction it applies to. Do NOT infer the direction.
  - isAnkylosed: true only when the doctor uses "ankylosed", "fixed at", or "fused".
  - Word-form angles ("ninety degrees") map to their numeric equivalent.
  - Multiple joints may be extracted from a single utterance.`,
    valueType: "object",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── nerve_selections ────────────────────────────────────────────────────────
  {
    factKey: "nerve_selections",
    label: "Nerve deficit findings",
    description: `Array of peripheral nerve findings.

Shape: Array<{ nerveKey: string; deficitType: "sensory" | "motor" | "combined"; lossType: "total" | "partial" }>

Valid nerveKeys:
  lumbosacral_l3_s1, femoral, obturator,
  superior_gluteal, inferior_gluteal,
  lateral_femoral_cutaneous,
  sciatic, common_peroneal,
  superficial_peroneal, deep_peroneal,
  tibial, sural,
  medial_plantar, lateral_plantar

Extraction rules:
  - nerveKey IS extractable — the nerve name is always explicitly stated.
  - IMPORTANT: "tibial plateau" is a bone, not the tibial nerve. Do not extract "tibial"
    from "tibial plateau". Similarly "femoral neck/head/condyle" refers to the femur bone,
    not the femoral nerve.
  - deficitType (sensory / motor / combined): D2 boundary — clinicalInferenceAllowed: false.
    Must be stated explicitly. If missing, emit a PendingObservation using the
    clarification spec below (substitute the actual nerve name for "[nerve]").
  - lossType (total / partial): D2 boundary — clinicalInferenceAllowed: false.
    Must be stated explicitly. If missing, include in the same PendingObservation.
  - Multiple nerves may be extracted from a single utterance.`,
    valueType: "array",
    clinicalInferenceAllowed: false,
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

  // ── leg_amputation ──────────────────────────────────────────────────────────
  {
    factKey: "leg_amputation",
    label: "Leg amputation level",
    description: `Level of lower leg amputation.

Valid values: "none" | "above_knee" | "below_knee" | "syme" | "midtarsal" | "transmetatarsal"

Synonyms:
  "trans-femoral" / "transhumeral"             → above_knee
  "AK amputation" / "above the knee"           → above_knee
  "trans-tibial" / "BK amputation"             → below_knee
  "below the knee"                             → below_knee
  "Syme's amputation"                          → syme
  "Chopart" / "midtarsal"                      → midtarsal
  "transmetatarsal" / "trans-metatarsal"       → transmetatarsal

Set "none" only when the doctor explicitly negates amputation ("no amputation", "without amputation").
Omit this fact entirely when amputation is not mentioned.`,
    valueType: "enum",
    allowedValues: ["none", "above_knee", "below_knee", "syme", "midtarsal", "transmetatarsal"],
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── toe_amputations ─────────────────────────────────────────────────────────
  {
    factKey: "toe_amputations",
    label: "Toe amputations",
    description: `Per-toe amputation levels.

Shape: Record<toeKey, levelValue>
toeKeys: great, second, third, fourth, fifth

levelValues — GREAT TOE (use engine IDs exactly):
  "ip"         = one phalanx (IP level, distal phalanx only)
  "mtp"        = both phalanges (MTP level)
  "metatarsal" = both phalanges + 1st metatarsal
  "none"       = no amputation

levelValues — OTHER TOES (second–fifth):
  "dip"        = one phalanx (DIP level)
  "pip"        = two phalanges (PIP level)
  "mtp"        = three phalanges (MTP level)
  "metatarsal" = three phalanges + Nth metatarsal
  "none"       = no amputation

Extraction rules:
  - Only populate a toe key when both the toe name and level/phalanx count are explicit.
  - "Loss of left great toe — both phalanges" → { great: "mtp" }
  - "Loss of right great toe — one phalanx" → { great: "ip" }
  - "Loss of left 2nd toe — one phalanx" → { second: "dip" }
  - "Loss of left 2nd toe — two phalanges and 2nd metatarsal" → { second: "metatarsal" }
  - "Loss of all toes" → all five at "mtp"
  - Toe name mentions in a ROM context (ankylosis, joint ROM) are NOT amputation candidates.`,
    valueType: "object",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── shortening_cm ───────────────────────────────────────────────────────────
  {
    factKey: "shortening_cm",
    label: "Limb length discrepancy (cm)",
    description: `Lower limb length discrepancy in centimetres.

Extraction rules:
  - Triggered by keywords: "shortening", "limb length discrepancy", "leg length discrepancy".
  - Accept "1.5 cm", "2 cm", "discrepancy: 1.5" (bare number after keyword treated as cm).
  - Value: a positive number (0 is allowed but means no shortening).
  - Only extract when the keyword and a numeric value are both present.
    A shortening keyword without a number → PendingObservation asking for the cm value.

Value: a number in centimetres.`,
    valueType: "number",
    unit: "cm",
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
  - conditionId must match a known DBE condition from the lower limb ontology.
    Do NOT fabricate condition IDs. If unsure of the exact ID, emit a PendingObservation.
  - selectedPercent is D2 boundary — clinicalInferenceAllowed: false. The PI%
    must be explicitly stated or selected from the workbook range. If the condition
    is named but no PI% is given, emit a PendingObservation (chips populated at
    runtime from the condition's min/max range).
  - selectedAnatomicalKey is optional — only set when the doctor specifies a
    sub-anatomical location for conditions that have anatomical variants.`,
    valueType: "array",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the PI percentage for this diagnosis-based injury?",
      candidateAnswers: [],
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
