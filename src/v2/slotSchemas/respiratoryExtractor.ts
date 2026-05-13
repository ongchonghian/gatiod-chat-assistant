/**
 * Respiratory LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *   2. validateRespiratoryReadinessFromSchema — wraps deriveReadinessValidator
 *      with the cross-slot PFT / asthma-prerequisites check.
 *
 * Register in systemRegistry.ts:
 *   slotSchema:         respiratorySlotSchema
 *   shadowExtractor:    createRespiratoryLlmExtractor(client)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { respiratorySlotSchema, type RespiratoryFactKey } from "./respiratory.js";
import type { SlotDefinition } from "./types.js";

// ── SlotSignals derivation ────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return true;
}

export function deriveRespiratorySignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (isPresent(facts["resp_diagnosis"]?.value)) {
    signals.diagnosis = true;
  }

  const hasPft =
    facts["resp_fvc"] !== undefined ||
    facts["resp_fev1"] !== undefined ||
    facts["resp_dlco"] !== undefined ||
    facts["resp_vo2max"] !== undefined;
  if (hasPft) {
    signals.pft_values = true;
  }

  const hasMaint    = Boolean(facts["resp_asthma_daily_maintenance"]?.value);
  const hasTransfer = Boolean(facts["resp_asthma_transferred"]?.value);
  const hasImprove  = Boolean(facts["resp_asthma_unlikely_improvement"]?.value);
  if (hasMaint && hasTransfer && hasImprove) {
    signals.asthma_prerequisites = true;
  }

  if (isPresent(facts["resp_asthma_medication"]?.value)) {
    signals.asthma_medication = true;
  }

  const profusion = facts["resp_asbestosis_profusion"]?.value;
  if (profusion === "at_least_1_1") {
    signals.asbestosis_profusion = true;
  }

  return signals;
}

// ── Readiness validator ───────────────────────────────────────────────────────

export function validateRespiratoryReadinessFromSchema(
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
    respiratorySlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  const diagnosis = (facts["resp_diagnosis"]?.value ?? "standard") as string;
  const hasPft =
    facts["resp_fvc"] !== undefined ||
    facts["resp_fev1"] !== undefined ||
    facts["resp_dlco"] !== undefined ||
    facts["resp_vo2max"] !== undefined;

  if (diagnosis === "occupational_asthma") {
    if (!hasPft) {
      return {
        ready: false,
        reason: "missing_pft_for_asthma",
        missingFields: ["resp_fev1"],
        clarificationQuestion:
          "Please provide the patient's FEV1 % predicted (and any other PFT values). The medication-based asthma classification requires FEV1 to apply.",
        candidateAnswers: ["FEV1 > 80% predicted", "FEV1 60–80%", "FEV1 < 60%"],
      };
    }
    return { ready: true };
  }

  if (diagnosis === "asbestosis_silicosis") {
    const hasRadio  = Boolean(facts["resp_asbestosis_radiological"]?.value);
    const profusion = facts["resp_asbestosis_profusion"]?.value as string | undefined;
    const hasHighProf = profusion === "at_least_1_1";

    if (!hasPft && (!hasRadio || !hasHighProf)) {
      return {
        ready: false,
        reason: "no_assessable_input",
        missingFields: ["resp_fvc"],
        clarificationQuestion:
          "Please provide PFT values or confirm asbestosis/silicosis radiological findings and ILO profusion score.",
        candidateAnswers: [
          "Provide FVC/FEV1/DLCO",
          "Radiologically definite, profusion ≥ 1/1",
          "Radiologically definite, profusion < 1/1",
        ],
      };
    }
    return { ready: true };
  }

  // Standard pathway — at least one PFT required.
  if (!hasPft) {
    return {
      ready: false,
      reason: "no_assessable_input",
      missingFields: ["resp_fvc"],
      clarificationQuestion: "Please provide the PFT results (FVC, FEV1, DLCO, or VO2 Max % predicted).",
      candidateAnswers: ["FVC", "FEV1", "DLCO", "VO2 Max"],
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRespiratoryLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<RespiratoryFactKey>({
    system: "respiratory",
    defs: respiratorySlotSchema,
    client,
    deriveSignals: deriveRespiratorySignals,
  });
}
