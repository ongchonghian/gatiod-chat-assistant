import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
  CNS_FK_G2, CNS_FK_G2_NEURO,
  CNS_FK_G3,
  CNS_FK_G4, CNS_FK_G4_PSYCH,
  CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL,
  CNS_FK_B_EQUILIBRIUM, CNS_FK_B_EQUILIBRIUM_ENT,
  CNS_FK_B_SWALLOWING, CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  CNS_FK_C_LIMBS,
} from "../extractors/cns.js";
import {
  GROUP1_SUBCATEGORIES,
  GROUP2_BRACKETS,
  GROUP3_BRACKETS,
  GROUP4_BRACKETS,
  OLFACTION_BRACKETS,
  FACIAL_NERVE_BRACKETS,
  EQUILIBRIUM_BRACKETS,
  SWALLOWING_BRACKETS,
  STATION_GAIT_BRACKETS,
  RESPIRATION_BRACKETS,
  PARALYSED_LIMB_OPTIONS,
  type SeverityBracket,
} from "../../engine/cnsAssessmentData.js";

// Bracket id → value (uses min for ranges; conservative default)
function bracketValue(bracketId: string, brackets: SeverityBracket[]): number {
  const b = brackets.find((x) => x.id === bracketId);
  return b ? b.min : 0;
}

// "None" bracket ids for each component
const NONE_IDS = new Set(["c_none", "e_none", "a_none", "ms_none", "co_none", "em_none", "ol_none", "fn_none", "eq_none", "sw_none", "sg_none", "re_none"]);

function isNoneOrMissing(bracketId: string | undefined): boolean {
  return !bracketId || NONE_IDS.has(bracketId);
}

// Check whether any assessable component has a non-zero bracket stored
function hasAnyNonZeroComponent(ef: Record<string, { value: unknown } | undefined>): boolean {
  const bracketKeys = [
    CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
    CNS_FK_G2, CNS_FK_G3, CNS_FK_G4,
    CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL,
    CNS_FK_B_EQUILIBRIUM, CNS_FK_B_SWALLOWING,
    CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  ];
  for (const k of bracketKeys) {
    const v = ef[k]?.value as string | undefined;
    if (v && !NONE_IDS.has(v)) return true;
  }
  const limbs = ef[CNS_FK_C_LIMBS]?.value as string[] | undefined;
  if (limbs && limbs.length > 0) return true;
  return false;
}

export function validateCnsReadiness(state: V2SystemState): ReadinessResult {
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

  // At least one component must have a non-zero assessment
  if (!hasAnyNonZeroComponent(ef as Record<string, { value: unknown } | undefined>)) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["cns_section"],
      clarificationQuestion:
        "Which CNS section applies? (Section A: cerebral impairment, Section B: cranial nerve/neurological, or Section C: paralysed limbs)",
      candidateAnswers: ["Section A", "Section B", "Section C"],
    };
  }

  // Group 2: non-zero bracket requires neuropsychologist confirmation
  const g2 = ef[CNS_FK_G2]?.value as string | undefined;
  if (g2 && !NONE_IDS.has(g2) && ef[CNS_FK_G2_NEURO]?.value !== true) {
    return {
      ready: false,
      reason: "missing_g2_neuro_confirmation",
      missingFields: [CNS_FK_G2_NEURO],
      clarificationQuestion:
        "Group 2 (mental status/cognition) requires neuropsychologist confirmation. Has the impairment been confirmed by a neuropsychologist?",
      candidateAnswers: ["Yes, neuropsychologist confirmed", "No"],
      expectedAnswer: {
        kind: "boolean",
        factKey: CNS_FK_G2_NEURO,
      },
    };
  }

  // Group 4: non-zero bracket requires psychiatrist confirmation
  const g4 = ef[CNS_FK_G4]?.value as string | undefined;
  if (g4 && !NONE_IDS.has(g4) && ef[CNS_FK_G4_PSYCH]?.value !== true) {
    return {
      ready: false,
      reason: "missing_g4_psych_confirmation",
      missingFields: [CNS_FK_G4_PSYCH],
      clarificationQuestion:
        "Group 4 (emotional/behavioural) requires psychiatrist confirmation. Has the impairment been confirmed by a psychiatrist?",
      candidateAnswers: ["Yes, psychiatrist confirmed", "No"],
      expectedAnswer: {
        kind: "boolean",
        factKey: CNS_FK_G4_PSYCH,
      },
    };
  }

  // Equilibrium: non-zero bracket requires ENT confirmation
  const eq = ef[CNS_FK_B_EQUILIBRIUM]?.value as string | undefined;
  if (eq && !NONE_IDS.has(eq) && ef[CNS_FK_B_EQUILIBRIUM_ENT]?.value !== true) {
    return {
      ready: false,
      reason: "missing_equilibrium_ent_confirmation",
      missingFields: [CNS_FK_B_EQUILIBRIUM_ENT],
      clarificationQuestion:
        "Equilibrium impairment requires ENT specialist confirmation. Has the impairment been confirmed by an ENT?",
      candidateAnswers: ["Yes, ENT confirmed", "No"],
      expectedAnswer: {
        kind: "boolean",
        factKey: CNS_FK_B_EQUILIBRIUM_ENT,
      },
    };
  }

  return { ready: true };
}
