/**
 * Visual LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *   2. validateVisualReadinessFromSchema — wraps deriveReadinessValidator with
 *      the "at least one visual fact" cross-slot check.
 *
 * Register in systemRegistry.ts:
 *   slotSchema:         visualSlotSchema
 *   shadowExtractor:    createVisualLlmExtractor(client)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { visualSlotSchema, type VisualFactKey } from "./visual.js";
import type { SlotDefinition } from "./types.js";

const VISUAL_ALL_FACT_KEYS: VisualFactKey[] = [
  "visual_left_acuity_id", "visual_right_acuity_id",
  "visual_left_field_id", "visual_right_field_id",
  "visual_left_modifiers", "visual_right_modifiers",
  "visual_left_conditions", "visual_right_conditions",
  "visual_diplopia_id",
  "visual_left_enucleated", "visual_right_enucleated",
];

// ── SlotSignals derivation ────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

export function deriveVisualSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  const hasLeft =
    isPresent(facts["visual_left_acuity_id"]?.value) ||
    isPresent(facts["visual_left_field_id"]?.value) ||
    isPresent(facts["visual_left_modifiers"]?.value) ||
    isPresent(facts["visual_left_conditions"]?.value) ||
    facts["visual_left_enucleated"] !== undefined;
  if (hasLeft) {
    signals.leftEye = true;
  }

  const hasRight =
    isPresent(facts["visual_right_acuity_id"]?.value) ||
    isPresent(facts["visual_right_field_id"]?.value) ||
    isPresent(facts["visual_right_modifiers"]?.value) ||
    isPresent(facts["visual_right_conditions"]?.value) ||
    facts["visual_right_enucleated"] !== undefined;
  if (hasRight) {
    signals.rightEye = true;
  }

  const hasAcuity =
    isPresent(facts["visual_left_acuity_id"]?.value) ||
    isPresent(facts["visual_right_acuity_id"]?.value);
  if (hasAcuity) {
    signals.acuity = true;
  }

  const hasField =
    isPresent(facts["visual_left_field_id"]?.value) ||
    isPresent(facts["visual_right_field_id"]?.value);
  if (hasField) {
    signals.field = true;
  }

  if (isPresent(facts["visual_diplopia_id"]?.value)) {
    signals.diplopiaId = true;
  }

  const hasModifiers =
    isPresent(facts["visual_left_modifiers"]?.value) ||
    isPresent(facts["visual_right_modifiers"]?.value);
  if (hasModifiers) {
    signals.modifiers = true;
  }

  return signals;
}

// ── Readiness validator ───────────────────────────────────────────────────────

export function validateVisualReadinessFromSchema(
  systemState: V2SystemState,
): ReadinessResult {
  const facts = systemState.extractedFacts;

  if (systemState.pendingObservations.length > 0) {
    const first = systemState.pendingObservations[0];
    return {
      ready: false,
      reason: "pending_observations",
      missingFields: first.missingFields,
      clarificationQuestion: first.clarificationQuestion,
      candidateAnswers: first.candidateAnswers,
      expectedAnswer: first.expectedAnswer,
    };
  }

  // Per-slot conditions: diplopia zone required only when visual_diplopia_id is present
  // and clinicalInferenceAllowed: false — already handled by the generic extractor.
  const schemaResult = deriveReadinessValidator(
    visualSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  // Cross-slot: at least one visual fact must be present.
  const hasAnyFact = VISUAL_ALL_FACT_KEYS.some((k) => facts[k] !== undefined);
  if (!hasAnyFact) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["visual_eye_data"],
      clarificationQuestion:
        "Which visual impairment applies? Please provide Snellen acuity (e.g. 6/12), visual field, diplopia zone, or specific ophthalmic conditions.",
      candidateAnswers: ["Right eye", "Left eye", "Both eyes", "Diplopia only"],
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createVisualLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<VisualFactKey>({
    system: "visual",
    defs: visualSlotSchema,
    client,
    deriveSignals: deriveVisualSignals,
  });
}
