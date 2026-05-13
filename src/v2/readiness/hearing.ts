import type {
  PendingObservation,
  ReadinessResult,
  V2AssessmentInstance,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
} from "../extractors/hearing.js";

// ── Shared core ───────────────────────────────────────────────────────────────
// Both the flat (system-state) and instance-aware validators delegate here.
// `facts` is always an instance-scoped slice: for hearing::global it contains
// both AHLs; for hearing::left_ear / hearing::right_ear it contains only the
// relevant ear's AHL.

function validateHearingCore(
  facts: V2SystemFacts,
  pendingObservations: PendingObservation[]
): ReadinessResult {
  if (pendingObservations.length > 0) {
    return { ready: false, reason: "pending_observations" };
  }

  const path = facts[HEARING_FK_PATH]?.value as "nid" | "injury" | undefined;
  if (!path) {
    return {
      ready: false,
      reason: "missing_path",
      clarificationQuestion: "Is this noise-induced deafness (NID) or injury/accident hearing loss?",
      candidateAnswers: ["Noise-Induced Deafness (NID)", "Injury/Accident"],
    };
  }

  if (path === "nid") {
    if (!facts[HEARING_FK_LEFT_EAR_AHL] || !facts[HEARING_FK_RIGHT_EAR_AHL]) {
      const which =
        !facts[HEARING_FK_LEFT_EAR_AHL] && !facts[HEARING_FK_RIGHT_EAR_AHL]
          ? "both ears"
          : !facts[HEARING_FK_LEFT_EAR_AHL]
          ? "left ear"
          : "right ear";
      return {
        ready: false,
        reason: "missing_ahl",
        clarificationQuestion: `Please provide the average hearing loss (AHL) in dB for the ${which}.`,
        candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
      };
    }
    if (!facts[HEARING_FK_AGE]) {
      return {
        ready: false,
        reason: "missing_age",
        clarificationQuestion: "What is the patient's age? (Required for presbycusis deduction.)",
      };
    }
    return { ready: true };
  }

  // Injury path
  const affectedEar = facts[HEARING_FK_AFFECTED_EARS]?.value as "left" | "right" | undefined;
  if (!affectedEar) {
    return {
      ready: false,
      reason: "missing_affected_ear",
      clarificationQuestion: "Which ear is affected?",
      candidateAnswers: ["Left ear", "Right ear"],
    };
  }
  const ahlKey = affectedEar === "left" ? HEARING_FK_LEFT_EAR_AHL : HEARING_FK_RIGHT_EAR_AHL;
  if (!facts[ahlKey]) {
    return {
      ready: false,
      reason: "missing_ahl",
      clarificationQuestion: `Please provide the AHL in dB for the ${affectedEar} ear.`,
      candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
    };
  }

  return { ready: true };
}

// ── Public validators ─────────────────────────────────────────────────────────

/** Flat system-state validator. Used by the legacy slot path and existing tests. */
export function validateHearingReadiness(state: V2SystemState): ReadinessResult {
  return validateHearingCore(state.extractedFacts, state.pendingObservations);
}

/**
 * Instance-aware validator. Validates a single hearing assessment instance
 * (hearing::global, hearing::left_ear, hearing::right_ear).
 * Uses only the facts and observations scoped to that instance,
 * preventing cross-ear readiness false-positives.
 */
export function validateHearingInstanceReadiness(instance: V2AssessmentInstance): ReadinessResult {
  return validateHearingCore(
    instance.facts as V2SystemFacts,
    instance.pendingObservations
  );
}
