/**
 * Meta-intents — deterministic, LLM-free recognition of navigation
 * utterances (status, skip, jump-to, finalise). Slice #10 of the
 * multi-system claim completion PRD; ratified by ADR-0007.
 *
 * Consumed by:
 *   - router.ts as the first gate before existing keyword/synonym scoring.
 *     Non-null result short-circuits routing; null means "fall through".
 *   - Frontend chip clicks (when wired) emit RouteDecisions directly using
 *     these same MetaIntent shapes, bypassing the regex pass.
 *
 * Design rules from ADR-0007:
 *   - The pattern set is exhaustive — adding a new meta-intent means
 *     editing this module + its tests.
 *   - System token resolution reuses `systemSynonyms.ts`. No duplicate table.
 *   - Misses return null and let the existing router run normally — a
 *     graceful fallback, not an error.
 */

import type { GatiodSystemKey, MetaIntent } from "./contracts.js";
import { findContainedSynonyms } from "./systemSynonyms.js";

interface SimplePattern {
  kind: "status" | "finalise_claim";
  re: RegExp;
}

interface SystemPattern {
  kind: "skip_system" | "jump_to_system";
  re: RegExp;
  /** Capture group index containing the system-token. */
  group: number;
}

export const META_INTENT_PATTERNS: ReadonlyArray<SimplePattern | SystemPattern> = [
  // Status — "where are we", "what's left", "summary".
  {
    kind: "status",
    re: /^(?:where\s+are\s+we|what'?s\s+left|status|summary|show\s+me\s+the\s+plan)\??$/i,
  },
  // Finalise — submit / done. Aligned with the existing POST_SUBMIT regex set
  // in policyEngine.ts but kept independent so meta-intents own the surface.
  {
    kind: "finalise_claim",
    re: /^(?:submit(?:\s+claim)?|finali[sz]e|we'?re\s+done|that'?s\s+everything|i'?m\s+done)$/i,
  },
  // Skip — "skip CNS", "drop hearing", "we don't need spine", "exclude renal".
  {
    kind: "skip_system",
    re: /^(?:skip|drop|exclude|we\s+don'?t\s+need|don'?t\s+need)\s+(.+)$/i,
    group: 1,
  },
  // Jump-to — "go back to upper limb", "edit shoulder", "revisit hearing".
  {
    kind: "jump_to_system",
    re: /^(?:go\s+back\s+to|edit|revisit)\s+(.+)$/i,
    group: 1,
  },
];

/**
 * Resolve a free-text system token (e.g. "spine", "upper limb", "shoulder")
 * to a `GatiodSystemKey` via the shared synonym table. Returns null on
 * ambiguous or unrecognised tokens — the caller then returns null overall
 * and the utterance falls through to normal routing.
 */
function resolveSystemToken(token: string): GatiodSystemKey | null {
  const normalized = token.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const tokens = normalized.split(/\s+/);
  const matches = findContainedSynonyms(normalized, tokens);
  if (matches.length === 0) return null;
  // Pick the highest-confidence match. Ties on confidence → the longest term
  // wins (more specific). When that still ties, return null (ambiguous).
  const sorted = [...matches].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.term.length - a.term.length;
  });
  const top = sorted[0];
  const second = sorted[1];
  if (second && second.confidence === top.confidence && second.term.length === top.term.length && second.system !== top.system) {
    return null;
  }
  return top.system;
}

/**
 * Classify an utterance as a meta-intent. Returns null when the input does
 * not match any pattern; routing falls through to the normal pipeline.
 */
export function classifyMetaIntent(utterance: string): MetaIntent | null {
  const trimmed = utterance.trim();
  if (trimmed.length === 0) return null;

  for (const pattern of META_INTENT_PATTERNS) {
    if (pattern.kind === "status" || pattern.kind === "finalise_claim") {
      if (pattern.re.test(trimmed)) {
        return { kind: pattern.kind };
      }
      continue;
    }
    // pattern.kind is "skip_system" | "jump_to_system" here, so the entry
    // is a SystemPattern with a `group` index. TypeScript's narrowing on the
    // earlier `if (pattern.kind === "status" || pattern.kind === "finalise_claim")`
    // branch doesn't propagate after the `continue`, so help it explicitly.
    const sysPattern = pattern as SystemPattern;
    const m = sysPattern.re.exec(trimmed);
    if (!m) continue;
    const token = m[sysPattern.group];
    if (!token) continue;
    const system = resolveSystemToken(token);
    if (!system) {
      // Unresolved system token — fall through to normal routing rather than
      // mis-routing to an arbitrary system.
      return null;
    }
    return { kind: pattern.kind, system };
  }

  return null;
}
