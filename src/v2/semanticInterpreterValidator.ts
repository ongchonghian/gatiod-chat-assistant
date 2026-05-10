// Semantic interpreter safety validator (REQ-SC-OUTPUT-001, REQ-SC-PROMPT-001).
//
// Runs AFTER `parseSemanticInterpretation` (Zod) succeeds. Enforces the
// safety rules that cannot be expressed as JSON shape:
//
//   1. Every `sourceSpan` must be a verbatim substring of the original
//      source text. Paraphrases are rejected.
//   2. The interpretation must not contain forbidden tokens anywhere in
//      free-text fields (PI%, "assess_*", tool argument shapes, etc.).
//   3. Each candidate finding's system must appear in `candidateSystems`.
//   4. Legacy-deferred systems (cns/visual under current registry) must be
//      labelled with status `legacy_deferred` if they appear in
//      `candidateSystems`.
//
// The validator is fail-closed: any violation rejects the entire
// interpretation. A rejected interpretation must not be persisted to
// `pendingConsensus` and must not propagate to the deterministic engine.

import type {
  GatiodSystemKey,
  SemanticInterpretation,
} from "./contracts.js";
import { getSemanticSystemStatus } from "./semanticSystemTaxonomy.js";

export type SemanticValidationFailureKind =
  | "missing_source_span"
  | "source_span_not_in_text"
  | "forbidden_pi_token"
  | "forbidden_tool_token"
  | "forbidden_calculation_ready"
  | "finding_system_not_in_candidates"
  | "legacy_system_not_labelled";

export interface SemanticValidationIssue {
  kind: SemanticValidationFailureKind;
  message: string;
  /** Index into `candidateFindings` or `candidateSystems` when applicable. */
  index?: number;
}

export type SemanticValidationResult =
  | { ok: true; interpretation: SemanticInterpretation }
  | { ok: false; issues: SemanticValidationIssue[] };

/** Tokens that must never appear anywhere in semantic output. The list is
 *  intentionally specific — the semantic layer is allowed to mention clinical
 *  terms freely (and even reference the concept "PI%" abstractly); what it
 *  cannot do is leak PI VALUES, name fields/tools, or pre-calculate. The
 *  patterns target value leakage, not concept discussion. */
const FORBIDDEN_PI_PATTERNS: ReadonlyArray<RegExp> = [
  // Field names must never appear (interpreter shouldn't be aware of them).
  /\bpiPercent\b/,
  /\bfinalPercent\b/i,
  // PI followed by an actual numeric value: "PI% 30", "PI%: 30", "PI = 30%".
  /\bpi\s*%\s*[:=]?\s*\d/i,
  // Numeric value followed by "PI": "30% PI".
  /\d+\s*%\s*\bpi\b/i,
  // Explicit "approximately" + number — the PRD's hard no-no.
  /\bapproximately\s+\d+\s*%/i,
  // Final/system-generated PI phrasings.
  /\bsystem-?generated\s+pi\b/i,
  /\bsystem-?generated\s+gatiod\s+pi\b/i,
  /\bfinal\s+pi\b/i,
];

const FORBIDDEN_TOOL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bassess_[a-z_]+\b/i,
  /\btoolName\b/i,
  /\bfunctionDeclarations\b/i,
  /\btool_calls?\b/i,
];

