/**
 * Extractor comparison UI — ADR-0004.
 *
 * Utilities for building and resolving the comparison offer shown when both
 * the primary (regex) extractor and the shadow (LLM) extractor have run on
 * the same utterance and produced output the doctor must review.
 *
 * Responsibilities:
 *   1. detectConflicts       — fact keys with differing values between extractors.
 *   2. mergeExtractionResults — union of both results; primary wins on conflict.
 *   3. buildComparisonOffer  — construct PendingExtractorComparison with message.
 *   4. resolveComparisonChoice — parse the doctor's chip reply.
 *   5. buildSlotCorrectionOffer — "both wrong" → PendingSlotCorrection prompt.
 *   6. isComparisonEnabled   — feature flag guard.
 *
 * The pipeline gate in chatServiceV2.ts checks `state.pendingExtractorComparison`
 * and calls these helpers to resolve the doctor's choice before any other
 * pipeline step runs.
 */

import { randomUUID } from "crypto";
import type {
  GatiodSystemKey,
  PendingExtractorComparison,
  PendingObservation,
  PendingSlotCorrection,
  StructuredExtractionResult,
  V2SystemFacts,
} from "../contracts.js";
import { factKeyLabel, factValueDisplay } from "../clinicalLabels.js";

// ── Feature flag ──────────────────────────────────────────────────────────────

/**
 * Extractor comparison UI is active when LLM_EXTRACTOR_COMPARISON_ENABLED=true|1.
 * When disabled the shadow result falls back to audit-only calibration logging.
 */
export function isComparisonEnabled(): boolean {
  const flag = process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
  return flag === "true" || flag === "1";
}

// ── Conflict detection ────────────────────────────────────────────────────────

/**
 * Returns the fact keys where both extractors produced a value but the
 * serialised values differ. Keys present only in one result are NOT conflicts
 * — they are additive; conflicts require both to have extracted the same key
 * with different content.
 */
export function detectConflicts(
  primary: StructuredExtractionResult,
  shadow: StructuredExtractionResult,
): string[] {
  const conflicts: string[] = [];
  for (const key of Object.keys(primary.extractedFactsPatch)) {
    if (!(key in shadow.extractedFactsPatch)) continue;
    const pv = JSON.stringify(primary.extractedFactsPatch[key]?.value ?? null);
    const sv = JSON.stringify(shadow.extractedFactsPatch[key]?.value ?? null);
    if (pv !== sv) conflicts.push(key);
  }
  return conflicts;
}

// ── Result merge ──────────────────────────────────────────────────────────────

/**
 * Produces a merged StructuredExtractionResult from both sides.
 * Used for "Both correct" resolution.
 *
 * Rules:
 * - Facts: primary wins on shared keys; shadow-only keys are included.
 * - PendingObservations: union with de-dup on missingFields[0].
 * - slotSignalsPatch / displayValuesPatch: same primary-wins merge.
 * - warnings: prefixed by source label and concatenated.
 */
export function mergeExtractionResults(
  primary: StructuredExtractionResult,
  shadow: StructuredExtractionResult,
): StructuredExtractionResult {
  const mergedFacts: V2SystemFacts = {
    ...shadow.extractedFactsPatch,
    ...primary.extractedFactsPatch, // primary wins on conflict
  };

  // De-dup pending observations by their first missingField
  const primaryObs = primary.pendingObservationsToAdd;
  const shadowOnlyObs = shadow.pendingObservationsToAdd.filter(
    (so) =>
      !primaryObs.some(
        (po) => (po.missingFields[0] ?? "") === (so.missingFields[0] ?? ""),
      ),
  );
  const mergedObs: PendingObservation[] = [...primaryObs, ...shadowOnlyObs];

  return {
    extractedFactsPatch: mergedFacts,
    pendingObservationsToAdd: mergedObs,
    pendingObservationsToResolve: [
      ...primary.pendingObservationsToResolve,
      ...shadow.pendingObservationsToResolve,
    ],
    slotSignalsPatch: {
      ...shadow.slotSignalsPatch,
      ...primary.slotSignalsPatch,
    },
    displayValuesPatch: {
      ...shadow.displayValuesPatch,
      ...primary.displayValuesPatch,
    },
    warnings: [
      ...(primary.warnings.length > 0
        ? primary.warnings.map((w) => `[live] ${w}`)
        : []),
      ...(shadow.warnings.length > 0
        ? shadow.warnings.map((w) => `[llm] ${w}`)
        : []),
    ],
  };
}

