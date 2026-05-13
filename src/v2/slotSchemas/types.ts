/**
 * Slot schema type definitions — ADR-0004.
 *
 * A SlotDefinition[] per system is the single source of truth for:
 *   - which fact keys a system owns and their value types
 *   - the D2 inference boundary (clinicalInferenceAllowed)
 *   - the clarification spec used when a field cannot be extracted verbatim
 *   - the required_when condition that drives deriveReadinessValidator
 *
 * Consumers:
 *   - LLM slot extractor (prompt context + output validation)
 *   - deriveReadinessValidator (condition evaluation)
 *   - arg builder (slot presence validation)
 */

import type { PendingObservationExpectedAnswer } from "../contracts.js";

// ── Condition language ────────────────────────────────────────────────────────
//
// TKey is parameterised by the system's own fact keys.
// This is a compile-time guarantee: a condition cannot reference a key that is
// not a SlotDefinition.factKey for that system. PresenceSignal keys can never
// appear here — the type parameter prevents it.

export type SlotCondition<TKey extends string> =
  | "always"
  | "never"
  | { fact: TKey; eq: unknown }
  | { fact: TKey; in: unknown[] }
  | { fact: TKey; present: true }
  | { and: SlotCondition<TKey>[] };

// ── Clarification spec ────────────────────────────────────────────────────────
//
// Carried on slots where clinicalInferenceAllowed: false.
// The LLM extractor uses this to emit a PendingObservation when the field
// cannot be extracted verbatim — replacing the scattered clarification logic
// previously duplicated across readiness validators, extractors, and the
// pending observation resolver.

export interface SlotClarification {
  /** Doctor-facing question. Use "[field]" as a placeholder for dynamic values
   *  (e.g. "[nerve]" → substituted with the detected nerve name at runtime). */
  question: string;
  /** Chip options surfaced to the doctor. Empty array means chips are populated
   *  dynamically at runtime (e.g. DBE condition list from the engine). */
  candidateAnswers: string[];
  /** Typed answer schema for the generic resolver in pendingObservationResolver.ts.
   *  When set, resolveByExpectedAnswer() can graduate the reply without a
   *  system-specific code path. */
  expectedAnswer: PendingObservationExpectedAnswer;
}

// ── SlotDefinition ────────────────────────────────────────────────────────────

export interface SlotDefinition<TKey extends string = string> {
  /** The fact key used in extractedFacts and as the key in toolArgBuilder output. */
  factKey: TKey;

  /** Human-readable label shown in confirmation UI and used in LLM prompt headings. */
  label: string;

  /**
   * Full description for the LLM extractor. Should include:
   *   - What to look for in the utterance
   *   - Valid values / shape for compound facts
   *   - D2 boundary rules for sub-fields where clinicalInferenceAllowed differs
   *     at sub-field level (e.g. nerve_selections: nerve key is extractable,
   *     deficitType and lossType are not)
   *   - Synonyms and normalisation rules
   */
  description: string;

  /**
   * Top-level value type.
   * "object" and "array" are compound — the exact shape is described in
   * `description`. Sub-field level inference rules are documented there until
   * a sub-field schema extension is introduced.
   */
  valueType: "string" | "number" | "boolean" | "enum" | "object" | "array";

  /** Valid values for "enum" valueType. Used for chip generation and validation. */
  allowedValues?: string[];

  /** Unit label for "number" valueType — used in UI and LLM prompt. */
  unit?: string;

  /**
   * Whether the LLM extractor may derive this field from context or linguistic
   * implication, or whether it must appear verbatim (or as a listed synonym).
   *
   * false → if the field cannot be extracted verbatim, the extractor MUST emit
   *         a PendingObservation using `clarification`. Never guess. Never use
   *         contextual implication ("limited to" does not count as "loss").
   *
   * For compound facts ("object" | "array"), this flag applies to the most
   * safety-critical sub-field. Per-sub-field rules are documented in
   * `description` until a sub-field schema extension lands.
   */
  clinicalInferenceAllowed: boolean;

  /**
   * Required when clinicalInferenceAllowed: false.
   * Carries the question, chips, and expectedAnswer for the generic resolver.
   * Absence on a non-inferrable slot is a validateSystemRegistry() error.
   */
  clarification?: SlotClarification;

  /**
   * When this slot is required for calculation-readiness.
   *
   * Cross-slot constraints ("at least one of [A, B, C] must be present")
   * cannot be expressed here — leave those in a thin readiness validator
   * wrapper alongside deriveReadinessValidator.
   */
  required_when: SlotCondition<TKey>;
}
