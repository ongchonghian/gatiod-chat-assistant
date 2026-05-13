/**
 * Lower limb LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 * Responsible for two things the generic layer cannot do:
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *      Mirrors the signals set by extractors/lowerLimb.ts on the regex path.
 *
 *   2. validateLowerLimbReadinessFromSchema — wraps deriveReadinessValidator
 *      with the cross-slot "at least one assessable finding stream" check and
 *      the ROM-from-nerve gate.
 *
 * Register in systemRegistry.ts:
 *   slotSchema:      lowerLimbSlotSchema
 *   shadowExtractor: createLowerLimbLlmExtractor(client)
 */

import type {
  ReadinessResult,
  SlotSignals,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { lowerLimbSlotSchema, type LowerLimbFactKey } from "./lowerLimb.js";
import type { SlotDefinition } from "./types.js";

// ── SlotSignals derivation ────────────────────────────────────────────────────
//
// Maps lower limb extracted facts to SlotSignals booleans.
// Mirrors the signals set by extractors/lowerLimb.ts on the regex path.

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function deriveLowerLimbSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (facts["side"]) {
    signals.side = true;
  }

  // bilateral_mode is a flow-control fact — no SlotSignal equivalent, but its
  // presence means amputation_present may be inferred from context once the mode
  // is resolved. No signal mapping needed here; the bilateral queue handles it.

  const romValue = facts["rom_joints"]?.value;
  if (isNonEmpty(romValue)) {
    signals.rom_present = true;
    signals.rom_joint = true;
    signals.rom_measurements = true;
  }

  const nerveValue = facts["nerve_selections"]?.value;
  if (isNonEmpty(nerveValue)) {
    signals.nerve_present = true;
    signals.nerve_details = true;
  }

  const legAmp = facts["leg_amputation"]?.value;
  const hasLegAmp = typeof legAmp === "string" && legAmp !== "none";

  const toeAmps = facts["toe_amputations"]?.value;
  const hasToeAmp =
    typeof toeAmps === "object" &&
    toeAmps !== null &&
    Object.values(toeAmps as Record<string, string>).some((v) => v && v !== "none");

  if (hasLegAmp || hasToeAmp) {
    signals.amputation_present = true;
  }

  const shorteningCm = facts["shortening_cm"]?.value;
  if (typeof shorteningCm === "number" && shorteningCm >= 0.5) {
    signals.shortening_present = true;
    signals.shortening_cm = true;
  }

  const dbeValue = facts["dbe_selections"]?.value;
  if (isNonEmpty(dbeValue)) {
    signals.dbe_present = true;
  }

  if (facts["rom_from_nerve"] !== undefined) {
    signals.rom_from_nerve = true;
  }

  return signals;
}

// ── Readiness validator (schema-derived + cross-slot guards) ──────────────────

/**
 * Readiness validator for the LLM extractor path.
 *
 * Step 1: deriveReadinessValidator evaluates per-slot required_when conditions
 *         (side always required; rom_from_nerve required when both ROM + nerve present).
 *
 * Step 2: Cross-slot guard — at least one assessable finding stream must be
 *         present (ROM, nerve, leg amputation, toe amputation, shortening, or DBE).
 *         This cannot be expressed as a per-slot condition.
 */
export function validateLowerLimbReadinessFromSchema(
  systemState: V2SystemState,
): ReadinessResult {
  const facts = systemState.extractedFacts;

  // D3 invariant — block on unresolved observations first.
  if (systemState.pendingObservations.length > 0) {
    const first = systemState.pendingObservations[0];
    return {
      ready: false,
      reason: "pending_observations",
      missingFields: first.missingFields,
      clarificationQuestion: first.clarificationQuestion,
      candidateAnswers: first.candidateAnswers,
      expectedAnswer: first.expectedAnswer,
    };
  }

  // Step 1 — per-slot conditions from schema (side, rom_from_nerve gate).
  const schemaResult = deriveReadinessValidator(
    lowerLimbSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  // Step 2 — cross-slot: at least one assessable finding stream.
  const hasRom = (() => {
    const v = facts["rom_joints"]?.value;
    return typeof v === "object" && v !== null && Object.keys(v).length > 0;
  })();

  const hasNerve = (() => {
    const v = facts["nerve_selections"]?.value;
    return Array.isArray(v) && v.length > 0;
  })();

  const hasLegAmputation =
    typeof facts["leg_amputation"]?.value === "string" &&
    facts["leg_amputation"]?.value !== "none";

  const hasToeAmputation = (() => {
    const v = facts["toe_amputations"]?.value;
    return (
      typeof v === "object" &&
      v !== null &&
      Object.values(v as Record<string, string>).some((lv) => lv && lv !== "none")
    );
  })();

  const hasShortening =
    typeof facts["shortening_cm"]?.value === "number" &&
    (facts["shortening_cm"]?.value as number) >= 0.5;

  const hasDbe = (() => {
    const v = facts["dbe_selections"]?.value;
    return Array.isArray(v) && v.length > 0;
  })();

  if (!hasRom && !hasNerve && !hasLegAmputation && !hasToeAmputation && !hasShortening && !hasDbe) {
    // Doctor mentioned amputation (e.g. "loss of leg") but no level fact was captured.
    // Skip the generic "what type?" question and ask for the level specifically.
    const hasAmpSignal = Boolean(systemState.slotSignals?.amputation_present);
    if (hasAmpSignal) {
      return {
        ready: false,
        reason: "missing_amp_level",
        missingFields: ["leg_amputation"],
        clarificationQuestion: "At what level was the amputation?",
        candidateAnswers: ["Above knee", "Below knee", "Syme (ankle disarticulation)", "Hindquarter / hip disarticulation"],
        expectedAnswer: { kind: "enum", factKey: "leg_amputation", choices: ["above knee", "below knee", "syme", "hindquarter"] },
      };
    }
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["finding_type"],
      clarificationQuestion:
        "What type of lower-limb finding should I assess: amputation, ROM restriction, nerve deficit, shortening, or diagnosis-based injury?",
      candidateAnswers: [
        "ROM restriction",
        "Nerve deficit",
        "DBE injury",
        "Amputation",
        "Shortening",
      ],
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns the lower limb LLM extractor wired to the provided model client.
 *
 * Usage in systemRegistry.ts:
 *   import { geminiClient } from "../geminiSemanticModelClient.js";
 *   shadowExtractor: createLowerLimbLlmExtractor(geminiClient)
 */
export function createLowerLimbLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<LowerLimbFactKey>({
    system: "lower_limb",
    defs: lowerLimbSlotSchema,
    client,
    deriveSignals: deriveLowerLimbSignals,
  });
}
