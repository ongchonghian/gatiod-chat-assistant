/**
 * Spine LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *   2. validateSpineReadinessFromSchema — wraps deriveReadinessValidator with
 *      the "at least one entry with a category" check.
 *
 * Register in systemRegistry.ts:
 *   slotSchema:         spineSlotSchema
 *   shadowExtractor:    createSpineLlmExtractor(client)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { spineSlotSchema, type SpineFactKey } from "./spine.js";
import type { SlotDefinition } from "./types.js";

// ── SlotSignals derivation ────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function deriveSpineSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (isPresent(facts["spine_region"]?.value)) {
    signals.region = true;
  }

  const entries = facts["spine_entries"]?.value;
  if (Array.isArray(entries) && entries.length > 0) {
    signals.diagnosis_category = true;
    const hasAnySeverity = entries.some(
      (e: Record<string, unknown>) => typeof e?.severityKey === "string" && e.severityKey !== ""
    );
    if (hasAnySeverity) {
      signals.severity_key = true;
    }
    const hasNeuro = entries.some(
      (e: Record<string, unknown>) =>
        e?.monoparesisHalving === true ||
        (typeof e?.bladderBowelSeverity === "string" && e.bladderBowelSeverity !== "none")
    );
    if (hasNeuro) {
      signals.spine_neuro_present = true;
    }
    const hasFracture = entries.some(
      (e: Record<string, unknown>) => e?.diagnosisCategory === "fractures_dislocations"
    );
    if (hasFracture) {
      signals.fracture_present = true;
    }
    const hasDisc = entries.some(
      (e: Record<string, unknown>) => e?.diagnosisCategory === "intervertebral_disc"
    );
    if (hasDisc) {
      signals.disc_present = true;
    }
  }

  return signals;
}

// ── Readiness validator ───────────────────────────────────────────────────────

export function validateSpineReadinessFromSchema(
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

  const schemaResult = deriveReadinessValidator(
    spineSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  // Cross-slot: at least one entry must have a diagnosis category.
  const entries = facts["spine_entries"]?.value;
  const hasCategory =
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.some((e: Record<string, unknown>) => typeof e?.diagnosisCategory === "string");

  if (!hasCategory) {
    return {
      ready: false,
      reason: "no_diagnosis_category",
      missingFields: ["spine_entries"],
      clarificationQuestion:
        "What is the spinal diagnosis? (e.g. fracture/dislocation, spinal cord injury, disc disease, spondylolysis, or chronic pain with normal MRI)",
      candidateAnswers: [
        "Fractures / Dislocations",
        "Spinal Cord Injury / Cauda Equina",
        "Intervertebral Disc",
        "Spondylolysis / Spondylolisthesis",
        "Chronic Pain — Normal MRI",
      ],
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSpineLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<SpineFactKey>({
    system: "spine",
    defs: spineSlotSchema,
    client,
    deriveSignals: deriveSpineSignals,
  });
}
