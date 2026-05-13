import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  LL_FK_SIDE,
  LL_FK_ROM_JOINTS,
  LL_FK_NERVE_SELECTIONS,
  LL_FK_ROM_FROM_NERVE,
  LL_FK_LEG_AMPUTATION,
  LL_FK_TOE_AMPUTATIONS,
  LL_FK_SHORTENING_CM,
  type LlRomJointEntry,
  type LlNerveSelectionEntry,
  type LlToeAmputations,
} from "../extractors/lowerLimb.js";

export function validateLowerLimbReadiness(systemState: V2SystemState): ReadinessResult {
  const facts = systemState.extractedFacts;

  if (systemState.pendingObservations.length > 0) {
    const first = systemState.pendingObservations[0];
    return {
      ready: false,
      reason: "pending_observations",
      missingFields: first.missingFields,
      clarificationQuestion: first.clarificationQuestion,
      candidateAnswers: first.candidateAnswers,
    };
  }

  if (!facts[LL_FK_SIDE]) {
    return {
      ready: false,
      reason: "missing_side",
      missingFields: ["side"],
      clarificationQuestion: "Which lower limb is affected — left or right?",
      candidateAnswers: ["Left", "Right"],
      expectedAnswer: { kind: "enum", factKey: LL_FK_SIDE, choices: ["left", "right"] },
    };
  }

  const hasRom = Boolean(
    facts[LL_FK_ROM_JOINTS] &&
    Object.keys(facts[LL_FK_ROM_JOINTS].value as Record<string, LlRomJointEntry>).length > 0
  );
  const hasNerve = Boolean(
    facts[LL_FK_NERVE_SELECTIONS] &&
    (facts[LL_FK_NERVE_SELECTIONS].value as LlNerveSelectionEntry[]).length > 0
  );
  const hasLegAmputation = Boolean(
    facts[LL_FK_LEG_AMPUTATION] && facts[LL_FK_LEG_AMPUTATION].value !== "none"
  );
  const hasToeAmputation = Boolean(
    facts[LL_FK_TOE_AMPUTATIONS] &&
    Object.values(facts[LL_FK_TOE_AMPUTATIONS].value as LlToeAmputations).some((v) => v !== "none")
  );
  const hasShortening = Boolean(
    facts[LL_FK_SHORTENING_CM] &&
    (facts[LL_FK_SHORTENING_CM].value as number) >= 0.5
  );
  const hasDbe = Boolean(
    facts["dbe_selections"] &&
    (facts["dbe_selections"].value as unknown[]).length > 0
  );

  if (!hasRom && !hasNerve && !hasLegAmputation && !hasToeAmputation && !hasShortening && !hasDbe) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["finding_type"],
      clarificationQuestion:
        "What type of lower-limb finding should I assess: amputation, ROM restriction, nerve deficit, shortening, or diagnosis-based injury?",
      candidateAnswers: ["ROM restriction", "Nerve deficit", "DBE injury", "Amputation", "Shortening"],
    };
  }

  if (hasRom && hasNerve && !facts[LL_FK_ROM_FROM_NERVE]) {
    return {
      ready: false,
      reason: "rom_from_nerve_gate",
      missingFields: ["rom_from_nerve"],
      clarificationQuestion:
        "Are the ROM restrictions due to the nerve lesion, or are they independent ROM findings?",
      candidateAnswers: ["Independent ROM", "Due to nerve lesion"],
    };
  }

  return { ready: true };
}
