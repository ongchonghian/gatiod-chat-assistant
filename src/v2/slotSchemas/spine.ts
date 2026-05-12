/**
 * Spine slot schema — ADR-0004.
 *
 * Single source of truth for spine fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * The spine system uses two high-level fact keys: the spinal region and an
 * array of diagnosis category entries (each with a severity bracket). Severity
 * bracket selection is the D2 boundary — the doctor must state or select it.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (per-slot conditions)
 *   - validateSpineReadinessFromSchema wrapper (cross-slot "at least one entry" check)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type SpineFactKey =
  | "spine_region"
  | "spine_entries";

// ── Schema ────────────────────────────────────────────────────────────────────

export const spineSlotSchema: SlotDefinition<SpineFactKey>[] = [
  // ── spine_region ─────────────────────────────────────────────────────────────
  {
    factKey: "spine_region",
    label: "Spinal region",
    description:
      'The affected spinal region. Extract from explicit region mentions.\n\n' +
      'Valid values: "cervical" | "thoraco_lumbar" | "lumbo_sacral"\n\n' +
      'Map as follows:\n' +
      '  "cervical" — "cervical spine", "c-spine", "neck spine", C1–C7 levels\n' +
      '  "thoraco_lumbar" — "thoracic", "thoracolumbar", "T-L junction", T1–T12 levels\n' +
      '  "lumbo_sacral" — "lumbar", "lumbosacral", "lower back", "L-S", L2–L5 levels\n\n' +
      'Multi-region: if more than one region is detected, emit a PendingObservation ' +
      'asking the doctor to confirm which region to assess first. Do NOT guess.\n\n' +
      'D2 boundary: "thoraco-lumbar" must not be split into separate regions — ' +
      'thoracolumbar is its own region key.',
    valueType: "enum",
    allowedValues: ["cervical", "thoraco_lumbar", "lumbo_sacral"],
    clinicalInferenceAllowed: true,
    required_when: "always",
    clarification: {
      question: "Which spinal region is affected?",
      candidateAnswers: ["Cervical", "Thoraco-Lumbar", "Lumbo-Sacral"],
      expectedAnswer: {
        kind: "enum",
        factKey: "spine_region",
        choices: ["cervical", "thoraco_lumbar", "lumbo_sacral"],
      },
    },
  },

  // ── spine_entries ─────────────────────────────────────────────────────────────
  {
    factKey: "spine_entries",
    label: "Spinal diagnosis entries",
    description: `Array of diagnosis category entries. One entry per distinct spinal diagnosis.

Shape: Array<{
  diagnosisCategory: DiagnosisCategory;
  severityKey: SeverityKey | "";
  monoparesisHalving: boolean;
  bladderBowelSeverity: BladderBowelSeverity;
  discCordInvolvement: boolean;
  spondylolysisPathway: SpondylolysisPathway;
}>

Valid diagnosisCategory values:
  "fractures_dislocations"          — fracture, dislocation, burst fracture, compression fracture
  "spinal_cord_injury"              — spinal cord injury, cauda equina, myelopathy, neurogenic
  "intervertebral_disc"             — disc herniation, disc disease, disc prolapse, sciatica with disc
  "spondylolysis_spondylolisthesis" — spondylolysis, spondylolisthesis
  "chronic_pain_normal_mri"         — chronic low back pain, normal MRI, no structural abnormality

D2 boundary — severityKey: clinicalInferenceAllowed: false.
  The doctor must state or select a severity bracket from the offered chips.
  Do NOT infer severity from clinical descriptions.

Sub-field extraction rules:
  - diagnosisCategory: IS extractable from explicit diagnosis terms.
  - severityKey: NOT extractable — always emit a PendingObservation asking for
    the severity bracket. The chips are populated dynamically at runtime from
    the allowed severities for the detected category.
  - monoparesisHalving: true when "monoparesis" is explicitly mentioned with
    ASIA D or higher cord injury. Never infer.
  - bladderBowelSeverity: extractable from "bladder/bowel" mentions. Valid values:
    "none" | "incomplete_single" | "incomplete_both" | "complete_single" | "complete_both"
  - discCordInvolvement: true when disc diagnosis also mentions cord/neural involvement.
  - spondylolysisPathway: "acute_traumatic" | "pre_existing_superimposed".
    Only relevant for spondylolysis/spondylolisthesis category.`,
    valueType: "array",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for this spinal diagnosis?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "spine_entries",
        choices: [],
      },
    },
    required_when: "always",
  },
];
