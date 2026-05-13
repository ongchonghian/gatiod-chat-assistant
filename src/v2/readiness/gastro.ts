import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  GASTRO_FK_SUBSYSTEM,
  GASTRO_FK_COLONAL_SUBPATH,
  GASTRO_FK_LIVER_BILIARY_SUBPATH,
  GASTRO_FK_BRACKET_INDEX,
  GASTRO_FK_PI_PERCENT,
} from "../extractors/gastro.js";
import type { GastroSubSystem } from "../../engine/gastroDigestiveData.js";

export function validateGastroReadiness(state: V2SystemState): ReadinessResult {
  const ef = state.extractedFacts;

  if (state.pendingObservations.length > 0) {
    return { ready: false, reason: "pending_observations" };
  }

  const subsystem = ef[GASTRO_FK_SUBSYSTEM]?.value as GastroSubSystem | undefined;
  if (!subsystem) {
    return {
      ready: false,
      reason: "missing_subsystem",
      clarificationQuestion: "Which gastro-digestive subsystem applies?",
      candidateAnswers: ["Upper GI", "Colon/rectum/anus", "Liver/biliary", "Hernia"],
    };
  }

  if (subsystem === "colonicRectalAnal" && !ef[GASTRO_FK_COLONAL_SUBPATH]) {
    return {
      ready: false,
      reason: "missing_colonal_subpath",
      clarificationQuestion: "Is this colonic/rectal or anal disease?",
      candidateAnswers: ["Colonic & Rectal Disease", "Anal Disease"],
    };
  }

  if (subsystem === "liverBiliary" && !ef[GASTRO_FK_LIVER_BILIARY_SUBPATH]) {
    return {
      ready: false,
      reason: "missing_liver_biliary_subpath",
      clarificationQuestion: "Is this liver disease or biliary tract disease?",
      candidateAnswers: ["Liver Disease", "Biliary Tract Disease"],
    };
  }

  if (ef[GASTRO_FK_BRACKET_INDEX] === undefined) {
    return { ready: false, reason: "missing_bracket", clarificationQuestion: "Which severity class applies?" };
  }

  if (ef[GASTRO_FK_PI_PERCENT] === undefined) {
    return { ready: false, reason: "missing_pi_percent", clarificationQuestion: "What PI% should be assigned?" };
  }

  return { ready: true };
}
