/**
 * LLM slot extractor — ADR-0004.
 *
 * A generic StructuredExtractor implementation backed by an LLM call.
 * Replaces the regex pattern tables in src/v2/extractors/[system].ts while
 * preserving the same StructuredExtractionResult contract.
 *
 * Pipeline per turn:
 *   1. Build prompt from SlotDefinition[] + utterance (llmSlotExtractorPrompt)
 *   2. Call model client (temperature 0, schema-constrained where supported)
 *   3. Parse response with Zod (llmSlotExtractorSchemas)
 *   4. Safety-validate source spans
 *   5. Map SlotAttempt[] → extractedFactsPatch + pendingObservationsToAdd
 *   6. Derive slotSignalsPatch via the system-supplied mapping function
 *
 * Feature flag: LLM_EXTRACTOR_ENABLED (env). When off, createLlmExtractor
 * returns a StructuredExtractor that throws — the registry must not register
 * it as structured_live when the flag is absent. Start in structured_shadow.
 *
 * The SemanticModelClient interface is reused from semanticInterpreter.ts —
 * one pluggable client, two consumers.
 */

import { randomUUID } from "crypto";
import type {
  ExtractedFact,
  GatiodSystemKey,
  NormalizedUtterance,
  OntologyMatch,
  PendingObservation,
  SlotSignals,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import type { ExtractionContext } from "../contracts.js";
import {
  buildSlotExtractorSystemPrompt,
  buildSlotExtractorUserMessage,
} from "./llmSlotExtractorPrompt.js";
import {
  parseLlmExtractionOutput,
  type SlotAttempt,
} from "./llmSlotExtractorSchemas.js";
import type { SlotDefinition } from "./types.js";

// ── Feature flag ──────────────────────────────────────────────────────────────

function isFeatureEnabled(forceEnabled?: boolean): boolean {
  if (typeof forceEnabled === "boolean") return forceEnabled;
  const flag = process.env.LLM_EXTRACTOR_ENABLED;
  return flag === "true" || flag === "1";
}

// ── Confidence threshold ──────────────────────────────────────────────────────

/** Slots with confidence below this threshold are routed to needs_clarification
 *  even when clinicalInferenceAllowed: true. Configurable via env. */
function confidenceThreshold(): number {
  const val = parseFloat(process.env.LLM_EXTRACTOR_CONFIDENCE_THRESHOLD ?? "");
  return isNaN(val) ? 0.8 : Math.max(0, Math.min(1, val));
}

// ── Source span safety validation ─────────────────────────────────────────────

/**
 * Every sourceSpan must be a verbatim substring of the input utterance.
 * Returns violation messages; empty array = all clear.
 */
function validateSourceSpans(
  attempts: SlotAttempt[],
  utterance: string
): string[] {
  const violations: string[] = [];
  for (const attempt of attempts) {
    if (
      attempt.sourceSpan &&
      !utterance.includes(attempt.sourceSpan)
    ) {
      violations.push(
        `"${attempt.factKey}" sourceSpan "${attempt.sourceSpan}" is not a verbatim substring of the utterance.`
      );
    }
  }
  return violations;
}

// ── Fact builder ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function makeFact<T>(
  value: T,
  sourceText: string,
  confidence: number
): ExtractedFact<T> {
  const now = nowIso();
  return {
    value,
    sourceText,
    confidence,
    extractionMethod: "llm_proposed_validated",
    createdAt: now,
    updatedAt: now,
  };
}

// ── Clarification question personalisation ────────────────────────────────────

/**
 * Substitutes [placeholder] tokens in the clarification question with values
 * from clarificationContext. e.g. "[nerve]" → "median nerve".
 */
function personaliseQuestion(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\[(\w+)\]/g, (_, key: string) => {
    const v = context[key];
    return typeof v === "string" ? v : `[${key}]`;
  });
}

// ── PendingObservation builder ────────────────────────────────────────────────

