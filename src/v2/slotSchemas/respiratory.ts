/**
 * Respiratory slot schema — ADR-0004.
 *
 * Single source of truth for respiratory fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * Three diagnosis pathways:
 *   1. Standard (default): at least one PFT value required.
 *   2. Occupational asthma: three prerequisites + medication class required,
 *      then PFT.
 *   3. Asbestosis/silicosis: PFT, or radiological confirmation + profusion.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (per-slot conditions)
 *   - validateRespiratoryReadinessFromSchema wrapper (cross-slot PFT check)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type RespiratoryFactKey =
  | "resp_diagnosis"
  | "resp_fvc"
  | "resp_fev1"
  | "resp_dlco"
  | "resp_vo2max"
  | "resp_dyspnoea"
  | "resp_asthma_daily_maintenance"
  | "resp_asthma_transferred"
  | "resp_asthma_unlikely_improvement"
  | "resp_asthma_medication"
  | "resp_asbestosis_radiological"
  | "resp_asbestosis_profusion";

// ── Schema ────────────────────────────────────────────────────────────────────

export const respiratorySlotSchema: SlotDefinition<RespiratoryFactKey>[] = [
  // ── resp_diagnosis ──────────────────────────────────────────────────────────
  {
    factKey: "resp_diagnosis",
    label: "Respiratory diagnosis type",
    description:
      'The respiratory diagnosis pathway. Defaults to "standard" if not explicitly stated.\n\n' +
      'Valid values:\n' +
      '  "standard"             — all other respiratory conditions (trauma, inhalation, infection,\n' +
      '                           chronic lung disease, COPD, fibrosis, etc.)\n' +
      '  "occupational_asthma"  — "occupational asthma" (must be explicitly stated)\n' +
      '  "asbestosis_silicosis" — "asbestosis", "silicosis", "asbestos-related", "silica exposure"\n\n' +
      'Do NOT infer the pathway from symptoms alone. Extract only when the doctor names it.',
    valueType: "enum",
    allowedValues: ["standard", "occupational_asthma", "asbestosis_silicosis"],
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── PFT values ──────────────────────────────────────────────────────────────
  {
    factKey: "resp_fvc",
    label: "FVC (% predicted)",
    description:
      'Forced vital capacity as a percentage of predicted. Accept "FVC 65", "FVC: 65%", ' +
      '"FVC = 65% predicted", "FVC of 65".\n' +
      'Negative lookahead: do NOT extract FEV1/FVC ratio values here (e.g. "FEV1/FVC 75" does not contain FVC alone).\n' +
      'Value: a positive number (typically 0–120).',
    valueType: "number",
    unit: "% predicted",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "resp_fev1",
    label: "FEV1 (% predicted)",
    description:
      'Forced expiratory volume in 1 second as a percentage of predicted. ' +
      'Accept "FEV1 72", "FEV1: 72%", "FEV1 = 72% predicted". ' +
      'Do NOT extract the FEV1/FVC ratio (e.g. "FEV1/FVC 75" does not contain a standalone FEV1).\n' +
      'Value: a positive number (typically 0–120).',
    valueType: "number",
    unit: "% predicted",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "resp_dlco",
    label: "DLCO (% predicted)",
    description:
      'Diffusing capacity of the lung for carbon monoxide as a percentage of predicted. ' +
      'Accept "DLCO 58", "DLCO: 58%", "diffusing capacity 58%".\n' +
      'Value: a positive number.',
    valueType: "number",
    unit: "% predicted",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "resp_vo2max",
    label: "VO2 Max (% predicted)",
    description:
      'Maximum oxygen consumption as a percentage of predicted. ' +
      'Accept "VO2 max 45", "VO2Max 45%", "VO2 = 45% predicted".\n' +
      'Value: a positive number.',
    valueType: "number",
    unit: "% predicted",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── resp_dyspnoea ───────────────────────────────────────────────────────────
  {
    factKey: "resp_dyspnoea",
    label: "Dyspnoea severity",
    description:
      'Breathlessness severity. Map the doctor\'s description to one of the four values:\n\n' +
      '  "none"               — "no dyspnoea", "no breathlessness", "no SOB"\n' +
      '  "on_severe_exertion" — "dyspnoea on severe exertion", "SOB on heavy activity"\n' +
      '  "on_moderate_exertion" — "dyspnoea on climbing stairs", "SOB on moderate exertion"\n' +
      '  "on_minimal_exertion"  — "dyspnoea at rest", "SOB on minimal exertion"\n\n' +
      'Extract only when explicitly stated. Do NOT infer from other symptoms.',
    valueType: "enum",
    allowedValues: ["none", "on_severe_exertion", "on_moderate_exertion", "on_minimal_exertion"],
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── Occupational asthma prerequisites ──────────────────────────────────────
  {
    factKey: "resp_asthma_daily_maintenance",
    label: "Occupational asthma: daily maintenance therapy required",
    description:
      'Whether the patient requires daily maintenance medication for occupational asthma.\n\n' +
      'true — "requiring daily maintenance", "maintenance bronchodilators", ' +
      '"requires inhaled steroids", "requiring low-dose inhaled steroids", ' +
      '"requiring oral steroids", "maintenance therapy required"\n\n' +
      'false — explicitly stated that no maintenance is required\n\n' +
      'Extract only when the doctor explicitly confirms this prerequisite.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: { fact: "resp_diagnosis", eq: "occupational_asthma" },
    clarification: {
      question: "Does the patient require daily maintenance respiratory medication (bronchodilators or steroids)?",
      candidateAnswers: ["Yes, requires daily maintenance", "No maintenance required"],
      expectedAnswer: { kind: "boolean", factKey: "resp_asthma_daily_maintenance" },
    },
  },

  {
    factKey: "resp_asthma_transferred",
    label: "Occupational asthma: transferred from exposure ≥1 year",
    description:
      'Whether the patient has been transferred away from the causative occupational exposure ' +
      'for at least one year.\n\n' +
      'true — "transferred from exposure", "removed from exposure", "≥1 year post-transfer", ' +
      '"despite transfer from exposure ≥1 year", "1 year since removal"\n\n' +
      'false — explicitly stated that transfer has not occurred or was less than 1 year ago\n\n' +
      'Extract only when explicitly confirmed.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: { fact: "resp_diagnosis", eq: "occupational_asthma" },
    clarification: {
      question: "Has the patient been transferred away from occupational exposure for at least 1 year?",
      candidateAnswers: ["Yes, transferred ≥1 year", "No"],
      expectedAnswer: { kind: "boolean", factKey: "resp_asthma_transferred" },
    },
  },

  {
    factKey: "resp_asthma_unlikely_improvement",
    label: "Occupational asthma: unlikely further improvement",
    description:
      'Whether further improvement is unlikely (condition is stable/permanent).\n\n' +
      'true — "unlikely further improvement", "no further improvement expected", ' +
      '"not likely to improve", "improvement unlikely", or implied by ≥1 year ' +
      'post-transfer on maintenance medication\n\n' +
      'false — explicitly stated that improvement is expected\n\n' +
      'Extract only when explicitly confirmed or strongly implied by the ≥1 year transfer context.',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: { fact: "resp_diagnosis", eq: "occupational_asthma" },
    clarification: {
      question: "Is further improvement in the patient's occupational asthma unlikely?",
      candidateAnswers: ["Yes, improvement unlikely", "No, improvement possible"],
      expectedAnswer: { kind: "boolean", factKey: "resp_asthma_unlikely_improvement" },
    },
  },

  {
    factKey: "resp_asthma_medication",
    label: "Occupational asthma: maintenance medication class",
    description:
      'The maintenance medication class for occupational asthma. This determines the PI% ' +
      'directly — do NOT guess or infer from symptom severity.\n\n' +
      'Valid values:\n' +
      '  "bronchodilators"     — "bronchodilators only", "SABA only", "salbutamol only"\n' +
      '  "low_dose_steroids"   — "low-dose inhaled steroids", "low dose ICS"\n' +
      '  "high_dose_steroids"  — "high-dose inhaled steroids", ">800 µg/day", ' +
      '"combination therapy"\n' +
      '  "oral_steroids"       — "oral steroids", "prednisolone", "systemic steroids"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. The medication class must be ' +
      'explicitly stated. If not stated, emit a PendingObservation.',
    valueType: "enum",
    allowedValues: ["bronchodilators", "low_dose_steroids", "high_dose_steroids", "oral_steroids"],
    clinicalInferenceAllowed: false,
    clarification: {
      question: "Which maintenance medication is the patient on for their occupational asthma?",
      candidateAnswers: [
        "Bronchodilators only",
        "Low-dose inhaled steroids",
        "High-dose (>800 µg/day) inhaled steroid or combination therapy",
        "Oral steroids",
      ],
      expectedAnswer: {
        kind: "enum",
        factKey: "resp_asthma_medication",
        choices: ["bronchodilators", "low_dose_steroids", "high_dose_steroids", "oral_steroids"],
      },
    },
    required_when: { fact: "resp_diagnosis", eq: "occupational_asthma" },
  },

  // ── Asbestosis/silicosis qualifiers ─────────────────────────────────────────
  {
    factKey: "resp_asbestosis_radiological",
    label: "Asbestosis: radiologically definite",
    description:
      'Whether asbestosis/silicosis has been radiologically confirmed.\n\n' +
      'true — "radiologically definite", "confirmed on imaging", "definite on CT/CXR", ' +
      '"confirmed radiologically"\n\n' +
      'false — not radiologically confirmed\n\n' +
      'Only relevant when resp_diagnosis is "asbestosis_silicosis".',
    valueType: "boolean",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  {
    factKey: "resp_asbestosis_profusion",
    label: "Asbestosis: ILO profusion band",
    description:
      'ILO profusion score band for asbestosis/silicosis.\n\n' +
      'Valid values:\n' +
      '  "at_least_1_1" — "profusion ≥ 1/1", "1/1 or above", "at least 1/1"\n' +
      '  "below_1_1"    — "profusion < 1/1", "below 1/1", "profusion 0/1 or 1/0"\n\n' +
      'Only extract when ILO profusion is explicitly stated. Do NOT infer from ' +
      '"radiologically confirmed" alone.',
    valueType: "enum",
    allowedValues: ["below_1_1", "at_least_1_1"],
    clinicalInferenceAllowed: true,
    required_when: "never",
  },
];
