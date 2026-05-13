// Shared spine-scope vocabulary for gate, renderer, resolver, and extractor.
// ADR-0003 §5 — "Spine scope vocabulary is shared across gate, renderer,
// resolver, and extractor via src/v2/spineScope.ts. Duplicating the region
// regexes across files is not permitted."
//
// Exports:
//   SpineScopeKey, SpineScopeDefinition           — registry of known regions
//   detectSpineScopesFromText()                    — deterministic detection
//   buildSpineScopeChips()                         — chip labels for proposals
//   getSpineScopeLabel()                           — human label for a scope key
//   buildScopedNormalizedUtterance()               — narrows utterance to a scope
//   buildSelectedSpineScopeFromPendingConsensus()  — reconstructs ExtractionContext.selectedScope
//   coerceSourceSpan()                             — V2-807 hydration helper

import type { ExtractionContext, NormalizedUtterance, PendingConsensus } from "./contracts.js";

export type SpineScopeKey =
  | "cervical"
  | "thoracic"
  | "lumbo_sacral"
  | "lumbar"
  | "sacral";

export interface SpineScopeDefinition {
  key: SpineScopeKey;
  label: string;
  chipLabel: string;
  patterns: ReadonlyArray<RegExp>;
}

export const SPINE_SCOPE_DEFINITIONS: ReadonlyArray<SpineScopeDefinition> = [
  {
    key: "cervical",
    label: "Cervical spine",
    chipLabel: "Assess Cervical spine first",
    patterns: [/\bcervical\b/i, /\bc-?spine\b/i, /\bneck\s+spine\b/i],
  },
  {
    key: "thoracic",
    label: "Thoracic spine",
    chipLabel: "Assess Thoracic spine first",
    patterns: [/\bthoracic\b/i, /\bt-?spine\b/i, /\bdorsal\s+spine\b/i],
  },
  {
    key: "lumbo_sacral",
    label: "Lumbo-Sacral spine",
    chipLabel: "Assess Lumbo-Sacral spine first",
    patterns: [/\blumbo[- ]?sacral\b/i, /\bls\s+spine\b/i],
  },
  {
    key: "lumbar",
    label: "Lumbar spine",
    chipLabel: "Assess Lumbar spine first",
    patterns: [/\blumbar\b/i, /\bl-?spine\b/i, /\blow(?:er)?\s+back\s+spine\b/i],
  },
  {
    key: "sacral",
    label: "Sacral spine",
    chipLabel: "Assess Sacral spine first",
    patterns: [/\bsacral\b/i, /\bsacrum\b/i],
  },
];

/** Coerce a legacy `string` sourceSpan to the new `{text, startOffset, endOffset}` shape.
 *  Used during hydration of sessions persisted before V2-807. */
export function coerceSourceSpan(
  span: string | { text: string; startOffset: number; endOffset: number },
): { text: string; startOffset: number; endOffset: number } {
  if (typeof span === "string") {
    return { text: span, startOffset: 0, endOffset: span.length };
  }
  return span;
}

/** Return every scope key whose patterns match the given text. */
export function detectSpineScopesFromText(text: string): SpineScopeKey[] {
  const found: SpineScopeKey[] = [];
  for (const def of SPINE_SCOPE_DEFINITIONS) {
    if (def.patterns.some((p) => p.test(text))) {
      found.push(def.key);
    }
  }
  return found;
}

/** Return the chip labels for an ordered list of detected spine scopes. */
export function buildSpineScopeChips(scopeKeys: SpineScopeKey[]): string[] {
  return scopeKeys.flatMap((key) => {
    const def = SPINE_SCOPE_DEFINITIONS.find((d) => d.key === key);
    return def ? [def.chipLabel] : [];
  });
}

/** Human-readable label for a scope key. */
export function getSpineScopeLabel(key: SpineScopeKey): string {
  return SPINE_SCOPE_DEFINITIONS.find((d) => d.key === key)?.label ?? key;
}

/**
 * Build a narrowed NormalizedUtterance from the source spans in
 * `extractionContext.selectedScope`. The join text is the concatenation of
 * all span texts separated by " ; ". The multi-region hard guard in the spine
 * extractor still runs against this narrowed text — if a bad scope accidentally
 * contains multiple regions the guard fires as designed.
 */
export function buildScopedNormalizedUtterance(
  utterance: NormalizedUtterance,
  context: ExtractionContext,
): NormalizedUtterance {
  const scope = context.selectedScope;
  if (!scope || scope.system !== "spine" || scope.sourceSpans.length === 0) {
    return utterance;
  }
  const coerced = scope.sourceSpans.map(coerceSourceSpan);
  const scopedText = coerced.map((s) => s.text).join(" ; ");
  return {
    ...utterance,
    raw: scopedText,
    normalizedText: scopedText,
    // Tokens are not re-derived here — the spine extractor works on text, not tokens.
    tokens: [],
    mappedTokens: [],
    unresolvedTerms: [],
  };
}

/**
 * Reconstruct an `ExtractionContext.selectedScope` object from a
 * `ClaimComponentOverride` whose `sourceText` was captured at acceptance time.
 * Returns `undefined` when the override has no sourceText or no spine region
 * can be detected from it.
 */
export function buildSelectedSpineScopeFromPendingConsensus(
  pending: PendingConsensus,
  replyText: string,
): ExtractionContext["selectedScope"] | undefined {
  // Detect which scope key the doctor requested from their reply.
  const replyScopes = detectSpineScopesFromText(replyText);
  if (replyScopes.length === 0) return undefined;

  const key = replyScopes[0];
  const def = SPINE_SCOPE_DEFINITIONS.find((d) => d.key === key);
  if (!def) return undefined;

  // Find findings in the pending consensus that match the requested scope.
  const matchingFindings = (pending.candidateFindings ?? []).filter((f) => {
    return f.system === "spine" && def.patterns.some((p) => p.test(f.sourceSpan));
  });

  const sourceSpans =
    matchingFindings.length > 0
      ? matchingFindings.map((f) => ({
          text: f.sourceSpan,
          startOffset: 0,
          endOffset: f.sourceSpan.length,
        }))
      : [{ text: pending.sourceText, startOffset: 0, endOffset: pending.sourceText.length }];

  return {
    system: "spine",
    scopeType: "spine_region",
    scope: def.label,
    sourceSpans,
  };
}
