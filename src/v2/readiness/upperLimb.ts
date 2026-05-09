import type { ReadinessResult, V2SystemState } from "../contracts.js";
import {
  FK_ROM_JOINTS,
  FK_NERVE_SELECTIONS,
  FK_SIDE,
  FK_ROM_FROM_NERVE,
  FK_FINGER_AMPUTATIONS,
  type RomJointEntry,
  type NerveSelectionEntry,
} from "../extractors/upperLimb.js";

export function validateUpperLimbReadiness(systemState: V2SystemState): ReadinessResult {
  const facts = systemState.extractedFacts;

  // Block if any observation is still pending — D3 invariant
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

  // Side is required
  if (!facts[FK_SIDE]) {
    return {
      ready: false,
      reason: "missing_side",
      missingFields: ["side"],
      clarificationQuestion: "Which upper limb is affected — left or right?",
      candidateAnswers: ["Left", "Right"],
    };
  }

  // At least one assessable finding stream is required
  const hasRom = Boolean(facts[FK_ROM_JOINTS] &&
    Object.keys(facts[FK_ROM_JOINTS].value as Record<string, RomJointEntry>).length > 0);
  const hasNerve = Boolean(facts[FK_NERVE_SELECTIONS] &&
    (facts[FK_NERVE_SELECTIONS].value as NerveSelectionEntry[]).length > 0);
  const hasArmAmp = Boolean(
    facts["arm_amputation"] && facts["arm_amputation"].value !== "none"
  );
  // Slice-20 — finger amputations also count as an assessable finding.
  // Without this check, "Loss of right index finger - two phalanges"
  // extracts a finger_amputations fact but readiness still asks
  // "what type of upper-limb finding should I assess?".
  const hasFingerAmp = Boolean(
    facts[FK_FINGER_AMPUTATIONS] &&
    Object.values((facts[FK_FINGER_AMPUTATIONS].value as Record<string, string>) ?? {})
      .some((lvl) => lvl && lvl !== "none"),
  );
  const hasAmputation = hasArmAmp || hasFingerAmp;
  const hasDbe = Boolean(
    facts["dbe_selections"] &&
    (facts["dbe_selections"].value as unknown[]).length > 0
  );

  if (!hasRom && !hasNerve && !hasAmputation && !hasDbe) {
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["finding_type"],
      clarificationQuestion:
        "What type of upper-limb finding should I assess: amputation, ROM restriction, nerve deficit, or diagnosis-based injury?",
      candidateAnswers: ["ROM restriction", "Nerve deficit", "DBE injury", "Amputation"],
    };
  }

  // ROM-from-nerve gate: when both ROM and nerve are present, the gate must be answered
  if (hasRom && hasNerve && !facts[FK_ROM_FROM_NERVE]) {
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
