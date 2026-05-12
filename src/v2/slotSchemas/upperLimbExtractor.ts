/**
 * Upper limb LLM extractor — ADR-0004 pilot.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 * Responsible for two things the generic layer cannot do:
 *
 *   1. deriveSignals — maps extracted factKeys to PresenceSignals booleans.
 *      PresenceSignals keys (rom_present, nerve_present, etc.) do not always
 *      match factKeys — this is the only place that translation lives.
 *
 *   2. validateUpperLimbReadinessFromSchema — wraps deriveReadinessValidator
 *      with the cross-slot "at least one assessable finding stream" check that
 *      cannot be expressed as a per-slot required_when condition.
 *
 * Register in systemRegistry.ts:
 *   extractor:         createUpperLimbLlmExtractor(client)
 *   readinessValidator: validateUpperLimbReadinessFromSchema
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
import {
  upperLimbSlotSchema,
  type UpperLimbFactKey,
} from "./upperLimb.js";
import type { SlotDefinition } from "./types.js";

// ── PresenceSignals derivation ────────────────────────────────────────────────
//
// Maps upper limb extracted facts to PresenceSignals booleans.
// This is the ONLY place PresenceSignals keys are written for the LLM extractor
// path — the generic extractor and SlotDefinition types never touch them.

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function deriveUpperLimbSignals(
  facts: V2SystemFacts
): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (facts["side"]) {
    signals.side = true;
  }

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

  const armAmp = facts["arm_amputation"]?.value;
  const fingerAmps = facts["finger_amputations"]?.value;
  const hasArmAmp = typeof armAmp === "string" && armAmp !== "none";
  const hasFingerAmp =
    typeof fingerAmps === "object" &&
    fingerAmps !== null &&
    Object.values(fingerAmps as Record<string, string>).some(
      (v) => v && v !== "none"
    );
  if (hasArmAmp || hasFingerAmp) {
    signals.amputation_present = true;
  }

  const dbeValue = facts["dbe_selections"]?.value;
  if (isNonEmpty(dbeValue)) {
    signals.dbe_present = true;
  }

  if (facts["rom_from_nerve"]) {
    signals.rom_from_nerve = true;
  }

  return signals;
}

// ── Readiness validator (schema-derived + cross-slot guard) ───────────────────

/**
 * Readiness validator for the LLM extractor path.
 *
 * Step 1: deriveReadinessValidator evaluates per-slot required_when conditions
 *         (side always required; rom_from_nerve required when both ROM + nerve present).
 *
 * Step 2: Cross-slot guard — at least one assessable finding stream must be
 *         present (ROM, nerve, amputation, or DBE). This cannot be expressed
 *         as a per-slot condition; it remains imperative here.
 */
export function validateUpperLimbReadinessFromSchema(
  systemState: V2SystemState
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

  // Step 1 — per-slot conditions from schema.
  const schemaResult = deriveReadinessValidator(
    upperLimbSlotSchema as SlotDefinition[],
    facts
  );
  if (!schemaResult.ready) return schemaResult;

  // Step 2 — cross-slot: at least one assessable finding stream.
  const hasRom = (() => {
    const v = facts["rom_joints"]?.value;
    return (
      typeof v === "object" && v !== null && Object.keys(v).length > 0
    );
  })();
  const hasNerve = (() => {
    const v = facts["nerve_selections"]?.value;
    return Array.isArray(v) && v.length > 0;
  })();
  const hasArmAmp =
    typeof facts["arm_amputation"]?.value === "string" &&
    facts["arm_amputation"]?.value !== "none";
  const hasFingerAmp = (() => {
    const v = facts["finger_amputations"]?.value;
    return (
      typeof v === "object" &&
      v !== null &&
      Object.values(v as Record<string, string>).some(
        (lv) => lv && lv !== "none"
      )
    );
  })();
  const hasDbe = (() => {
    const v = facts["dbe_selections"]?.value;
    return Array.isArray(v) && v.length > 0;
  })();

  if (!hasRom && !hasNerve && !hasArmAmp && !hasFingerAmp && !hasDbe) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["finding_type"],
      clarificationQuestion:
        "What type of upper-limb finding should I assess: ROM restriction, nerve deficit, amputation, or diagnosis-based injury?",
      candidateAnswers: [
        "ROM restriction",
        "Nerve deficit",
        "Amputation",
        "DBE injury",
      ],
    };
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns the upper limb LLM extractor wired to the provided model client.
 *
 * Usage in systemRegistry.ts:
 *   import { geminiClient } from "../geminiSemanticModelClient.js";
 *   extractor: createUpperLimbLlmExtractor(geminiClient)
 */
export function createUpperLimbLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<UpperLimbFactKey>({
    system: "upper_limb",
    defs: upperLimbSlotSchema,
    client,
    deriveSignals: deriveUpperLimbSignals,
  });
}
