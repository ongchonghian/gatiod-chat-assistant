/**
 * Renal slot schema — ADR-0004.
 *
 * Single source of truth for renal fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (per-slot sex condition)
 *   - validateRenalReadinessFromSchema wrapper (cross-slot classifying-input check)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type RenalFactKey =
  | "renal_sex"
  | "renal_serum_creatinine"
  | "renal_creatinine_clearance"
  | "renal_ckd_stage"
  | "renal_clinical_severity"
  | "renal_solitary_kidney"
  | "renal_provisional_award";

// ── Schema ────────────────────────────────────────────────────────────────────

export const renalSlotSchema: SlotDefinition<RenalFactKey>[] = [
  // ── renal_sex ──────────────────────────────────────────────────────────────
  {
    factKey: "renal_sex",
    label: "Patient sex",
    description:
      'The patient\'s biological sex — required for eGFR and creatinine clearance calculations.\n\n' +
      'Valid values: "male" | "female"\n\n' +
      'Extract "male" for: "male", "man", "gentleman"\n' +
      'Extract "female" for: "female", "woman", "lady"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Sex must be explicitly stated. ' +
      'Do NOT infer from other clinical details.',
    valueType: "enum",
    allowedValues: ["male", "female"],
    clinicalInferenceAllowed: false,
    required_when: "always",
    clarification: {
      question: "What is the patient's sex? (Required for serum creatinine thresholds.)",
      candidateAnswers: ["Male", "Female"],
      expectedAnswer: { kind: "enum", factKey: "renal_sex", choices: ["male", "female"] },
    },
  },

  // ── renal_serum_creatinine ─────────────────────────────────────────────────
  {
    factKey: "renal_serum_creatinine",
    label: "Serum creatinine (µmol/L)",
    description:
      'Serum creatinine level in µmol/L.\n\n' +
      'Extraction rules:\n' +
      '  - Accept "creatinine 150 µmol/L", "SC 180", "serum creatinine: 220".\n' +
      '  - Unit may be absent — assume µmol/L when no unit is given in a renal context.\n' +
      '  - Do NOT extract creatinine clearance values (those go to renal_creatinine_clearance).\n' +
      '  - eGFR / GFR values are ambiguous — emit a clarification, do not map to serum creatinine.\n\n' +
      'Value: a positive number.',
    valueType: "number",
    unit: "µmol/L",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── renal_creatinine_clearance ─────────────────────────────────────────────
  {
    factKey: "renal_creatinine_clearance",
    label: "Creatinine clearance (mL/min)",
    description:
      'Cockcroft-Gault creatinine clearance in mL/min.\n\n' +
      'Extraction rules:\n' +
      '  - Accept "creatinine clearance 45", "CrCl 38 ml/min", "CC 52".\n' +
      '  - If both serum creatinine and creatinine clearance are mentioned, ' +
      'extract each to its own slot.\n' +
      '  - Do NOT map eGFR here without explicit disambiguation.\n\n' +
      'Value: a positive number.',
    valueType: "number",
    unit: "mL/min",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── renal_ckd_stage ────────────────────────────────────────────────────────
  {
    factKey: "renal_ckd_stage",
    label: "CKD stage (1–5)",
    description:
      'Chronic kidney disease stage as an integer 1 through 5.\n\n' +
      'Extraction rules:\n' +
      '  - Accept "CKD stage 3", "stage 4 CKD", "CKD3", "stage 3".\n' +
      '  - Value must be an integer in [1, 5].\n' +
      '  - Do NOT infer a CKD stage from a lab value — extract only when explicitly stated.',
    valueType: "number",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── renal_clinical_severity ────────────────────────────────────────────────
  {
    factKey: "renal_clinical_severity",
    label: "Clinical severity",
    description:
      'Symptom control severity bracket. Map the doctor\'s description to one of the four values:\n\n' +
      '  "none"                    — "no clinical symptoms", "intermittent", ' +
      '"not requiring treatment", "asymptomatic"\n' +
      '  "incompletely_controlled" — "incompletely controlled", "incomplete control", ' +
      '"partially controlled"\n' +
      '  "continuous_surveillance" — "continuous surveillance", "frequent treatment", ' +
      '"regular monitoring", "ongoing surveillance"\n' +
      '  "persisting"              — "persisting despite treatment", "persists despite", ' +
      '"not controlled", "refractory"\n\n' +
      'Extract only when the doctor explicitly states a severity description. ' +
      'Do NOT infer from lab values or other facts.',
    valueType: "enum",
    allowedValues: ["none", "incompletely_controlled", "continuous_surveillance", "persisting"],
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── renal_solitary_kidney ──────────────────────────────────────────────────
  {
    factKey: "renal_solitary_kidney",
    label: "Solitary kidney",
    description:
      'Whether the patient has a single functioning kidney.\n\n' +
      'true  — "solitary kidney", "single kidney", "one kidney", "nephrectomy", ' +
      '"unilateral kidney"\n' +
      'false — "both kidneys", "bilateral kidneys", "two kidneys", "no solitary kidney"\n\n' +
      'Omit entirely when not mentioned.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── renal_provisional_award ────────────────────────────────────────────────
  {
    factKey: "renal_provisional_award",
    label: "Provisional award",
    description:
      'Whether the PI award is provisional (interim) rather than final.\n\n' +
      'true  — "provisional award", "provisional", "not final", "interim award"\n' +
      'false — "final award", "confirmed award", "not provisional", "permanent award"\n\n' +
      'Omit entirely when not mentioned.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },
];
