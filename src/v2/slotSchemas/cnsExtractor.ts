/**
 * CNS LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *   2. validateCnsReadinessFromSchema — wraps deriveReadinessValidator with
 *      the "at least one non-zero component" cross-slot check and specialist
 *      confirmation gates (G2 neuro, G4 psych, equilibrium ENT).
 *
 * Register in systemRegistry.ts:
 *   slotSchema:         cnsSlotSchema
 *   shadowExtractor:    createCnsLlmExtractor(client)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { cnsSlotSchema, type CnsFactKey } from "./cns.js";
import type { SlotDefinition } from "./types.js";

// ── "None" bracket IDs — any value in this set means the component has no impairment
const NONE_IDS = new Set([
  "c_none", "e_none", "a_none", "ms_none", "co_none", "em_none",
  "ol_none", "fn_none", "eq_none", "sw_none", "sg_none", "re_none",
]);

const BRACKET_KEYS: CnsFactKey[] = [
  "cns_g1a_bracketId", "cns_g1b_bracketId", "cns_g1c_bracketId",
  "cns_g2_bracketId", "cns_g3_bracketId", "cns_g4_bracketId",
  "cns_b_olfaction_bracketId", "cns_b_facial_bracketId",
  "cns_b_equilibrium_bracketId", "cns_b_swallowing_bracketId",
  "cns_b_station_gait_bracketId", "cns_b_respiration_bracketId",
];

// ── SlotSignals derivation ────────────────────────────────────────────────────

function isNonZeroBracket(facts: V2SystemFacts, key: string): boolean {
  const v = facts[key]?.value as string | undefined;
  return Boolean(v) && !NONE_IDS.has(v!);
}

export function deriveCnsSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  const hasSectionA = [
    "cns_g1a_bracketId", "cns_g1b_bracketId", "cns_g1c_bracketId",
    "cns_g2_bracketId", "cns_g3_bracketId", "cns_g4_bracketId",
  ].some((k) => facts[k] !== undefined);

  const hasSectionB = [
    "cns_b_olfaction_bracketId", "cns_b_facial_bracketId",
    "cns_b_equilibrium_bracketId", "cns_b_swallowing_bracketId",
    "cns_b_station_gait_bracketId", "cns_b_respiration_bracketId",
  ].some((k) => facts[k] !== undefined);

  const paralysedLimbs = facts["cns_c_paralysed_limbs"]?.value;
  const hasSectionC = Array.isArray(paralysedLimbs) && paralysedLimbs.length > 0;

  if (hasSectionA || hasSectionB || hasSectionC) {
    signals.cns_section = true;
  }

  if (hasSectionA) {
    signals.section_a_group = true;
  }

  if (hasSectionB) {
    signals.section_b_component = true;
    const hasNonZeroB = [
      "cns_b_olfaction_bracketId", "cns_b_facial_bracketId",
      "cns_b_equilibrium_bracketId", "cns_b_swallowing_bracketId",
      "cns_b_station_gait_bracketId", "cns_b_respiration_bracketId",
    ].some((k) => isNonZeroBracket(facts, k));
    if (hasNonZeroB) {
      signals.section_b_bracket = true;
    }
  }

  if (hasSectionC) {
    signals.paralysed_limbs = true;
  }

  const hasSpecialistConfirmation =
    facts["cns_g2_neuro_confirmed"]?.value === true ||
    facts["cns_g4_psych_confirmed"]?.value === true ||
    facts["cns_b_equilibrium_ent_confirmed"]?.value === true;
  if (hasSpecialistConfirmation) {
    signals.specialist_confirmation = true;
  }

  return signals;
}

// ── Readiness validator ───────────────────────────────────────────────────────

export function validateCnsReadinessFromSchema(
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

  // Per-slot: specialist confirmations required when their bracket is present.
  const schemaResult = deriveReadinessValidator(
    cnsSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  // Cross-slot: at least one non-zero assessable component.
  const hasNonZeroComponent =
    BRACKET_KEYS.some((k) => isNonZeroBracket(facts, k)) ||
    (Array.isArray(facts["cns_c_paralysed_limbs"]?.value) &&
      (facts["cns_c_paralysed_limbs"]?.value as unknown[]).length > 0);

  if (!hasNonZeroComponent) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["cns_section"],
      clarificationQuestion:
        "Which CNS section applies? (Section A: cerebral impairment, Section B: cranial nerve/neurological, or Section C: paralysed limbs)",
      candidateAnswers: ["Section A", "Section B", "Section C"],
    };
  }

  // G2: non-zero bracket requires neuro confirmation.
  if (isNonZeroBracket(facts, "cns_g2_bracketId") && facts["cns_g2_neuro_confirmed"]?.value !== true) {
    return {
      ready: false,
      reason: "missing_g2_neuro_confirmation",
      missingFields: ["cns_g2_neuro_confirmed"],
      clarificationQuestion:
        "Group 2 (mental status/cognition) requires neuropsychologist confirmation. Has the impairment been confirmed by a neuropsychologist?",
      candidateAnswers: ["Yes, neuropsychologist confirmed", "No"],
      expectedAnswer: { kind: "boolean", factKey: "cns_g2_neuro_confirmed" },
    };
  }

  // G4: non-zero bracket requires psych confirmation.
  if (isNonZeroBracket(facts, "cns_g4_bracketId") && facts["cns_g4_psych_confirmed"]?.value !== true) {
    return {
      ready: false,
      reason: "missing_g4_psych_confirmation",
      missingFields: ["cns_g4_psych_confirmed"],
      clarificationQuestion:
        "Group 4 (emotional/behavioural) requires psychiatrist confirmation. Has the impairment been confirmed by a psychiatrist?",
      candidateAnswers: ["Yes, psychiatrist confirmed", "No"],
      expectedAnswer: { kind: "boolean", factKey: "cns_g4_psych_confirmed" },
    };
  }

  // Equilibrium: non-zero bracket requires ENT confirmation.
  if (
    isNonZeroBracket(facts, "cns_b_equilibrium_bracketId") &&
    facts["cns_b_equilibrium_ent_confirmed"]?.value !== true
  ) {
    return {
      ready: false,
      reason: "missing_equilibrium_ent_confirmation",
      missingFields: ["cns_b_equilibrium_ent_confirmed"],
      clarificationQuestion:
        "Equilibrium impairment requires ENT specialist confirmation. Has the impairment been confirmed by an ENT?",
      candidateAnswers: ["Yes, ENT confirmed", "No"],
      expectedAnswer: { kind: "boolean", factKey: "cns_b_equilibrium_ent_confirmed" },
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCnsLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<CnsFactKey>({
    system: "cns",
    defs: cnsSlotSchema,
    client,
    deriveSignals: deriveCnsSignals,
  });
}
