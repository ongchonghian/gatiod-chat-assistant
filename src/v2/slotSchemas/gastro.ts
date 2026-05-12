/**
 * Gastro-digestive slot schema — ADR-0004.
 *
 * Single source of truth for gastro-digestive fact keys, value types, D2
 * inference boundary, clarification specs, and required_when conditions.
 *
 * Policy fix §3 applied: all four subsystems are represented (upper GI,
 * colon/rectum/anus, liver/biliary, hernia). The legacy slot policy was
 * missing upper GI and hernia.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (per-slot conditions)
 *   - validateGastroReadinessFromSchema wrapper (cross-slot bracket + PI check)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type GastroFactKey =
  | "gastro_subsystem"
  | "gastro_colonal_subpath"
  | "gastro_liver_biliary_subpath"
  | "gastro_bracket_index"
  | "gastro_weight_loss_percent"
  | "gastro_pi_percent"
  | "gastro_clinical_justification";

// ── Schema ────────────────────────────────────────────────────────────────────

export const gastroSlotSchema: SlotDefinition<GastroFactKey>[] = [
  // ── gastro_subsystem ────────────────────────────────────────────────────────
  {
    factKey: "gastro_subsystem",
    label: "Gastro-digestive subsystem",
    description:
      'Which gastro-digestive subsystem applies. Map the doctor\'s description to one of four values.\n\n' +
      'Valid values:\n' +
      '  "upperGI"          — oesophagus, stomach, gastric, duodenum, small intestine, ' +
      'pancreas, pylori, GORD, peptic ulcer, reflux\n' +
      '  "colonicRectalAnal" — colon, colonic, rectal, rectum, anal, anus, faecal/fecal ' +
      'incontinence, Crohn\'s, colitis, large intestine, IBS, inflammatory bowel, diverticular\n' +
      '  "liverBiliary"     — liver, hepatic, hepatitis, cirrhosis, ascites, biliary, ' +
      'bile duct, cholangitis, jaundice\n' +
      '  "hernia"           — hernia, herniation, inguinal, femoral, umbilical, ' +
      'incisional, abdominal wall defect\n\n' +
      'Extract the most specific subsystem mentioned. If ambiguous, emit a PendingObservation.',
    valueType: "enum",
    allowedValues: ["upperGI", "colonicRectalAnal", "liverBiliary", "hernia"],
    clinicalInferenceAllowed: true,
    required_when: "always",
    clarification: {
      question: "Which gastro-digestive subsystem applies?",
      candidateAnswers: ["Upper GI", "Colon/rectum/anus", "Liver/biliary", "Hernia"],
      expectedAnswer: {
        kind: "enum",
        factKey: "gastro_subsystem",
        choices: ["upperGI", "colonicRectalAnal", "liverBiliary", "hernia"],
      },
    },
  },

  // ── gastro_colonal_subpath ──────────────────────────────────────────────────
  {
    factKey: "gastro_colonal_subpath",
    label: "Colonal sub-path",
    description:
      'Sub-classification for colonic/rectal/anal disease. Required when gastro_subsystem is "colonicRectalAnal".\n\n' +
      'Valid values:\n' +
      '  "colonicRectal" — colon, colonic, rectal, rectum disease\n' +
      '  "anal"          — anal, anus, perianal, anorectal, faecal incontinence\n\n' +
      'Only extract when the subsystem is colonicRectalAnal.',
    valueType: "enum",
    allowedValues: ["colonicRectal", "anal"],
    clinicalInferenceAllowed: true,
    required_when: { fact: "gastro_subsystem", eq: "colonicRectalAnal" },
    clarification: {
      question: "Is this colonic/rectal disease or anal disease?",
      candidateAnswers: ["Colonic & Rectal Disease", "Anal Disease"],
      expectedAnswer: {
        kind: "enum",
        factKey: "gastro_colonal_subpath",
        choices: ["colonicRectal", "anal"],
      },
    },
  },

  // ── gastro_liver_biliary_subpath ────────────────────────────────────────────
  {
    factKey: "gastro_liver_biliary_subpath",
    label: "Liver/biliary sub-path",
    description:
      'Sub-classification for liver/biliary disease. Required when gastro_subsystem is "liverBiliary".\n\n' +
      'Valid values:\n' +
      '  "liver"   — liver disease, hepatic disease, hepatitis, cirrhosis, ascites\n' +
      '  "biliary" — biliary tract disease, bile duct, cholangitis, biliary obstruction\n\n' +
      'Only extract when the subsystem is liverBiliary.',
    valueType: "enum",
    allowedValues: ["liver", "biliary"],
    clinicalInferenceAllowed: true,
    required_when: { fact: "gastro_subsystem", eq: "liverBiliary" },
    clarification: {
      question: "Is this liver disease or biliary tract disease?",
      candidateAnswers: ["Liver Disease", "Biliary Tract Disease"],
      expectedAnswer: {
        kind: "enum",
        factKey: "gastro_liver_biliary_subpath",
        choices: ["liver", "biliary"],
      },
    },
  },

  // ── gastro_bracket_index ────────────────────────────────────────────────────
  {
    factKey: "gastro_bracket_index",
    label: "Severity class (bracket index 0–3)",
    description: `Severity class index for the gastro-digestive impairment.

Value: an integer 0–3 corresponding to Class I–IV.
  0 = Class I (minimal)
  1 = Class II (mild)
  2 = Class III (moderate)
  3 = Class IV (severe)

Extraction: accept "Class 1", "Class I", "Class II", "Class 3", etc.
Convert roman numerals to zero-based index (I→0, II→1, III→2, IV→3).

D2 boundary — clinicalInferenceAllowed: false. The doctor or workbook must
state the severity class. Do NOT infer from symptom descriptions alone.
The chips are populated at runtime from the active bracket list for the subsystem.`,
    valueType: "number",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "Which severity class applies to this gastro-digestive impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "number",
        factKey: "gastro_bracket_index",
        min: 0,
        max: 3,
      },
    },
    required_when: "always",
  },

  // ── gastro_weight_loss_percent ──────────────────────────────────────────────
  {
    factKey: "gastro_weight_loss_percent",
    label: "Weight loss (%)",
    description:
      'Percentage weight loss (for upper GI conditions). ' +
      'Accept "weight loss 15%", "weight loss: 15", "15% weight loss".\n' +
      'Value: a positive number representing percentage body weight lost.',
    valueType: "number",
    unit: "%",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },

  // ── gastro_pi_percent ───────────────────────────────────────────────────────
  {
    factKey: "gastro_pi_percent",
    label: "PI percentage",
    description: `Doctor-selected PI percentage for the gastro-digestive impairment.

D2 boundary — clinicalInferenceAllowed: false. The PI% must be explicitly
stated or selected by the doctor from the offered bracket range.
Do NOT calculate or infer the PI% from the severity class alone.

Accept explicit statements: "PI 15%", "PI: 15", "15% permanent incapacity".
If the PI% is not stated, emit a PendingObservation with the bracket range chips.`,
    valueType: "number",
    unit: "%",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What PI% should be assigned within this severity class?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "number",
        factKey: "gastro_pi_percent",
        min: 0,
        max: 100,
        unit: "percent",
      },
    },
    required_when: "always",
  },

  // ── gastro_clinical_justification ──────────────────────────────────────────
  {
    factKey: "gastro_clinical_justification",
    label: "Clinical justification",
    description:
      'Optional free-text clinical justification provided by the doctor for the chosen PI%.\n' +
      'Extract verbatim when the doctor provides a rationale or explanation.\n' +
      'Omit when not mentioned.',
    valueType: "string",
    clinicalInferenceAllowed: true,
    required_when: "never",
  },
];
