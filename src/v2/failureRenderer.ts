import type { V2FailureKind, V2FailureResponse } from "./contracts.js";

const FAILURE_MESSAGES: Record<V2FailureKind, string> = {
  readiness_failed:
    "The findings are not complete enough to calculate. One or more required fields are still missing.",
  stale_confirmation:
    "The confirmed findings changed before the calculation could run. Please re-confirm.",
  arg_builder_failed:
    "The structured assessment arguments could not be assembled from the confirmed findings.",
  schema_validation_failed:
    "The assembled arguments failed the engine schema validation.",
  tool_execution_failed:
    "The assessment tool returned an error during execution.",
  renderer_failed:
    "The result renderer encountered an unexpected error.",
  guard_failed:
    "A safety guard rejected the generated output.",
};

const FAILURE_INTRO =
  "I could not complete the structured V2 calculation for this confirmed assessment.";

const FALLBACK_CHIPS = ["Review findings", "Retry structured calculation", "Use legacy mode"];

/**
 * V2-011 — Build a user-facing V2 failure response.
 * No silent fallback — doctor must explicitly choose an action.
 */
export function renderV2Failure(
  failureKind: V2FailureKind,
  detail?: string,
  auditRef?: string
): V2FailureResponse {
  const reasonDetail = detail ? `\n\nDetail: ${detail}` : "";
  const message = [
    FAILURE_INTRO,
    ``,
    `Reason: ${FAILURE_MESSAGES[failureKind]}${reasonDetail}`,
    ``,
    `No PI% has been generated.`,
    ``,
    `You can:`,
    `- Review the confirmed findings`,
    `- Retry the structured calculation`,
    `- Use legacy assessment mode for this case`,
  ].join("\n");

  return {
    kind: "v2_failure",
    failureKind,
    message,
    suggestedChips: FALLBACK_CHIPS,
    allowLegacyFallback: true,
    auditRef,
  };
}
