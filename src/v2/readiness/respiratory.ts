import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  RESP_FK_DIAGNOSIS,
  RESP_FK_FVC,
  RESP_FK_FEV1,
  RESP_FK_DLCO,
  RESP_FK_VO2MAX,
  RESP_FK_ASTHMA_MAINT,
  RESP_FK_ASTHMA_TRANSFER,
  RESP_FK_ASTHMA_IMPROVE,
  RESP_FK_ASTHMA_MED,
  RESP_FK_ASBESTOSIS_RADIO,
  RESP_FK_ASBESTOSIS_PROFUSION,
} from "../extractors/respiratory.js";

export function validateRespiratoryReadiness(state: V2SystemState): ReadinessResult {
  const ef = state.extractedFacts;

  if (state.pendingObservations.length > 0) {
    return { ready: false, reason: "pending_observations" };
  }

  const diagnosis = (ef[RESP_FK_DIAGNOSIS]?.value ?? "standard") as string;

  const hasFvc    = ef[RESP_FK_FVC]    !== undefined;
  const hasFev1   = ef[RESP_FK_FEV1]   !== undefined;
  const hasDlco   = ef[RESP_FK_DLCO]   !== undefined;
  const hasVo2    = ef[RESP_FK_VO2MAX] !== undefined;
  const hasPft    = hasFvc || hasFev1 || hasDlco || hasVo2;

  if (diagnosis === "occupational_asthma") {
    const hasMaint    = Boolean(ef[RESP_FK_ASTHMA_MAINT]?.value);
    const hasTransfer = Boolean(ef[RESP_FK_ASTHMA_TRANSFER]?.value);
    const hasImprove  = Boolean(ef[RESP_FK_ASTHMA_IMPROVE]?.value);
    const hasMed      = ef[RESP_FK_ASTHMA_MED] !== undefined;
    const allPrereqs  = hasMaint && hasTransfer && hasImprove;

    if (!hasPft && !allPrereqs) {
      return {
        ready: false,
        reason: "no_assessable_input",
        clarificationQuestion: "Please provide PFT values (FVC, FEV1, DLCO, or VO2 Max) or confirm all occupational asthma qualifiers.",
        candidateAnswers: ["Provide FVC/FEV1/DLCO", "Confirm daily maintenance required", "Confirm transferred from exposure ≥1 year", "Confirm unlikely further improvement"],
      };
    }
    if (!hasPft && allPrereqs && !hasMed) {
      return {
        ready: false,
        reason: "missing_asthma_medication",
        clarificationQuestion: "Which maintenance medication is the patient on?",
        candidateAnswers: ["Bronchodilators only", "Low-dose inhaled steroids", "High-dose inhaled steroids", "Oral steroids"],
      };
    }
    return { ready: true };
  }

  if (diagnosis === "asbestosis_silicosis") {
    const hasRadio    = Boolean(ef[RESP_FK_ASBESTOSIS_RADIO]?.value);
    const profusion   = ef[RESP_FK_ASBESTOSIS_PROFUSION]?.value as string | undefined;
    const hasHighProf = profusion === "at_least_1_1";

    if (!hasPft && (!hasRadio || !hasHighProf)) {
      return {
        ready: false,
        reason: "no_assessable_input",
        clarificationQuestion: "Please provide PFT values or confirm asbestosis/silicosis radiological findings and ILO profusion score.",
        candidateAnswers: ["Provide FVC/FEV1/DLCO", "Radiologically definite, profusion ≥ 1/1", "Radiologically definite, profusion < 1/1"],
      };
    }
    return { ready: true };
  }

  // Standard pathway
  if (!hasPft) {
    return {
      ready: false,
      reason: "no_assessable_input",
      clarificationQuestion: "Please provide the PFT results (FVC, FEV1, DLCO, or VO2 Max % predicted).",
      candidateAnswers: ["FVC", "FEV1", "DLCO", "VO2 Max"],
    };
  }

  return { ready: true };
}