// ── Display formatting ────────────────────────────────────────────────────────

const SYSTEM_LABELS: Record<GatiodSystemKey, string> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro/Digestive",
  hearing: "Hearing",
  cns: "CNS",
  visual: "Visual",
};

/**
 * Renders a map of fact keys → human-readable values as a bulleted markdown
 * list for the comparison message.
 */
function formatExtractionSummary(
  system: GatiodSystemKey,
  facts: V2SystemFacts,
  displayValues: Record<string, string>,
  pendingObs?: PendingObservation[],
): string {
  const keys = Object.keys(facts);
  const hasPending = pendingObs && pendingObs.length > 0;
  if (keys.length === 0 && !hasPending) return "_No findings captured._";

  const lines = keys.map((k) => {
    const raw = facts[k]?.value;
    const label = factKeyLabel(system, k);
    const isScalar =
      raw === null ||
      raw === undefined ||
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean";
    // For scalars prefer the extractor's display string when present; otherwise
    // use the registry. For objects/arrays always use the registry to avoid JSON.
    const display =
      isScalar && displayValues[k] !== undefined
        ? displayValues[k]
        : factValueDisplay(system, k, raw);
    return `• **${label}**: ${display}`;
  });

  if (hasPending) {
    for (const obs of pendingObs!) {
      lines.push(`• ⏳ *Clarification needed:* ${obs.clarificationQuestion}`);
    }
  }

  return lines.join("\n");
}

// ── Comparison offer builder ──────────────────────────────────────────────────

/**
 * Constructs the `PendingExtractorComparison` after both extractors have
 * settled. Stores both results so the chosen side can be applied later without
 * re-running the extractors.
 */
export function buildComparisonOffer(
  system: GatiodSystemKey,
  sourceText: string,
  primary: StructuredExtractionResult,
  shadow: StructuredExtractionResult,
): PendingExtractorComparison {
  const conflictKeys = detectConflicts(primary, shadow);
  const hasConflicts = conflictKeys.length > 0;
  const systemLabel = SYSTEM_LABELS[system] ?? system;

  const primarySummary = formatExtractionSummary(
    system,
    primary.extractedFactsPatch,
    primary.displayValuesPatch,
    primary.pendingObservationsToAdd,
  );
  const shadowSummary = formatExtractionSummary(
    system,
    shadow.extractedFactsPatch,
    shadow.displayValuesPatch,
    shadow.pendingObservationsToAdd,
  );

  const conflictLabels = conflictKeys.map((k) => factKeyLabel(system, k));
  const conflictLine = hasConflicts
    ? `\n⚠️ **These fields differ:** ${conflictLabels.join(", ")}`
    : "\n✅ Both interpretations agree on all fields";

  const message = [
    `I found two possible interpretations of your **${systemLabel}** input. Please confirm which is more accurate.`,
    "",
    "**Interpretation A:**",
    primarySummary,
    "",
    "**Interpretation B:**",
    shadowSummary,
    conflictLine,
  ].join("\n");

  // "Both are correct" is only valid when there are no conflicts (otherwise the
  // two results disagree on at least one fact value, making "both correct"
  // logically inconsistent).
  const chips: string[] = ["Use interpretation A", "Use interpretation B", "Neither is correct"];
  if (!hasConflicts) chips.push("Both are correct");

  return {
    id: randomUUID(),
    system,
    sourceText,
    primaryResult: primary,
    shadowResult: shadow,
    message,
    hasConflicts,
    chips,
    createdAt: new Date().toISOString(),
  };
}

