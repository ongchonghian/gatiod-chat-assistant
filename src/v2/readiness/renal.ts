import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  RENAL_FK_SEX,
  RENAL_FK_SERUM_CREATININE,
  RENAL_FK_CREATININE_CLEARANCE,
  RENAL_FK_CKD_STAGE,
  RENAL_FK_CLINICAL_SEVERITY,
} from "../extractors/renal.js";

export function validateRenalReadiness(state: V2SystemState): ReadinessResult {
  const ef = state.extractedFacts;

  if (state.pendingObservations.length > 0) {
    return { ready: false, reason: "pending_observations" };
  }

  if (!ef[RENAL_FK_SEX]) {
    return {
      ready: false,
      reason: "missing_sex",
      clarificationQuestion: "What is the patient's sex? (Required for serum creatinine thresholds.)",
      candidateAnswers: ["Male", "Female"],
    };
  }

  const hasClassifyingInput =
    ef[RENAL_FK_SERUM_CREATININE]     !== undefined ||
    ef[RENAL_FK_CREATININE_CLEARANCE] !== undefined ||
    ef[RENAL_FK_CKD_STAGE]            !== undefined ||
    ef[RENAL_FK_CLINICAL_SEVERITY]    !== undefined;

  if (!hasClassifyingInput) {
    return {
      ready: false,
      reason: "no_classifying_input",
      clarificationQuestion: "Please provide at least one renal function value: serum creatinine, creatinine clearance, CKD stage, or clinical severity.",
      candidateAnswers: ["Serum creatinine (µmol/L)", "Creatinine clearance (mL/min)", "CKD stage", "Clinical severity"],
    };
  }

  return { ready: true };
}
