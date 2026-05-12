import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  VISUAL_FK_LEFT_ACUITY,
  VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD,
  VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_LEFT_MODIFIERS,
  VISUAL_FK_RIGHT_MODIFIERS,
  VISUAL_FK_LEFT_CONDITIONS,
  VISUAL_FK_RIGHT_CONDITIONS,
  VISUAL_FK_DIPLOPIA,
  VISUAL_FK_LEFT_ENUCLEATED,
  VISUAL_FK_RIGHT_ENUCLEATED,
} from "../extractors/visual.js";

const VISUAL_ALL_FACT_KEYS = [
  VISUAL_FK_LEFT_ACUITY, VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD,  VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_LEFT_MODIFIERS,  VISUAL_FK_RIGHT_MODIFIERS,
  VISUAL_FK_LEFT_CONDITIONS, VISUAL_FK_RIGHT_CONDITIONS,
  VISUAL_FK_DIPLOPIA,
  VISUAL_FK_LEFT_ENUCLEATED, VISUAL_FK_RIGHT_ENUCLEATED,
];

function hasAnyVisualFact(ef: Record<string, { value: unknown } | undefined>): boolean {
  return VISUAL_ALL_FACT_KEYS.some((k) => ef[k] !== undefined);
}

export function validateVisualReadiness(state: V2SystemState): ReadinessResult {
  const ef = state.extractedFacts;

  if (state.pendingObservations.length > 0) {
    const first = state.pendingObservations[0];
    return {
      ready: false,
      reason: "pending_observations",
      missingFields: first.missingFields,
      clarificationQuestion: first.clarificationQuestion,
      candidateAnswers: first.candidateAnswers,
    };
  }

  if (!hasAnyVisualFact(ef as Record<string, { value: unknown } | undefined>)) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["visual_eye_data"],
      clarificationQuestion:
        "Which visual impairment applies? Please provide Snellen acuity (e.g. 6/12), visual field (degrees), diplopia zone, or specific ophthalmic conditions.",
      candidateAnswers: ["Right eye", "Left eye", "Both eyes", "Diplopia only"],
    };
  }

  return { ready: true };
}