function buildPendingObservation(
  system: GatiodSystemKey,
  attempt: SlotAttempt,
  def: SlotDefinition
): PendingObservation | null {
  if (!def.clarification) return null;

  const context = attempt.clarificationContext ?? {};
  const question = personaliseQuestion(def.clarification.question, context);

  const now = nowIso();
  return {
    id: randomUUID(),
    system,
    type: "other",
    sourceText: attempt.sourceSpan ?? attempt.factKey,
    parsed: { factKey: def.factKey, partialData: context },
    missingFields: [def.factKey],
    clarificationQuestion: question,
    candidateAnswers:
      def.clarification.candidateAnswers.length > 0
        ? def.clarification.candidateAnswers
        : undefined,
    expectedAnswer: def.clarification.expectedAnswer,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Display value formatter ───────────────────────────────────────────────────

/**
 * Converts an extracted slot value to a human-readable string for
 * `displayValuesPatch`. Never produces `"[object Object]"`.
 *
 * Rules:
 *  - Scalars (string / number / boolean): String(value).
 *  - null / undefined: empty string (slot was not filled).
 *  - Arrays: compact JSON — most slot arrays are short (1–3 items).
 *  - Objects: compact JSON — avoids the infamous `String({})` footgun.
 *
 * Callers that need richer formatting (e.g. the comparison message renderer)
 * use `formatValue` in extractorComparison.ts, which understands schema shapes.
 */
function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Array or object — JSON is at least informative rather than "[object Object]".
  return JSON.stringify(value);
}

// ── Slot attempt → StructuredExtractionResult mapper ─────────────────────────

export interface LlmExtractorMappingOptions<TKey extends string> {
  system: GatiodSystemKey;
  defs: SlotDefinition<TKey>[];
  attempts: SlotAttempt[];
  utterance: string;
  /** System-specific function: derived PresenceSignals from the extracted facts.
   *  Each system knows which factKeys map to which PresenceSignal booleans.
   *  Kept here rather than in SlotDefinition to avoid coupling the schema type
   *  to the PresenceSignals shape. */
  deriveSignals: (facts: V2SystemFacts) => Partial<SlotSignals>;
}

function mapAttemptsToResult<TKey extends string>(
  opts: LlmExtractorMappingOptions<TKey>
): Pick<
  StructuredExtractionResult,
  | "extractedFactsPatch"
  | "pendingObservationsToAdd"
  | "slotSignalsPatch"
  | "displayValuesPatch"
  | "warnings"
> {
  const defByKey = new Map<string, SlotDefinition<TKey>>(opts.defs.map((d) => [d.factKey, d]));
  const factsPatch: V2SystemFacts = {};
  const pendingToAdd: PendingObservation[] = [];
  const displayValuesPatch: Record<string, string> = {};
  const warnings: string[] = [];

  const threshold = confidenceThreshold();

  for (const attempt of opts.attempts) {
    if (attempt.status === "not_mentioned") continue;

    const def = defByKey.get(attempt.factKey);
    if (!def) {
      warnings.push(
        `LLM returned unknown factKey "${attempt.factKey}" — ignored.`
      );
      continue;
    }

    // Downgrade to needs_clarification when confidence is below threshold
    // (applies to clinicalInferenceAllowed: true slots only — forbidden slots
    // must never be extracted regardless of confidence).
    const effectiveStatus =
      attempt.status === "extracted" &&
      (!def.clinicalInferenceAllowed || attempt.confidence < threshold)
        ? "needs_clarification"
        : attempt.status;

    if (effectiveStatus === "extracted") {
      if (attempt.value === undefined) {
        warnings.push(
          `Slot "${attempt.factKey}" has status "extracted" but no value — treating as needs_clarification.`
        );
        const obs = buildPendingObservation(opts.system, attempt, def);
        if (obs) pendingToAdd.push(obs);
        continue;
      }

      factsPatch[attempt.factKey] = makeFact(
        attempt.value,
        attempt.sourceSpan ?? opts.utterance,
        attempt.confidence
      );
      displayValuesPatch[attempt.factKey] = formatDisplayValue(attempt.value);
    } else if (effectiveStatus === "needs_clarification") {
      const obs = buildPendingObservation(opts.system, attempt, def);
      if (obs) {
        pendingToAdd.push(obs);
      } else {
        // No clarification spec on this slot — log and skip.
        warnings.push(
          `Slot "${attempt.factKey}" needs clarification but has no clarification spec — cannot ask doctor. Skipped.`
        );
      }
    }
  }

  const slotSignalsPatch = opts.deriveSignals(factsPatch);

  return {
    extractedFactsPatch: factsPatch,
    pendingObservationsToAdd: pendingToAdd,
    slotSignalsPatch,
    displayValuesPatch,
    warnings,
  };
}

// ── Failure result ────────────────────────────────────────────────────────────

export type LlmExtractorFailureKind =
  | "feature_flag_disabled"
  | "model_call_failed"
  | "model_returned_non_json"
  | "schema_validation_failed"
  | "safety_validation_failed";

export type LlmExtractorResult =
  | { ok: true; result: StructuredExtractionResult }
  | {
      ok: false;
      kind: LlmExtractorFailureKind;
      message: string;
      issues?: string[];
      rawOutput?: string;
    };

// ── Factory — createLlmExtractor ─────────────────────────────────────────────

export interface LlmExtractorOptions<TKey extends string> {
  system: GatiodSystemKey;
  defs: SlotDefinition<TKey>[];
  client: SemanticModelClient;
  /** Maps extracted facts to PresenceSignals for this system. */
  deriveSignals: (facts: V2SystemFacts) => Partial<SlotSignals>;
  /** Override feature flag for tests. */
  forceEnabled?: boolean;
  /** Override model id; defaults to env LLM_EXTRACTOR_MODEL or "gemini-2.5-flash". */
  model?: string;
}

/**
 * Returns a StructuredExtractor function wired to the LLM.
 * Register in V2_SYSTEM_REGISTRY as the system's extractor.
 *
 * The returned function satisfies the StructuredExtractor contract:
 *   (utterance, systemState, ontologyMatches?, extractionContext?) => StructuredExtractionResult
 *
 * On LLM failure it returns a StructuredExtractionResult with empty patches
 * and a warning — callers see the same shape as a regex extractor miss, but
 * with an auditable warning in the result. The outer chat service handles the
 * V2 failure path (D11).
 */
export function createLlmExtractor<TKey extends string>(
  opts: LlmExtractorOptions<TKey>
): (
  utterance: NormalizedUtterance,
  systemState: V2SystemState,
  ontologyMatches?: OntologyMatch[],
  extractionContext?: ExtractionContext
) => Promise<StructuredExtractionResult> {
  const modelId =
    opts.model ??
    process.env.LLM_EXTRACTOR_MODEL ??
    "gemini-2.5-flash";

  return async (
    utterance: NormalizedUtterance,
    _systemState: V2SystemState,
    _ontologyMatches: OntologyMatch[] = [],
    _extractionContext?: ExtractionContext
  ): Promise<StructuredExtractionResult> => {
    const emptyResult: StructuredExtractionResult = {
      extractedFactsPatch: {},
      pendingObservationsToAdd: [],
      pendingObservationsToResolve: [],
      slotSignalsPatch: {},
      displayValuesPatch: {},
      warnings: [],
    };

    if (!isFeatureEnabled(opts.forceEnabled)) {
      return {
        ...emptyResult,
        warnings: ["LLM_EXTRACTOR_ENABLED is not set — extractor skipped."],
      };
    }

    // 1. Build prompt
    const systemPrompt = buildSlotExtractorSystemPrompt({
      system: opts.system,
      slotDefs: opts.defs as SlotDefinition[],
    });
    const userMessage = buildSlotExtractorUserMessage(utterance.raw);

    // 2. Call model
    let rawOutput: string;
    try {
      rawOutput = await opts.client.generate({ systemPrompt, userMessage, model: modelId });
    } catch (err) {
      return {
        ...emptyResult,
        warnings: [
          `LLM extractor model call failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }

    // 3. Parse with Zod
    const parsed = parseLlmExtractionOutput(rawOutput);
    if (!parsed.ok) {
      return {
        ...emptyResult,
        warnings: [
          `LLM extractor schema validation failed: ${parsed.issues.join("; ")}`,
        ],
      };
    }

    // 4. Safety-validate source spans
    const spanViolations = validateSourceSpans(
      parsed.output.slots,
      utterance.raw
    );
    if (spanViolations.length > 0) {
      return {
        ...emptyResult,
        warnings: [
          `LLM extractor source-span safety failure: ${spanViolations.join("; ")}`,
        ],
      };
    }

    // 5 + 6. Map attempts → StructuredExtractionResult
    const mapped = mapAttemptsToResult({
      system: opts.system,
      defs: opts.defs,
      attempts: parsed.output.slots,
      utterance: utterance.raw,
      deriveSignals: opts.deriveSignals,
    });

    return {
      ...mapped,
      pendingObservationsToResolve: [],
      warnings: [...mapped.warnings, ...parsed.output.warnings],
    };
  };
}
