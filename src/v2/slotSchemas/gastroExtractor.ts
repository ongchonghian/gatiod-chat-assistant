/**
 * Gastro-digestive LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *   2. validateGastroReadinessFromSchema — wraps deriveReadinessValidator with
 *      the cross-slot subsystem → subpath → bracket → PI chain.
 *
 * Register in systemRegistry.ts:
 *   slotSchema:         gastroSlotSchema
 *   shadowExtractor:    createGastroLlmExtractor(client)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { gastroSlotSchema, type GastroFactKey } from "./gastro.js";
import type { SlotDefinition } from "./types.js";

// ── SlotSignals derivation ────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  return true;
}

export function deriveGastroSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (isPresent(facts["gastro_subsystem"]?.value)) {
    signals.subSystem = true;
  }

  if (facts["gastro_bracket_index"] !== undefined) {
    signals.selectedBracketIndex = true;
  }

  if (facts["gastro_pi_percent"] !== undefined) {
    signals.piPercent = true;
  }

  if (isPresent(facts["gastro_clinical_justification"]?.value)) {
    signals.clinicalJustification = true;
  }

  return signals;
}

// ── Readiness validator ───────────────────────────────────────────────────────

export function validateGastroReadinessFromSchema(
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

  // Per-slot conditions: subsystem, colonal subpath, liver/biliary subpath,
  // bracket_index, pi_percent (all drive required_when in the schema).
  const schemaResult = deriveReadinessValidator(
    gastroSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGastroLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<GastroFactKey>({
    system: "gastro_digestive",
    defs: gastroSlotSchema,
    client,
    deriveSignals: deriveGastroSignals,
  });
}
