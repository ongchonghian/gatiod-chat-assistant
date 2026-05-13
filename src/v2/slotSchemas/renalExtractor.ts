/**
 * Renal LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 * Responsible for two things the generic layer cannot do:
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *
 *   2. validateRenalReadinessFromSchema — wraps deriveReadinessValidator with
 *      the cross-slot "at least one classifying input" check that cannot be
 *      expressed as a per-slot required_when condition.
 *
 * Register in systemRegistry.ts:
 *   slotSchema:          renalSlotSchema
 *   shadowExtractor:     createRenalLlmExtractor(client)
 *   readinessValidator:  validateRenalReadiness (existing; unchanged)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { renalSlotSchema, type RenalFactKey } from "./renal.js";
import type { SlotDefinition } from "./types.js";

// ── SlotSignals derivation ────────────────────────────────────────────────────
//
// Maps renal extracted facts to SlotSignals booleans.
// Mirrors the signals set by extractors/renal.ts on the regex path.

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true; // boolean, number — presence = defined
}

export function deriveRenalSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (isPresent(facts["renal_sex"]?.value)) {
    signals.sex = true;
  }

  const hasInputs =
    isPresent(facts["renal_serum_creatinine"]?.value) ||
    isPresent(facts["renal_creatinine_clearance"]?.value) ||
    isPresent(facts["renal_ckd_stage"]?.value) ||
    isPresent(facts["renal_clinical_severity"]?.value);
  if (hasInputs) {
    signals.renal_inputs = true;
  }

  if (isPresent(facts["renal_clinical_severity"]?.value)) {
    signals.clinical_severity = true;
  }

  if (facts["renal_solitary_kidney"] !== undefined) {
    signals.solitary_kidney = true;
  }

  if (facts["renal_provisional_award"] !== undefined) {
    signals.provisional_award = true;
  }

  return signals;
}

// ── Readiness validator (schema-derived + cross-slot guard) ───────────────────

/**
 * Readiness validator for the LLM extractor path.
 *
 * Step 1: deriveReadinessValidator evaluates per-slot required_when conditions
 *         (renal_sex always required).
 *
 * Step 2: Cross-slot guard — at least one classifying input must be present:
 *         serum creatinine, creatinine clearance, CKD stage, or clinical
 *         severity. This cannot be expressed as a per-slot condition.
 */
export function validateRenalReadinessFromSchema(
  systemState: V2SystemState,
): ReadinessResult {
  const facts = systemState.extractedFacts;

  // D3 invariant — pending observations block calculation readiness.
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

  // Step 1 — per-slot required_when (sex is always required).
  const schemaResult = deriveReadinessValidator(
    renalSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  // Step 2 — cross-slot: at least one classifying input.
  const hasClassifyingInput =
    facts["renal_serum_creatinine"] !== undefined ||
    facts["renal_creatinine_clearance"] !== undefined ||
    facts["renal_ckd_stage"] !== undefined ||
    facts["renal_clinical_severity"] !== undefined;

  if (!hasClassifyingInput) {
    return {
      ready: false,
      reason: "no_classifying_input",
      missingFields: ["renal_classifying_input"],
      clarificationQuestion:
        "Please provide at least one renal function value: serum creatinine (µmol/L), creatinine clearance (mL/min), CKD stage (1–5), or clinical severity.",
      candidateAnswers: [
        "Serum creatinine (µmol/L)",
        "Creatinine clearance (mL/min)",
        "CKD stage",
        "Clinical severity",
      ],
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns the renal LLM extractor wired to the provided model client.
 *
 * Usage in systemRegistry.ts:
 *   import { geminiClient } from "../geminiSemanticModelClient.js";
 *   shadowExtractor: createRenalLlmExtractor(geminiClient)
 */
export function createRenalLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<RenalFactKey>({
    system: "renal",
    defs: renalSlotSchema,
    client,
    deriveSignals: deriveRenalSignals,
  });
}
