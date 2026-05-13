// Semantic interpreter adapter (REQ-SC-OUTPUT-001, ADR-0003 Slice E).
//
// Wraps the LLM call that produces a `SemanticInterpretation` JSON object.
// The adapter:
//
//   1. Builds the prompt from `semanticInterpreterPrompt.ts`.
//   2. Calls the configured `SemanticModelClient` with deterministic settings
//      (temperature 0, schema-constrained output where supported).
//   3. Parses the response with `parseSemanticInterpretation` (Zod).
//   4. Validates with `validateSemanticInterpretation` (safety + source-span).
//   5. Returns a tagged result so callers fail-closed on any violation.
//
// Slice E is opt-in via `SEMANTIC_INTERPRETER_ENABLED`. When the flag is
// off, `runSemanticInterpreter` throws — the caller (`chatServiceV2` in
// Slice F) must check the flag before invoking. This keeps the slice safe
// to ship: no real LLM call ever runs in default CI.
//
// The `SemanticModelClient` interface lets tests inject a mock client with
// canned responses, so all unit tests verify schema/validator/renderer
// without touching a real model.

import { createHash, randomUUID } from "crypto";
import type {
  SemanticInterpretation,
} from "./contracts.js";
import {
  buildSemanticInterpreterSystemPrompt,
  buildSemanticInterpreterUserMessage,
  type SemanticPromptInputs,
} from "./semanticInterpreterPrompt.js";
import { parseSemanticInterpretation } from "./semanticSchemas.js";
import {
  validateSemanticInterpretation,
  type SemanticValidationIssue,
} from "./semanticInterpreterValidator.js";

/** Pluggable model client. Production implementation lives outside this
 *  file; tests pass a stub. The only contract is "JSON in, JSON-string
 *  out". The adapter handles parsing, validation, and shape enforcement. */
export interface SemanticModelClient {
  /** Returns the model's raw JSON string output. The adapter is responsible
   *  for parsing — implementations should NOT call JSON.parse. */
  generate(args: {
    systemPrompt: string;
    userMessage: string;
    /** Model id, e.g. "gemini-2.5-flash". Implementation-defined default. */
    model?: string;
  }): Promise<string>;
}

export type SemanticInterpreterFailureKind =
  | "feature_flag_disabled"
  | "model_call_failed"
  | "model_returned_non_json"
  | "schema_validation_failed"
  | "safety_validation_failed";

export type SemanticInterpreterResult =
  | { ok: true; interpretation: SemanticInterpretation }
  | {
      ok: false;
      kind: SemanticInterpreterFailureKind;
      message: string;
      schemaIssues?: string[];
      safetyIssues?: SemanticValidationIssue[];
      rawOutput?: string;
    };

export interface RunSemanticInterpreterArgs extends SemanticPromptInputs {
  client: SemanticModelClient;
  /** Override the env-var feature flag for tests. */
  forceEnabled?: boolean;
  /** Override the model id; defaults to env `SEMANTIC_INTERPRETER_MODEL`
   *  or "gemini-2.5-flash". */
  model?: string;
}

function isFeatureEnabled(forceEnabled?: boolean): boolean {
  if (typeof forceEnabled === "boolean") return forceEnabled;
  const flag = process.env.SEMANTIC_INTERPRETER_ENABLED;
  return flag === "true" || flag === "1";
}

function defaultModelId(): string {
  return process.env.SEMANTIC_INTERPRETER_MODEL ?? "gemini-2.5-flash";
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Try to extract a JSON object from the model's raw output. Models often
 *  wrap structured output in code fences or chatter despite being told not
 *  to. We strip ```json fences and trim, then JSON.parse. */
function extractJsonObject(raw: string): unknown | null {
  let text = raw.trim();

  // Strip ```json ... ``` fences if present.
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Strip leading prose before the first `{`.
  const firstBrace = text.indexOf("{");
  if (firstBrace > 0) text = text.slice(firstBrace);
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace > -1 && lastBrace < text.length - 1) {
    text = text.slice(0, lastBrace + 1);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Backfill server-controlled fields on the parsed JSON before validation.
 * The model is asked to fill these but should not be trusted to do so:
 *   - `id` — server-generated UUID
 *   - `sourceText` — server-supplied original text (model echo not trusted)
 *   - `sourceHash` — sha256 of `sourceText`
 *   - `createdAt` — server-supplied ISO timestamp
 *   - `requiresUserConsensus` — server-forced literal true
 */
function backfillServerFields(
  raw: Record<string, unknown>,
  sourceText: string,
): Record<string, unknown> {
  return {
    ...raw,
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : randomUUID(),
    sourceText,
    sourceHash: sha256(sourceText),
    createdAt: new Date().toISOString(),
    requiresUserConsensus: true,
  };
}

/**
 * Run the full semantic interpreter pipeline once. Fail-closed on every
 * boundary. Caller decides what to do with a failure (re-render the prompt,
 * fall back to deterministic routing, etc.).
 */
export async function runSemanticInterpreter(
  args: RunSemanticInterpreterArgs,
): Promise<SemanticInterpreterResult> {
  if (!isFeatureEnabled(args.forceEnabled)) {
    return {
      ok: false,
      kind: "feature_flag_disabled",
      message:
        "SEMANTIC_INTERPRETER_ENABLED is not set; semantic interpreter not invoked.",
    };
  }

  const systemPrompt = buildSemanticInterpreterSystemPrompt();
  const userMessage = buildSemanticInterpreterUserMessage({
    sourceText: args.sourceText,
    previousInterpretationJson: args.previousInterpretationJson,
    doctorEditInstruction: args.doctorEditInstruction,
  });

  let raw: string;
  try {
    raw = await args.client.generate({
      systemPrompt,
      userMessage,
      model: args.model ?? defaultModelId(),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "model_call_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      kind: "model_returned_non_json",
      message: "Model output was not parseable as a JSON object.",
      rawOutput: raw,
    };
  }

  const withServerFields = backfillServerFields(
    parsed as Record<string, unknown>,
    args.sourceText,
  );

  const schemaResult = parseSemanticInterpretation(withServerFields);
  if (!schemaResult.ok) {
    return {
      ok: false,
      kind: "schema_validation_failed",
      message: "Semantic interpretation failed Zod schema validation.",
      schemaIssues: schemaResult.issues,
      rawOutput: raw,
    };
  }

  const safetyResult = validateSemanticInterpretation(schemaResult.interpretation);
  if (!safetyResult.ok) {
    return {
      ok: false,
      kind: "safety_validation_failed",
      message: "Semantic interpretation failed safety validation.",
      safetyIssues: safetyResult.issues,
      rawOutput: raw,
    };
  }

  return { ok: true, interpretation: safetyResult.interpretation };
}
