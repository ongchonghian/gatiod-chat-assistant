/**
 * Hearing LLM extractor — ADR-0004.
 *
 * Thin system-specific wrapper around createLlmExtractor + deriveReadinessValidator.
 *
 *   1. deriveSignals — maps extracted factKeys to SlotSignals booleans.
 *   2. validateHearingReadinessFromSchema — wraps deriveReadinessValidator with
 *      the cross-slot injury-path AHL check (injury path requires the AHL for the
 *      affected ear, not required_when on a per-slot basis).
 *
 * Register in systemRegistry.ts:
 *   slotSchema:         hearingSlotSchema
 *   shadowExtractor:    createHearingLlmExtractor(client)
 */

import type { ReadinessResult, SlotSignals, V2SystemFacts, V2SystemState } from "../contracts.js";
import type { SemanticModelClient } from "../semanticInterpreter.js";
import { createLlmExtractor } from "./llmSlotExtractor.js";
import { deriveReadinessValidator } from "./deriveReadinessValidator.js";
import { hearingSlotSchema, type HearingFactKey } from "./hearing.js";
import type { SlotDefinition } from "./types.js";

// ── SlotSignals derivation ────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return true;
}

export function deriveHearingSignals(facts: V2SystemFacts): Partial<SlotSignals> {
  const signals: Partial<SlotSignals> = {};

  if (isPresent(facts["hearing_path"]?.value)) {
    signals.path = true;
  }
  if (isPresent(facts["hearing_left_ear_ahl"]?.value)) {
    signals.leftEarAhl = true;
  }
  if (isPresent(facts["hearing_right_ear_ahl"]?.value)) {
    signals.rightEarAhl = true;
  }
  if (isPresent(facts["hearing_age"]?.value)) {
    signals.age = true;
  }
  if (isPresent(facts["hearing_affected_ears"]?.value)) {
    signals.affectedEars = true;
  }
  if (facts["hearing_tinnitus"] !== undefined) {
    signals.tinnitus_mentioned = true;
    signals.tinnitus_gate = true;
  }

  return signals;
}

// ── Readiness validator ───────────────────────────────────────────────────────

export function validateHearingReadinessFromSchema(
  systemState: V2SystemState,
): ReadinessResult {
  const facts = systemState.extractedFacts;

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

  // Per-slot conditions: hearing_path (always), left/right AHLs when nid,
  // age when nid, affected_ears when injury.
  const schemaResult = deriveReadinessValidator(
    hearingSlotSchema as SlotDefinition[],
    facts,
  );
  if (!schemaResult.ready) return schemaResult;

  // Cross-slot: injury path requires the AHL for the specific affected ear.
  const path = facts["hearing_path"]?.value as "nid" | "injury" | undefined;
  if (path === "injury") {
    const affectedEar = facts["hearing_affected_ears"]?.value as "left" | "right" | undefined;
    if (affectedEar) {
      const ahlKey = affectedEar === "left" ? "hearing_left_ear_ahl" : "hearing_right_ear_ahl";
      if (!facts[ahlKey]) {
        return {
          ready: false,
          reason: "missing_ahl",
          missingFields: [ahlKey],
          clarificationQuestion: `Please provide the AHL in dB for the ${affectedEar} ear.`,
          candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
        };
      }
    }
  }

  return { ready: true };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createHearingLlmExtractor(client: SemanticModelClient) {
  return createLlmExtractor<HearingFactKey>({
    system: "hearing",
    defs: hearingSlotSchema,
    client,
    deriveSignals: deriveHearingSignals,
  });
}
