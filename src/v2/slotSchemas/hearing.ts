/**
 * Hearing slot schema — ADR-0004.
 *
 * Single source of truth for hearing fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * Two pathways:
 *   1. NID (noise-induced deafness): both AHLs + age required.
 *   2. Injury/accident: affected ear + AHL for that ear required.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (per-slot conditions)
 *   - validateHearingReadinessFromSchema wrapper (cross-slot AHL + age checks)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type HearingFactKey =
  | "hearing_path"
  | "hearing_left_ear_ahl"
  | "hearing_right_ear_ahl"
  | "hearing_age"
  | "hearing_affected_ears"
  | "hearing_occupational_years"
  | "hearing_tinnitus";

// ── Schema ────────────────────────────────────────────────────────────────────

export const hearingSlotSchema: SlotDefinition<HearingFactKey>[] = [
  // ── hearing_path ────────────────────────────────────────────────────────────
  {
    factKey: "hearing_path",
    label: "Hearing loss pathway",
    description:
      'Whether this is noise-induced deafness (NID) or injury/accident hearing loss.\n\n' +
      'Valid values:\n' +
      '  "nid"    — "noise-induced", "NID", "occupational deafness", ' +
      '"noise exposure", "noise damage", "noise trauma"\n' +
      '  "injury" — "injury", "accident", "trauma", "blast", "head injury", ' +
      '"perforation", "barotrauma"\n\n' +
      'Extract from explicit pathway mentions. Do NOT infer from symptoms alone.',
    valueType: "enum",
    allowedValues: ["nid", "injury"],
    clinicalInferenceAllowed: true,
    required_when: "always",
    clarification: {
      question: "Is this noise-induced deafness (NID) or injury/accident hearing loss?",
      candidateAnswers: ["Noise-Induced Deafness (NID)", "Injury/Accident"],
      expectedAnswer: {
        kind: "enum",
        factKey: "hearing_path",
        choices: ["nid", "injury"],
      },
    },
  },

  // ── hearing_left_ear_ahl ─────────────────────────────────────────────────────
  {
    factKey: "hearing_left_ear_ahl",
    label: "Left ear AHL (dB)",
    description:
      'Average hearing loss in decibels for the left ear.\n\n' +
      'Extraction: accept "left ear 65 dB", "left AHL 65", "left 65 dB", ' +
      '"left ear hearing loss: 70".\n' +
      'Unit: decibels (dB). Omit unit if not given — assume dB in hearing context.\n' +
      'Value: a positive number.\n\n' +
      'Required for NID (both ears needed). Required for injury if left is the affected ear.',
    valueType: "number",
    unit: "dB",
    clinicalInferenceAllowed: true,
    required_when: { fact: "hearing_path", eq: "nid" },
    clarification: {
      question: "What is the average hearing loss (AHL) in dB for the left ear?",
      candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
      expectedAnswer: {
        kind: "number",
        factKey: "hearing_left_ear_ahl",
        min: 0,
        max: 130,
        unit: "dB",
      },
    },
  },

  // ── hearing_right_ear_ahl ────────────────────────────────────────────────────
  {
    factKey: "hearing_right_ear_ahl",
    label: "Right ear AHL (dB)",
    description:
      'Average hearing loss in decibels for the right ear.\n\n' +
      'Extraction: accept "right ear 65 dB", "right AHL 65", "right 65 dB", ' +
      '"right ear hearing loss: 70".\n' +
      'Unit: decibels (dB). Omit unit if not given — assume dB in hearing context.\n' +
      'Value: a positive number.\n\n' +
      'Required for NID (both ears needed). Required for injury if right is the affected ear.',
    valueType: "number",
    unit: "dB",
    clinicalInferenceAllowed: true,
    required_when: { fact: "hearing_path", eq: "nid" },
    clarification: {
      question: "What is the average hearing loss (AHL) in dB for the right ear?",
      candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
      expectedAnswer: {
        kind: "number",
        factKey: "hearing_right_ear_ahl",
        min: 0,
        max: 130,
        unit: "dB",
      },
    },
  },

  // ── hearing_age ─────────────────────────────────────────────────────────────
  {
    factKey: "hearing_age",
    label: "Patient age (years)",
    description:
      'The patient\'s age in years. Required for NID to apply the presbycusis deduction.\n\n' +
      'Extraction: accept "age 55", "55 years old", "55 yo", "55 y/o".\n' +
      'Value: a positive integer (typically 20–90).',
    valueType: "number",
    unit: "years",
    clinicalInferenceAllowed: true,
    required_when: { fact: "hearing_path", eq: "nid" },
    clarification: {
      question: "What is the patient's age? (Required for the presbycusis deduction in NID calculations.)",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "number",
        factKey: "hearing_age",
        min: 18,
        max: 100,
        unit: "years",
      },
    },
  },

  // ── hearing_affected_ears ────────────────────────────────────────────────────
  {
    factKey: "hearing_affected_ears",
    label: "Affected ear (injury pathway)",
    description:
      'Which ear is affected for the injury/accident pathway.\n\n' +
      'Valid values: "left" | "right"\n\n' +
      'Extraction: accept "left ear", "left side", "left hearing", ' +
      '"in the left ear", "on the left", "right-sided hearing loss", etc.\n\n' +
      'Only relevant when hearing_path is "injury".',
    valueType: "enum",
    allowedValues: ["left", "right"],
    clinicalInferenceAllowed: true,
    required_when: { fact: "hearing_path", eq: "injury" },
    clarification: {
      question: "Which ear is affected by the injury?",
      candidateAnswers: ["Left ear", "Right ear"],
      expectedAnswer: {
        kind: "enum",
        factKey: "hearing_affected_ears",
        choices: ["left", "right"],
      },
    },
  },

  // ── hearing_occupational_years ───────────────────────────────────────────────
  {
    factKey: "hearing_occupational_years",
    label: "Years of occupational noise exposure",
    description:
      'Number of years of occupational noise exposure. Optional supplementary fact.\n\n' +
      'Extraction: accept "25 years of noise exposure", "exposed for 20 years", ' +
      '"20 years occupational exposure".\n' +
      'Value: a positive integer.',
    valueType: "number",
    unit: "years",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── hearing_tinnitus ─────────────────────────────────────────────────────────
  {
    factKey: "hearing_tinnitus",
    label: "Tinnitus present",
    description:
      'Whether tinnitus is present.\n\n' +
      'true — "tinnitus", "ringing in ears", "ear ringing", "buzzing in ears"\n' +
      'false — "no tinnitus", "without tinnitus"\n\n' +
      'Omit entirely when not mentioned.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },
];