function normalizeForSpanCheck(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function spanAppearsInSource(span: string, sourceText: string): boolean {
  if (!span) return false;
  // Direct match.
  if (sourceText.includes(span)) return true;
  // Whitespace-and-case insensitive match.
  return normalizeForSpanCheck(sourceText).includes(normalizeForSpanCheck(span));
}

function findForbiddenTokens(
  haystack: string,
  patterns: ReadonlyArray<RegExp>,
): string | null {
  for (const p of patterns) {
    const m = haystack.match(p);
    if (m) return m[0];
  }
  return null;
}

/** Concatenate all string fields a model could smuggle forbidden content
 *  through. We don't include `sourceText` (that's the doctor's input,
 *  which legitimately may include numbers like "AHL 90 dB"). */
function gatherFreeText(interpretation: SemanticInterpretation): string {
  const parts: string[] = [];
  for (const sys of interpretation.candidateSystems) {
    parts.push(sys.rationale);
    parts.push(...sys.evidence);
  }
  for (const f of interpretation.candidateFindings) {
    parts.push(f.proposedMapping);
    parts.push(...f.explicitlyStatedFields);
    parts.push(...f.inferredFields);
    parts.push(...f.missingFields);
  }
  parts.push(...interpretation.unsupportedTerms);
  parts.push(...interpretation.assumptions);
  return parts.join("\n");
}

/**
 * Validate a parsed SemanticInterpretation for safety rules. Call AFTER
 * `parseSemanticInterpretation` returns ok. Returns either the validated
 * interpretation or a list of issues.
 */
export function validateSemanticInterpretation(
  interpretation: SemanticInterpretation,
): SemanticValidationResult {
  const issues: SemanticValidationIssue[] = [];

  // 1. Forbidden tokens in free-text.
  const freeText = gatherFreeText(interpretation);
  const piHit = findForbiddenTokens(freeText, FORBIDDEN_PI_PATTERNS);
  if (piHit) {
    issues.push({
      kind: "forbidden_pi_token",
      message: `Interpretation contains forbidden PI token "${piHit}".`,
    });
  }
  const toolHit = findForbiddenTokens(freeText, FORBIDDEN_TOOL_PATTERNS);
  if (toolHit) {
    issues.push({
      kind: "forbidden_tool_token",
      message: `Interpretation contains forbidden tool token "${toolHit}".`,
    });
  }

  // 2. calculationReady is enforced by the Zod schema (z.literal(false))
  //    but we also defend against an interpretation built up programmatically
  //    bypassing the schema.
  for (let i = 0; i < interpretation.candidateFindings.length; i++) {
    const f = interpretation.candidateFindings[i];
    if (f.calculationReady !== false) {
      issues.push({
        kind: "forbidden_calculation_ready",
        message: `candidateFindings[${i}] has calculationReady ≠ false.`,
        index: i,
      });
    }
  }

  // 3. Source-span verification.
  for (let i = 0; i < interpretation.candidateFindings.length; i++) {
    const f = interpretation.candidateFindings[i];
    if (!f.sourceSpan || f.sourceSpan.trim().length === 0) {
      issues.push({
        kind: "missing_source_span",
        message: `candidateFindings[${i}] has empty sourceSpan.`,
        index: i,
      });
      continue;
    }
    if (!spanAppearsInSource(f.sourceSpan, interpretation.sourceText)) {
      issues.push({
        kind: "source_span_not_in_text",
        message: `candidateFindings[${i}] sourceSpan "${f.sourceSpan}" not found in sourceText.`,
        index: i,
      });
    }
  }

  // 4. Each finding's system must appear in candidateSystems.
  const candidateKeys = new Set<GatiodSystemKey>(
    interpretation.candidateSystems.map((s) => s.system),
  );
  for (let i = 0; i < interpretation.candidateFindings.length; i++) {
    const f = interpretation.candidateFindings[i];
    if (!candidateKeys.has(f.system)) {
      issues.push({
        kind: "finding_system_not_in_candidates",
        message: `candidateFindings[${i}] system "${f.system}" not declared in candidateSystems.`,
        index: i,
      });
    }
  }

  // 5. Legacy-deferred systems must be labelled.
  for (let i = 0; i < interpretation.candidateSystems.length; i++) {
    const s = interpretation.candidateSystems[i];
    const expected = getSemanticSystemStatus(s.system);
    if (expected === "legacy_deferred" && s.status !== "legacy_deferred") {
      issues.push({
        kind: "legacy_system_not_labelled",
        message: `candidateSystems[${i}] (${s.system}) is registry-legacy but interpretation labels it "${s.status}".`,
        index: i,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, interpretation };
}
