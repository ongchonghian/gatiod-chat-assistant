/**
 * Zod output schema for the LLM slot extractor — ADR-0004.
 *
 * Enforces the same hardening pattern as semanticSchemas.ts:
 *   - .strict() on every object (no additional properties)
 *   - status is a closed enum
 *   - confidence is bounded 0..1
 *   - sourceSpan is a plain string; verbatim-substring verification is done
 *     in llmSlotExtractor.ts (requires access to the source text, not Zod)
 */

import { z } from "zod";

// ── Per-slot extraction attempt ───────────────────────────────────────────────

export const SlotStatusSchema = z.enum([
  /** Field extracted from the utterance with a verifiable source span. */
  "extracted",
  /**
   * Field evidence was found but cannot be completed without doctor input.
   * Used when clinicalInferenceAllowed: false and the exact term is absent,
   * or when confidence falls below the extraction threshold.
   * The extractor builds a PendingObservation from the slot's clarification spec.
   */
  "needs_clarification",
  /** Field has no signal in the utterance. No action taken. */
  "not_mentioned",
]);

export const SlotAttemptSchema = z
  .object({
    /** Must match a factKey in the system's SlotDefinition[]. */
    factKey: z.string(),
    status: SlotStatusSchema,
    /**
     * The extracted value. Required when status === "extracted".
     * Shape must match the slot's valueType:
     *   enum   → string from allowedValues
     *   number → number
     *   boolean → boolean
     *   object  → plain object matching the slot's documented shape
     *   array   → array matching the slot's documented shape
     */
    value: z.unknown().optional(),
    /**
     * Verbatim substring of the input utterance that justifies the extraction.
     * Required when status === "extracted" or "needs_clarification".
     * The extractor validator checks this is a real substring — do not paraphrase.
     */
    sourceSpan: z.string().optional(),
    /** Extraction confidence 0..1. Values below the configured threshold trigger
     *  needs_clarification even for clinicalInferenceAllowed: true slots. */
    confidence: z.number().min(0).max(1),
    /**
     * Partial extraction data used to personalise the clarification question.
     * e.g. for nerve_selections: { "nerveKey": "median_below", "nerveLabel": "median nerve" }
     * The extractor substitutes "[nerve]" → nerveLabel in the clarification question.
     * Absent for simple scalar slots.
     */
    clarificationContext: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SlotAttempt = z.infer<typeof SlotAttemptSchema>;

// ── Full extractor output ─────────────────────────────────────────────────────

export const LlmExtractionOutputSchema = z
  .object({
    /**
     * One entry per slot where the LLM found signal or attempted extraction.
     * Slots with status "not_mentioned" may be omitted entirely — the extractor
     * treats absent entries as not_mentioned.
     */
    slots: z.array(SlotAttemptSchema),
    /**
     * Non-blocking notes from the LLM — e.g. "bilateral mention detected",
     * "unrecognised joint name 'AC joint' mapped to shoulder".
     * Never used for clinical decisions; audit-logged only.
     */
    warnings: z.array(z.string()),
  })
  .strict();

export type LlmExtractionOutput = z.infer<typeof LlmExtractionOutputSchema>;

// ── Parse helper ──────────────────────────────────────────────────────────────

export function parseLlmExtractionOutput(raw: string): {
  ok: true;
  output: LlmExtractionOutput;
} | {
  ok: false;
  issues: string[];
  rawOutput: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, issues: ["Response is not valid JSON"], rawOutput: raw };
  }

  const result = LlmExtractionOutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      rawOutput: raw,
    };
  }

  return { ok: true, output: result.data };
}
