/**
 * Prompt assembly for the LLM slot extractor — ADR-0004.
 *
 * Builds a system prompt + user message from a SlotDefinition[] and the
 * doctor's utterance. Follows the same assembly pattern as
 * semanticInterpreterPrompt.ts: safety rules first, output schema second,
 * slot definitions third, utterance last.
 */

import type { SlotDefinition } from "./types.js";

// ── Safety rules (injected first — highest priority) ──────────────────────────

const SAFETY_RULES = `
SAFETY RULES — read before anything else:

1. You are NOT calculating any PI percentage. Do not produce, estimate, or imply any PI%.
2. You are NOT executing any assessment tool. You are a data extractor only.
3. Every extracted value must have a sourceSpan that is a verbatim substring of the
   INPUT UTTERANCE. Do not paraphrase or reconstruct. If you cannot find an exact
   substring, lower your confidence or use status "needs_clarification".
4. For slots marked INFERENCE FORBIDDEN: if the exact term (or a listed synonym) is
   absent from the utterance, you MUST use status "needs_clarification". Do not
   derive the value from context or implication.
5. Do not invent values outside the listed allowedValues for enum slots.
6. Do not add properties beyond the schema. Every object in your response must be strict.
`.trim();

// ── Output schema description ─────────────────────────────────────────────────

const OUTPUT_SCHEMA = `
OUTPUT FORMAT — respond with a single JSON object matching this shape exactly:

{
  "slots": [
    {
      "factKey": "<string — must match a slot factKey listed below>",
      "status": "<"extracted" | "needs_clarification" | "not_mentioned">",
      "value": <the extracted value — required when status is "extracted">,
      "sourceSpan": "<verbatim substring from the utterance — required when status is "extracted" or "needs_clarification">",
      "confidence": <number 0.0–1.0>,
      "clarificationContext": { "<key>": "<value>" }   // optional — for dynamic question personalisation
    }
  ],
  "warnings": ["<non-blocking observation>"]
}

Rules:
- Include one entry per slot where you found signal. Omit slots with no signal at all.
- "extracted": you found the value verbatim (or via a listed synonym). Confidence ≥ 0.8.
- "needs_clarification": you found evidence of the slot but cannot complete it without
  the doctor's input. Use for inference-forbidden fields, ambiguous values, or confidence < 0.8.
- "not_mentioned": omit the entry entirely.
`.trim();

// ── Slot definition formatter ─────────────────────────────────────────────────

function formatSlot(def: SlotDefinition): string {
  const lines: string[] = [
    `--- SLOT: ${def.factKey} ---`,
    `Label: ${def.label}`,
    `Value type: ${def.valueType}`,
  ];

  if (def.allowedValues && def.allowedValues.length > 0) {
    lines.push(`Allowed values: ${def.allowedValues.join(" | ")}`);
  }

  if (def.unit) {
    lines.push(`Unit: ${def.unit}`);
  }

  if (def.clinicalInferenceAllowed) {
    lines.push(`Inference: ALLOWED — extract from context and synonyms.`);
  } else {
    lines.push(
      `Inference: FORBIDDEN — exact term or listed synonym must be present verbatim.`,
      `If absent or ambiguous: use status "needs_clarification".`,
    );
    if (def.clarification) {
      lines.push(
        `Clarification question: "${def.clarification.question}"`,
        `Clarification chips: ${def.clarification.candidateAnswers.length > 0 ? def.clarification.candidateAnswers.join(", ") : "(populated at runtime)"}`,
      );
    }
  }

  lines.push(``, `Description:`, def.description);

  return lines.join("\n");
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface SlotExtractorPromptInputs {
  system: string;
  utterance: string;
  slotDefs: SlotDefinition[];
}

export function buildSlotExtractorSystemPrompt(
  inputs: Pick<SlotExtractorPromptInputs, "system" | "slotDefs">
): string {
  const slotBlock = inputs.slotDefs.map(formatSlot).join("\n\n");

  return [
    SAFETY_RULES,
    "",
    OUTPUT_SCHEMA,
    "",
    `=== SYSTEM: ${inputs.system.toUpperCase().replace(/_/g, " ")} ===`,
    "",
    `Extract facts for the following slots. Only extract what is present in the`,
    `INPUT UTTERANCE. The slots are:`,
    "",
    slotBlock,
  ].join("\n");
}

export function buildSlotExtractorUserMessage(utterance: string): string {
  return `INPUT UTTERANCE:\n${utterance}`;
}
