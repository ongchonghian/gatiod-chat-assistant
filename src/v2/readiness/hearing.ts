import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
} from "../extractors/hearing.js";

export function validateHearingReadiness(state: V2SystemState): ReadinessResult {
  const ef = state.extractedFacts;

  if (state.pendingObservations.length > 0) {
    return { ready: false, reason: "pending_observations" };
  }

  const path = ef[HEARING_FK_PATH]?.value as "nid" | "injury" | undefined;
  if (!path) {
    return {
      ready: false,
      reason: "missing_path",
      clarificationQuestion: "Is this noise-induced deafness (NID) or injury/accident hearing loss?",
      candidateAnswers: ["Noise-Induced Deafness (NID)", "Injury/Accident"],
    };
  }

  if (path === "nid") {
    if (!ef[HEARING_FK_LEFT_EAR_AHL] || !ef[HEARING_FK_RIGHT_EAR_AHL]) {
      const which = !ef[HEARING_FK_LEFT_EAR_AHL] && !ef[HEARING_FK_RIGHT_EAR_AHL]
        ? "both ears"
        : !ef[HEARING_FK_LEFT_EAR_AHL] ? "left ear" : "right ear";
      return {
        ready: false,
        reason: "missing_ahl",
        clarificationQuestion: `Please provide the average hearing loss (AHL) in dB for the ${which}.`,
        candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
      };
    }
    if (!ef[HEARING_FK_AGE]) {
      return {
        ready: false,
        reason: "missing_age",
        clarificationQuestion: "What is the patient's age? (Required for presbycusis deduction.)",
      };
    }
    return { ready: true };
  }

  // Injury path
  const affectedEar = ef[HEARING_FK_AFFECTED_EARS]?.value as "left" | "right" | undefined;
  if (!affectedEar) {
    return {
      ready: false,
      reason: "missing_affected_ear",
      clarificationQuestion: "Which ear is affected?",
      candidateAnswers: ["Left ear", "Right ear"],
    };
  }
  const ahlKey = affectedEar === "left" ? HEARING_FK_LEFT_EAR_AHL : HEARING_FK_RIGHT_EAR_AHL;
  if (!ef[ahlKey]) {
    return {
      ready: false,
      reason: "missing_ahl",
      clarificationQuestion: `Please provide the AHL in dB for the ${affectedEar} ear.`,
      candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
    };
  }

  return { ready: true };
}
