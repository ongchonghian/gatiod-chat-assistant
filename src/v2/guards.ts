import type { V2RenderedResponse } from "./contracts.js";

interface GuardResult {
  ok: boolean;
  reason?: string;
}

const FINAL_PI_LANGUAGE_RE =
  /\b(system-generated\s+GATIOD\s+PI%?|final\s+PI%?|total\s+PI%?|overall\s+PI%?)\s*:?\s*\d+(?:\.\d+)?\s*%/i;

/**
 * V2-010 — Typed semantic validator.
 * Prevents PI% language from appearing without a successful assess_* tool call.
 */
export function validateRenderedResponse(r: V2RenderedResponse): GuardResult {
  const hasFinalPiLanguage = FINAL_PI_LANGUAGE_RE.test(r.message);
  const hasSuccessfulAssessmentTool =
    r.toolEvidence?.success === true && /^assess_/.test(r.toolEvidence.toolName);

  if (
    (r.kind === "assessment_result" || r.kind === "global_result" || hasFinalPiLanguage) &&
    !hasSuccessfulAssessmentTool
  ) {
    return {
      ok: false,
      reason: "Final PI% language requires successful assess_* tool evidence.",
    };
  }

  if (r.kind === "lookup_only") {
    if (
      /\b(final\s+PI|system-generated\s+GATIOD\s+PI|total\s+PI|overall\s+PI)\b/i.test(r.message)
    ) {
      return { ok: false, reason: "Lookup responses must not use final PI% language." };
    }
  }

  return { ok: true };
}

/**
 * Legacy regex guard (still applied to processChat / LLM free-text output).
 */
const LEGACY_PI_CLAIM_RE =
  /\b(?:PI|permanent\s+incapacity|incapacity|final|total).{0,50}\b\d+(?:\.\d+)?\s*%/i;

export function legacyPiGuardFails(message: string): boolean {
  return LEGACY_PI_CLAIM_RE.test(message);
}