// ── Choice resolution ─────────────────────────────────────────────────────────

/**
 * Maps the doctor's reply text to one of the four choices.
 * Checks exact chip text first, then falls back to natural-language heuristics.
 * Returns null when the reply is not a recognisable selection.
 */
export function resolveComparisonChoice(
  userMessage: string,
  comparison: PendingExtractorComparison,
): "use_primary" | "use_shadow" | "both_correct" | "both_wrong" | null {
  const msg = userMessage.trim().toLowerCase();

  // Exact chip match (case-insensitive).
  for (const chip of comparison.chips) {
    if (msg === chip.toLowerCase()) {
      return chipToChoice(chip);
    }
  }

  // Natural-language fallbacks.
  if (
    msg.startsWith("use a") ||
    msg === "a" ||
    msg.includes("live") ||
    msg.includes("option a") ||
    msg.includes("first one") ||
    msg.includes("interpretation a")
  ) {
    return "use_primary";
  }
  if (
    msg.startsWith("use b") ||
    msg === "b" ||
    msg.includes("llm") ||
    msg.includes("option b") ||
    msg.includes("second one") ||
    msg.includes("interpretation b")
  ) {
    return "use_shadow";
  }
  if (
    msg.includes("both correct") ||
    msg.includes("both are correct") ||
    msg.includes("agree with both")
  ) {
    // Only valid when there are no conflicts.
    return !comparison.hasConflicts ? "both_correct" : null;
  }
  if (
    msg.includes("both wrong") ||
    msg.includes("both are wrong") ||
    msg.includes("neither") ||
    msg.includes("incorrect") ||
    msg.includes("all wrong")
  ) {
    return "both_wrong";
  }

  return null;
}

function chipToChoice(
  chip: string,
): "use_primary" | "use_shadow" | "both_correct" | "both_wrong" | null {
  const c = chip.toLowerCase();
  if (c.includes("use a") || c.includes("live") || c.includes("interpretation a")) return "use_primary";
  if (c.includes("use b") || c.includes("llm") || c.includes("interpretation b")) return "use_shadow";
  if (c.includes("both correct") || c.includes("both are correct")) return "both_correct";
  if (c.includes("both wrong") || c.includes("neither")) return "both_wrong";
  return null;
}

// ── Slot correction offer ─────────────────────────────────────────────────────

/**
 * Constructs `PendingSlotCorrection` when the doctor chose "Both wrong".
 *
 * The correction offer shows what both extractors captured so the doctor
 * knows which values were wrong, then asks them to re-state the correct
 * findings. On the next turn:
 *   - `pendingSlotCorrection` is cleared.
 *   - The primary extractor re-runs on the correction utterance.
 *   - Shadow is suppressed (via `suppressShadowForSystems`) to avoid
 *     presenting the comparison dialog again for this system.
 */
export function buildSlotCorrectionOffer(
  comparison: PendingExtractorComparison,
): PendingSlotCorrection {
  const systemLabel = SYSTEM_LABELS[comparison.system] ?? comparison.system;

  const primarySummary = formatExtractionSummary(
    comparison.system,
    comparison.primaryResult.extractedFactsPatch,
    comparison.primaryResult.displayValuesPatch,
  );
  const shadowSummary = formatExtractionSummary(
    comparison.system,
    comparison.shadowResult.extractedFactsPatch,
    comparison.shadowResult.displayValuesPatch,
  );

  const message = [
    `Understood — neither interpretation was accurate for **${systemLabel}**. Here is what was captured:`,
    "",
    "**Interpretation A:**",
    primarySummary,
    "",
    "**Interpretation B:**",
    shadowSummary,
    "",
    "Please re-state the correct findings and I will record them.",
  ].join("\n");

  return {
    id: randomUUID(),
    system: comparison.system,
    message,
    createdAt: new Date().toISOString(),
  };
}
