/**
 * Visual slot schema — ADR-0004.
 *
 * Single source of truth for visual fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * Policy fix §2 applied: diplopia zone values are "uncorrectable", "central_30",
 * "30_to_60", "beyond_60", "none" — NOT monocular/binocular.
 *
 * Per-eye facts: acuity ID, visual field ID, functional modifiers, specific
 * conditions, enucleated flag. Diplopia is a single shared fact.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (all "never" — cross-slot "at least one fact" check handles this)
 *   - validateVisualReadinessFromSchema wrapper
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type VisualFactKey =
  | "visual_left_acuity_id"
  | "visual_right_acuity_id"
  | "visual_left_field_id"
  | "visual_right_field_id"
  | "visual_left_modifiers"
  | "visual_right_modifiers"
  | "visual_left_conditions"
  | "visual_right_conditions"
  | "visual_diplopia_id"
  | "visual_left_enucleated"
  | "visual_right_enucleated";

// ── Schema ────────────────────────────────────────────────────────────────────

export const visualSlotSchema: SlotDefinition<VisualFactKey>[] = [

  // ── Acuity ───────────────────────────────────────────────────────────────────

  {
    factKey: "visual_left_acuity_id",
    label: "Left eye visual acuity (Snellen ID)",
    description: `Snellen visual acuity ID for the left eye.

Valid Snellen IDs (format 6_N where N is the denominator):
  6_6, 6_7.5, 6_9, 6_12, 6_15, 6_18, 6_24, 6_30, 6_36, 6_48, 6_60, lt_6_60

Special cases:
  "lt_6_60" — for NLP (no light perception), HM (hand movements), CF (counting fingers),
  any "<6/60", or legally blind acuity

Extraction rules:
  - Extract from Snellen notation: "6/12", "6/6", "6/24", etc.
  - "left eye 6/18" → "6_18", "right eye 6/9" → "6_9"
  - Word denominator: "6 over 12" → "6_12"
  - Context: look for "left", "LE", "OS" to assign to left eye.
  - If only one eye is mentioned without laterality, ask for clarification.`,
    valueType: "string",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "visual_right_acuity_id",
    label: "Right eye visual acuity (Snellen ID)",
    description: `Snellen visual acuity ID for the right eye.

Uses the same valid IDs as visual_left_acuity_id.

Context: look for "right", "RE", "OD" to assign to right eye.`,
    valueType: "string",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── Visual field ─────────────────────────────────────────────────────────────

  {
    factKey: "visual_left_field_id",
    label: "Left eye visual field (field ID)",
    description: `Visual field loss ID for the left eye.

Common field IDs (from VISUAL_FIELD_LOSS engine data):
  "field_full"     — full visual field, normal, ≥ 120°
  "field_quadrant" — quadrantanopia, one quadrant loss
  "field_half"     — hemianopia, half field loss
  "field_tunnel"   — tunnel vision, severe constriction
  "field_none"     — no useful field remaining

Extract from explicit visual field descriptions. The full list of IDs is
populated at runtime from the engine's VISUAL_FIELD_LOSS data.

Context: look for "left", "LE", "OS" to assign to left eye.`,
    valueType: "string",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "visual_right_field_id",
    label: "Right eye visual field (field ID)",
    description: `Visual field loss ID for the right eye.

Uses the same valid IDs as visual_left_field_id.

Context: look for "right", "RE", "OD" to assign to right eye.`,
    valueType: "string",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── Functional modifiers ─────────────────────────────────────────────────────

  {
    factKey: "visual_left_modifiers",
    label: "Left eye functional modifiers",
    description: `Array of functional modifier IDs for the left eye.

Modifiers describe how the impairment affects function beyond acuity/field.
Valid modifier IDs come from the engine's FUNCTIONAL_MODIFIERS data.
Common modifiers include glare sensitivity, contrast sensitivity, photophobia, etc.

Extract only when the doctor explicitly mentions a functional modifier that
matches a known engine modifier ID. If uncertain which ID applies, do not guess.

Value: Array<string> — array of modifier ID strings.`,
    valueType: "array",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "visual_right_modifiers",
    label: "Right eye functional modifiers",
    description: `Array of functional modifier IDs for the right eye.

Uses the same modifier IDs as visual_left_modifiers.`,
    valueType: "array",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── Specific conditions ──────────────────────────────────────────────────────

  {
    factKey: "visual_left_conditions",
    label: "Left eye specific ophthalmic conditions",
    description: `Array of specific ophthalmic condition IDs for the left eye.

Conditions are named ophthalmic diagnoses that have specific PI% impacts.
Valid condition IDs come from the engine's SPECIFIC_CONDITIONS data.
Examples: glaucoma, cataracts, macular degeneration, diabetic retinopathy, etc.

Extract only when the doctor names a specific condition that matches a known
engine condition ID. Do NOT fabricate condition IDs.

Value: Array<string> — array of condition ID strings.`,
    valueType: "array",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "visual_right_conditions",
    label: "Right eye specific ophthalmic conditions",
    description: `Array of specific ophthalmic condition IDs for the right eye.

Uses the same condition IDs as visual_left_conditions.`,
    valueType: "array",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── Diplopia ─────────────────────────────────────────────────────────────────

  {
    factKey: "visual_diplopia_id",
    label: "Diplopia zone",
    description: `Diplopia (double vision) zone ID.

Policy fix §2: valid diplopia zones are uncorrectable, central_30, 30_to_60,
beyond_60, and none — NOT monocular/binocular.

D2 boundary — clinicalInferenceAllowed: false. The diplopia zone must be
explicitly stated or selected from offered chips.

Valid zone IDs (from DIPLOPIA_OPTIONS engine data):
  "uncorrectable" — uncorrectable diplopia
  "central_30"    — diplopia in central 30° field
  "30_to_60"      — diplopia between 30° and 60°
  "beyond_60"     — diplopia beyond 60°
  "none"          — no diplopia

Extract the zone from explicit zone mentions ("central 30 degrees", "beyond 60").
Do NOT infer the zone from general "double vision" alone — emit a PendingObservation
asking which zone applies.`,
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "In which zone does the diplopia (double vision) occur?",
      candidateAnswers: [
        "Uncorrectable diplopia",
        "Diplopia in central 30° field",
        "Diplopia between 30° and 60°",
        "Diplopia beyond 60°",
        "No diplopia",
      ],
      expectedAnswer: {
        kind: "enum",
        factKey: "visual_diplopia_id",
        choices: ["uncorrectable", "central_30", "30_to_60", "beyond_60", "none"],
      },
    },
    required_when: "never",
  },

  // ── Enucleated ───────────────────────────────────────────────────────────────

  {
    factKey: "visual_left_enucleated",
    label: "Left eye enucleated",
    description:
      'Whether the left eye has been surgically removed.\n\n' +
      'true — "left eye enucleated", "enucleation of left eye", "left eye removed", ' +
      '"prosthetic left eye", "left evisceration"\n\n' +
      'false — left eye is present\n\n' +
      'Omit when not mentioned.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "visual_right_enucleated",
    label: "Right eye enucleated",
    description:
      'Whether the right eye has been surgically removed.\n\n' +
      'true — "right eye enucleated", "enucleation of right eye", "right eye removed", ' +
      '"prosthetic right eye", "right evisceration"\n\n' +
      'false — right eye is present\n\n' +
      'Omit when not mentioned.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },
];
