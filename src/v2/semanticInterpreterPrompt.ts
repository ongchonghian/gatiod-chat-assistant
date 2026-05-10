// Semantic interpreter prompt assembly (REQ-SC-PROMPT-001, ADR-0003).
//
// The prompt is composed at call time from:
//   1. Hardcoded SAFETY_RULES — the boundaries the interpreter must never
//      cross (no PI%, no tool args, no calculation rules).
//   2. SCHEMA_INSTRUCTIONS — what JSON shape to return.
//   3. Generated taxonomy section (registry-backed, see
//      `semanticSystemTaxonomy.ts`).
//
// The prompt MUST NOT include PI tables, CVC formulas, percentages, or
// `assess_*` tool argument schemas. Those belong to the deterministic
// engine; leaking them into the semantic prompt risks the model producing
// calculation-ready output.

import { buildSemanticTaxonomyPromptSection } from "./semanticSystemTaxonomy.js";

const SAFETY_RULES = `You are a clinical semantic interpreter for the GATIOD chat assistant.

You are NOT calculating Permanent Incapacity percentages.
You are identifying possible GATIOD assessment areas and findings from the user's clinical text so a human doctor can confirm them before the deterministic engine extracts calculation-grade facts.

Hard rules:
- Return ONLY a single JSON object matching the SemanticInterpretation schema. No prose, no markdown.
- Do NOT include any PI%, final percentage, "approximately", CVC, or calculation result.
- Do NOT include any tool name, "assess_*", function call, or tool arguments.
- Do NOT mark any finding as calculation-ready. Every finding's \`calculationReady\` field must be the literal value false.
- \`requiresUserConsensus\` must be the literal value true.
- Every \`candidateFinding\` must include a non-empty \`sourceSpan\` that is a verbatim substring of the user's input. Do not paraphrase the source text.
- Separate \`explicitlyStatedFields\` (fields the doctor wrote) from \`inferredFields\` (mapping you applied) and \`missingFields\` (calculation-critical fields not stated).
- Mark systems whose status is \`legacy_deferred\` accordingly. Do not propose calculation findings for them.
- Do not invent enum values. Use only the values defined in the schema description.`;

const SCHEMA_INSTRUCTIONS = `Required output JSON shape:

{
  "id": string,                       // a generated UUID-like identifier
  "sourceText": string,               // the user's original input, unmodified
  "sourceHash": string,               // a hash you can recompute deterministically
  "candidateSystems": [
    {
      "system": "upper_limb" | "lower_limb" | "spine" | "respiratory" | "renal" | "gastro_digestive" | "hearing" | "cns" | "visual",
      "confidence": number (0..1),
      "status": "structured_supported" | "structured_shadow" | "legacy_deferred",
      "evidence": [string],
      "rationale": string
    }
  ],
  "candidateFindings": [
    {
      "system": GATIOD system key,
      "sourceSpan": string,           // verbatim substring of input
      "findingType": "amputation" | "rom" | "neurological" | "dbe" | "spine_diagnosis" | "hearing_loss" | "respiratory_function" | "renal_function" | "gastro_subsystem" | "cns_component" | "visual_component" | "other",
      "proposedMapping": string,
      "systemConfidence": number,
      "mappingConfidence": number,
      "completeness": "complete_for_extraction" | "missing_calculation_fields" | "unsupported",
      "explicitlyStatedFields": [string],
      "inferredFields": [string],
      "missingFields": [string],
      "calculationReady": false
    }
  ],
  "unsupportedTerms": [string],
  "assumptions": [string],
  "requiresUserConsensus": true,
  "createdAt": ISO 8601 timestamp string
}`;

export interface SemanticPromptInputs {
  sourceText: string;
  /** Optional: when re-interpreting after an edit, include the previous
   *  interpretation and the doctor's correction so the model can revise. */
  previousInterpretationJson?: string;
  doctorEditInstruction?: string;
}

/** Build the system prompt sent to the model. The user message contains the
 *  actual clinical text (and optional revision context). */
export function buildSemanticInterpreterSystemPrompt(): string {
  return [
    SAFETY_RULES,
    "",
    SCHEMA_INSTRUCTIONS,
    "",
    buildSemanticTaxonomyPromptSection(),
  ].join("\n");
}

/** Build the user-message body for the model call. */
export function buildSemanticInterpreterUserMessage(
  inputs: SemanticPromptInputs,
): string {
  const lines: string[] = [];
  lines.push("Clinical input from the doctor:");
  lines.push("---");
  lines.push(inputs.sourceText);
  lines.push("---");

  if (inputs.previousInterpretationJson && inputs.doctorEditInstruction) {
    lines.push("");
    lines.push(
      "The doctor previously reviewed this interpretation and asked for a correction.",
    );
    lines.push("Previous interpretation JSON:");
    lines.push(inputs.previousInterpretationJson);
    lines.push("");
    lines.push("Doctor's edit instruction:");
    lines.push(inputs.doctorEditInstruction);
    lines.push("");
    lines.push(
      "Produce a revised SemanticInterpretation JSON object. Apply the doctor's correction. Keep the same hard rules.",
    );
  } else {
    lines.push("");
    lines.push(
      "Produce one SemanticInterpretation JSON object now. Return JSON only.",
    );
  }

  return lines.join("\n");
}
