import { randomUUID } from "crypto";
import type {
  ExtractedFact,
  NormalizedUtterance,
  PendingObservation,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
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

// ── Fact key constants (shared with readiness and argBuilder) ─────────────────

// Section A
export const CNS_FK_G1A           = "cns_g1a_bracketId";   // consciousness
export const CNS_FK_G1B           = "cns_g1b_bracketId";   // episodic (epilepsy)
export const CNS_FK_G1C           = "cns_g1c_bracketId";   // arousal/sleep
export const CNS_FK_G2            = "cns_g2_bracketId";    // mental status / cognition
export const CNS_FK_G2_NEURO      = "cns_g2_neuro_confirmed";
export const CNS_FK_G3            = "cns_g3_bracketId";    // dysphasia / aphasia
export const CNS_FK_G4            = "cns_g4_bracketId";    // emotional / behavioural
export const CNS_FK_G4_PSYCH      = "cns_g4_psych_confirmed";

// Section B
export const CNS_FK_B_OLFACTION        = "cns_b_olfaction_bracketId";
export const CNS_FK_B_FACIAL           = "cns_b_facial_bracketId";
export const CNS_FK_B_EQUILIBRIUM      = "cns_b_equilibrium_bracketId";
export const CNS_FK_B_EQUILIBRIUM_ENT  = "cns_b_equilibrium_ent_confirmed";
export const CNS_FK_B_SWALLOWING       = "cns_b_swallowing_bracketId";
export const CNS_FK_B_STATION_GAIT     = "cns_b_station_gait_bracketId";
export const CNS_FK_B_RESPIRATION      = "cns_b_respiration_bracketId";

// Section C
export const CNS_FK_C_LIMBS = "cns_c_paralysed_limbs";

// ── Bracket chip builders ─────────────────────────────────────────────────────

function bracketChips(brackets: SeverityBracket[]): string[] {
  return brackets.map((b) => `${b.label} (${b.min === b.max ? `${b.min}%` : `${b.min}–${b.max}%`})`);
}

// ── Bracket ID resolution (label → id) ───────────────────────────────────────
// Used by the resolver in pendingObservationResolver.ts. Exported so both
// the extractor (for chip generation) and resolver (for reverse-lookup) share
// the same source.

export function bracketIdFromChip(chip: string, brackets: SeverityBracket[]): string | undefined {
  const norm = chip.toLowerCase().trim();
  // exact match against chip label
  for (const b of brackets) {
    const expected = `${b.label} (${b.min === b.max ? `${b.min}%` : `${b.min}–${b.max}%`})`.toLowerCase();
    if (norm === expected || norm === b.label.toLowerCase() || norm === b.id) return b.id;
  }
  // loose partial match on label start
  for (const b of brackets) {
    if (b.label.toLowerCase().startsWith(norm.slice(0, 10))) return b.id;
  }
  return undefined;
}

// Pre-built chip lists used by extractor and resolver
export const G1A_CHIPS = bracketChips(GROUP1_SUBCATEGORIES[0].brackets as unknown as SeverityBracket[]);
export const G1B_CHIPS = bracketChips(GROUP1_SUBCATEGORIES[1].brackets as unknown as SeverityBracket[]);
export const G1C_CHIPS = bracketChips(GROUP1_SUBCATEGORIES[2].brackets as unknown as SeverityBracket[]);
export const G2_CHIPS  = bracketChips(GROUP2_BRACKETS);
export const G3_CHIPS  = bracketChips(GROUP3_BRACKETS);
export const G4_CHIPS  = bracketChips(GROUP4_BRACKETS);
export const B_OLFACTION_CHIPS     = bracketChips(OLFACTION_BRACKETS);
export const B_FACIAL_CHIPS        = bracketChips(FACIAL_NERVE_BRACKETS);
export const B_EQUILIBRIUM_CHIPS   = bracketChips(EQUILIBRIUM_BRACKETS);
export const B_SWALLOWING_CHIPS    = bracketChips(SWALLOWING_BRACKETS);
export const B_STATION_GAIT_CHIPS  = bracketChips(STATION_GAIT_BRACKETS);
export const B_RESPIRATION_CHIPS   = bracketChips(RESPIRATION_BRACKETS);

export const LIMB_CHIPS = PARALYSED_LIMB_OPTIONS.map((o) => o.label);

// ── Section detection patterns ────────────────────────────────────────────────

// Section A sub-group triggers
const G1A_RE  = /\b(consciousness|awareness|coma|semi.?coma|vegetative|altered\s+consciousness)\b/i;
const G1B_RE  = /\b(epilepsy|epileptic|seizure|seizures|fits\b|paroxysmal|episodic\s+neurological)\b/i;
const G1C_RE  = /\b(arousal|sleep\s+disorder|narcolepsy|hypersomnia|somnolence|alertness)\b/i;
const G2_RE   = /\b(cognitive\s+impairment|cognition|dementia|memory\s+loss|memory\s+impairment|forgetfulness|integrative|neuropsychol)\b/i;
const G3_RE   = /\b(dysphasia|aphasia|language\s+impairment|speech\s+production|language\s+comprehension|expressive\s+aphasia|receptive\s+aphasia)\b/i;
const G4_RE   = /\b(emotional\s+impairment|behavioural\s+impairment|behavioral\s+impairment|psychiatric\s+impairment|mood\s+impairment|personality\s+change|psychiatrist)\b/i;

// Section B component triggers (conservative — require explicit component mention
// to avoid colliding with the spine and respiratory systems)
const B_OLFACTION_RE    = /\b(olfact|anosmia|smell\s+loss|loss\s+of\s+smell)\b/i;
const B_FACIAL_RE       = /\b(facial\s+nerve|facial\s+palsy|facial\s+weakness|bell.?s\s+palsy|cn\s*7|cranial\s+nerve\s+7|7th\s+cranial)\b/i;
const B_EQUILIBRIUM_RE  = /\b(equilibrium|vestibular\s+(?:impairment|disorder)|balance\s+disorder|ent.?confirmed)\b/i;
const B_SWALLOWING_RE   = /\b(swallowing|dysphagia|dysarthria|cranial\s+nerve\s+(?:9|10|12|ix|x|xii)|hoarseness\s+neurological|nasal\s+regurgitation|swallowing\s+difficulty)\b/i;
const B_STATION_GAIT_RE = /\b(station\s+and\s+gait|gait\s+impairment|gait\s+disorder|neurological\s+gait|cns\s+gait|ambulation\s+impairment)\b/i;
const B_RESPIRATION_RE  = /\b(neurological\s+respiration|cns\s+respiration|section\s+b\s+respiration|brainstem\s+respiration|neurogenic\s+respiration)\b/i;

// Section C triggers
const C_RE = /\b(?:paralys(?:ed|is)?|paralyz(?:ed?)?|paresis|tetraplegia|quadriplegia|paraplegia|hemiplegia|tetrapleg|quadripleg|parapleg|hemipleg|section\s+c|paralysed\s+limb)\b/i;

// Spine-complication terms that should NOT map to CNS Section B
const SPINE_NEURO_RE = /\b(bladder|bowel|sexual\s+function|spasms|pressure\s+sore)\b/i;

// ── Bracket matching helpers (return bracketId or null) ───────────────────────

function matchG1bBracket(text: string): string | null {
  if (/\b(uncontrolled|constant|severely\s+limiting)\b/i.test(text)) return "e_uncontrolled";
  if (/\b(severe\s+frequency|supervised|restricted\s+activities|focal\s+or\s+generalized)\b/i.test(text)) return "e_severe_supervised";
  if (/\b(interferes\s+with\s+some|interferes.*daily|some\s+daily\s+activities)\b/i.test(text)) return "e_interferes";
  if (/\b(predictable|unpredictable\s+occurrence|risk\s+or\s+activity\s+limitation)\b/i.test(text)) return "e_predictable";
  return null;
}

function matchG2Bracket(text: string): string | null {
  if (/\b(fragments?\s+remain|fragment\s+only|profound\s+dependency|frequent\s+incontinence)\b/i.test(text)) return "ms_fragment_only";
  if (/\b(severe\s+memory|severe.*cognit|significant\s+dependence)\b/i.test(text)) return "ms_severe";
  if (/\b(moderate\s+memory|moderate.*integrat|affecting\s+everyday)\b/i.test(text)) return "ms_moderate";
  if (/\b(slight\s+forgetfulness|minor\s+integrative|fully\s+self.?caring)\b/i.test(text)) return "ms_slight";
  return null;
}

function matchG3Bracket(text: string): string | null {
  if (/\b(complete\s+inability|unintelligible|inappropriate\s+language|cannot\s+communicate)\b/i.test(text)) return "co_severe_or_complete";
  if (/\b(moderate\s+(?:impairment|dysphasia|aphasia)|moderate.*language)\b/i.test(text)) return "co_moderate";
  if (/\b(minimal\s+(?:disturbance|dysphasia|aphasia)|minimal.*language)\b/i.test(text)) return "co_minimal";
  return null;
}

function matchG4Bracket(text: string): string | null {
  if (/\b(severe\s+(?:limitation|impairment)|major\s+dependence|total\s+dependence)\b/i.test(text)) return "em_severe";
  if (/\b(moderate\s+(?:limitation|impairment)|moderate.*social)\b/i.test(text)) return "em_moderate";
  if (/\bmild\b/i.test(text) && /\b(limitation|impairment|social|daily|adl)\b/i.test(text)) return "em_mild";
  return null;
}

function matchFacialBracket(text: string): string | null {
  if (/\b(severe\s+bilateral|bilateral.*severe\s+paralysis)\b/i.test(text)) return "fn_severe_bilateral";
  if (/\b(mild.?moderate\s+bilateral|severe\s+unilateral|eyelid\s+control\s+loss|>=?\s*75\s*%?\s+involvement)\b/i.test(text)) return "fn_mildmoderate_bilateral_or_severe_unilateral";
  if (/\b(taste\s+loss|mild\s+unilateral|anterior\s+tongue)\b/i.test(text)) return "fn_mild_unilateral";
  return null;
}

function matchEquilibriumBracket(text: string): string | null {
  if (/\b(assistance\s+required|confined|ambulation\s+assistance|can.*not\s+stand)\b/i.test(text)) return "eq_severe_assisted";
  if (/\b(all\s+daily\s+activities|limited.*all\s+activities|self.?care.*limited)\b/i.test(text)) return "eq_moderate_to_mod_severe";
  if (/\b(hazardous\s+surroundings?|limited\s+only\s+in\s+hazardous)\b/i.test(text)) return "eq_minimal";
  return null;
}

function matchSwallowingBracket(text: string): string | null {
  if (/\b(cannot\s+swallow|unable\s+to\s+swallow|requires\s+suctioning|severe\s+inability)\b/i.test(text)) return "sw_severe";
  if (/\b(moderately\s+severe|hoarseness|nasal\s+regurgitation|aspiration)\b/i.test(text)) return "sw_moderately_severe";
  if (/\b(mild\s+dys(?:arthria|phagia)|choking\s+on\s+liquids|choking\s+on\s+semisolids)\b/i.test(text)) return "sw_mild";
  return null;
}

function matchStationGaitBracket(text: string): string | null {
  if (/\b(cannot\s+walk\s+without\s+assistance|cannot\s+stand|cannot\s+walk\s+unassisted)\b/i.test(text)) return "sg_cannot_walk_or_stand";
  if (/\b(level\s+surface\s+only|limited\s+to\s+level|some\s+distance\s+without\s+assistance)\b/i.test(text)) return "sg_level_only";
  if (/\b(walks\s+with\s+difficulty|difficulty\s+with\s+(?:stairs|elevation|distances))\b/i.test(text)) return "sg_walks_difficult";
  return null;
}

// ── Section C limb matching ───────────────────────────────────────────────────

function detectParalysedLimbs(text: string): string[] {
  const limbs: string[] = [];

  if (/\b(tetraplegia|quadriplegia|tetrapleg|quadripleg)\b/i.test(text)) {
    limbs.push("both_upper_limbs", "both_lower_limbs_or_feet");
    return limbs;
  }
  if (/\b(paraplegia|parapleg)\b/i.test(text)) {
    limbs.push("both_lower_limbs_or_feet");
  }
  if (/\b(hemiplegia|hemipleg)\b/i.test(text)) {
    limbs.push("upper_limb_at_or_above_elbow", "lower_limb_at_or_above_knee");
    return limbs;
  }

  if (/\b(both\s+(?:upper|arms)|bilateral\s+upper|both\s+hands\s+paralys|both\s+arms\s+paralys)\b/i.test(text)) limbs.push("both_upper_limbs");
  else if (/\b(upper\s+limb\s+(?:at\s+or\s+)?above\s+elbow|above.?elbow|shoulder\s+disartic)\b/i.test(text)) limbs.push("upper_limb_at_or_above_elbow");
  else if (/\b(upper\s+limb\s+below\s+elbow|below.?elbow|wrist\s+disartic|hand\s+at\s+wrist)\b/i.test(text)) limbs.push("upper_limb_below_elbow_or_hand");
  else if (/\b(four\s+fingers|four-finger)\b/i.test(text)) limbs.push("one_hand_four_fingers");

  if (!limbs.includes("both_lower_limbs_or_feet")) {
    if (/\b(both\s+(?:lower|legs|feet)|bilateral\s+lower)\b/i.test(text)) limbs.push("both_lower_limbs_or_feet");
    else if (/\b(lower\s+limb\s+(?:at\s+or\s+)?above\s+knee|above.?knee|hip\s+disartic)\b/i.test(text)) limbs.push("lower_limb_at_or_above_knee");
    else if (/\b(lower\s+limb\s+below\s+knee|below.?knee|tibial)\b/i.test(text)) limbs.push("lower_limb_below_knee");
    else if (/\b(syme|at\s+ankle|ankle\s+disartic)\b/i.test(text)) limbs.push("foot_at_ankle_syme");
    else if (/\b(midfoot|chopart|lisfranc)\b/i.test(text)) limbs.push("midfoot");
    else if (/\b(all\s+toes)\b/i.test(text)) limbs.push("all_toes_one_foot");
  }

  return limbs;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(value: T, text: string): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: text, confidence: 0.9, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

function makePending(
  subtype: string,
  system: "cns",
  src: string,
  missingField: string,
  question: string,
  chips: string[],
): PendingObservation {
  return {
    id: randomUUID(),
    system,
    type: "other",
    sourceText: src,
    parsed: { subtype },
    missingFields: [missingField],
    clarificationQuestion: question,
    candidateAnswers: chips,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractCns(
  utterance: NormalizedUtterance,
  systemState: V2SystemState,
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const src  = utterance.raw;
  const ef   = systemState.extractedFacts;
  const patch: V2SystemFacts = {};
  const pending: PendingObservation[] = [];
  const signals: Partial<import("../contracts.js").SlotSignals> = {};

  // ── Guard: spine-complication terms must not populate CNS Section B ──────
  if (SPINE_NEURO_RE.test(text)) {
    pending.push(
      makePending(
        "cns_spine_complication_clarify",
        "cns",
        src,
        "correct_section",
        "Bladder/bowel/sexual function/spasms/pressure sores are spine neurological complications and are not scored under CNS. Are you assessing the spine system instead?",
        ["Yes, this is a spine assessment", "No, continue with CNS assessment"],
      ),
    );
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: {}, warnings: [] };
  }

  // ── Section A — Group 1A (Consciousness) ─────────────────────────────────
  if (G1A_RE.test(text) && !ef[CNS_FK_G1A]) {
    signals.cns_section = true;
    pending.push(
      makePending("cns_g1a_bracket", "cns", src, CNS_FK_G1A,
        "Which Group 1A (Consciousness and Awareness) bracket applies?",
        G1A_CHIPS,
      ),
    );
  } else if (ef[CNS_FK_G1A]) {
    signals.cns_section = true;
  }

  // ── Section A — Group 1B (Episodic / Epilepsy) ───────────────────────────
  if (G1B_RE.test(text) && !ef[CNS_FK_G1B]) {
    signals.cns_section = true;
    const matched = matchG1bBracket(text);
    if (matched) {
      patch[CNS_FK_G1B] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_g1b_bracket", "cns", src, CNS_FK_G1B,
          "Which Group 1B (Episodic Neurological Impairment) bracket applies?",
          G1B_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_G1B]) {
    signals.cns_section = true;
  }

  // ── Section A — Group 1C (Arousal / Sleep) ───────────────────────────────
  if (G1C_RE.test(text) && !ef[CNS_FK_G1C]) {
    signals.cns_section = true;
    pending.push(
      makePending("cns_g1c_bracket", "cns", src, CNS_FK_G1C,
        "Which Group 1C (Arousal and Sleep Disorders) bracket applies?",
        G1C_CHIPS,
      ),
    );
  } else if (ef[CNS_FK_G1C]) {
    signals.cns_section = true;
  }

  // ── Section A — Group 2 (Mental Status / Cognition) ──────────────────────
  if (G2_RE.test(text) && !ef[CNS_FK_G2]) {
    signals.cns_section = true;
    const matched = matchG2Bracket(text);
    if (matched) {
      patch[CNS_FK_G2] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_g2_bracket", "cns", src, CNS_FK_G2,
          "Which Group 2 (Mental Status and Cognition) bracket applies?",
          G2_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_G2]) {
    signals.cns_section = true;
  }

  // Neuropsychologist confirmation for Group 2
  const g2BracketId = (patch[CNS_FK_G2] ?? ef[CNS_FK_G2])?.value as string | undefined;
  if (g2BracketId && g2BracketId !== "ms_none" && !ef[CNS_FK_G2_NEURO]) {
    if (/\bneuropsychologist\b/i.test(text) && /\bconfirm/i.test(text)) {
      patch[CNS_FK_G2_NEURO] = makeFact(true, src);
    } else {
      pending.push(
        makePending("cns_g2_confirm", "cns", src, CNS_FK_G2_NEURO,
          "Has a neuropsychologist confirmed the Group 2 (cognitive) impairment?",
          ["Yes, neuropsychologist confirmed", "No"],
        ),
      );
    }
  }

  // ── Section A — Group 3 (Language / Dysphasia) ───────────────────────────
  if (G3_RE.test(text) && !ef[CNS_FK_G3]) {
    signals.cns_section = true;
    const matched = matchG3Bracket(text);
    if (matched) {
      patch[CNS_FK_G3] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_g3_bracket", "cns", src, CNS_FK_G3,
          "Which Group 3 (Dysphasia/Aphasia) bracket applies?",
          G3_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_G3]) {
    signals.cns_section = true;
  }

  // ── Section A — Group 4 (Emotional / Behavioural) ────────────────────────
  if (G4_RE.test(text) && !ef[CNS_FK_G4]) {
    signals.cns_section = true;
    const matched = matchG4Bracket(text);
    if (matched) {
      patch[CNS_FK_G4] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_g4_bracket", "cns", src, CNS_FK_G4,
          "Which Group 4 (Emotional/Behavioural) bracket applies?",
          G4_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_G4]) {
    signals.cns_section = true;
  }

  // Psychiatrist confirmation for Group 4
  const g4BracketId = (patch[CNS_FK_G4] ?? ef[CNS_FK_G4])?.value as string | undefined;
  if (g4BracketId && g4BracketId !== "em_none" && !ef[CNS_FK_G4_PSYCH]) {
    if (/\bpsychiatrist\b/i.test(text) && /\bconfirm/i.test(text)) {
      patch[CNS_FK_G4_PSYCH] = makeFact(true, src);
    } else {
      pending.push(
        makePending("cns_g4_confirm", "cns", src, CNS_FK_G4_PSYCH,
          "Has a psychiatrist confirmed the Group 4 (emotional/behavioural) impairment?",
          ["Yes, psychiatrist confirmed", "No"],
        ),
      );
    }
  }

  // ── Section B — Olfaction ─────────────────────────────────────────────────
  if (B_OLFACTION_RE.test(text) && !ef[CNS_FK_B_OLFACTION]) {
    signals.section_b_component = true;
    if (/\b(no\s+olfact|no\s+smell\s+loss|normal\s+smell)\b/i.test(text)) {
      patch[CNS_FK_B_OLFACTION] = makeFact("ol_none", src);
    } else {
      // anosmia is the only non-zero bracket — auto-select
      patch[CNS_FK_B_OLFACTION] = makeFact("ol_anosmia", src);
    }
  } else if (ef[CNS_FK_B_OLFACTION]) {
    signals.section_b_component = true;
  }

  // ── Section B — Facial Nerve ──────────────────────────────────────────────
  if (B_FACIAL_RE.test(text) && !ef[CNS_FK_B_FACIAL]) {
    signals.section_b_component = true;
    const matched = matchFacialBracket(text);
    if (matched) {
      patch[CNS_FK_B_FACIAL] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_b_facial_bracket", "cns", src, CNS_FK_B_FACIAL,
          "Which facial nerve bracket applies?",
          B_FACIAL_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_B_FACIAL]) {
    signals.section_b_component = true;
  }

  // ── Section B — Equilibrium ───────────────────────────────────────────────
  if (B_EQUILIBRIUM_RE.test(text) && !ef[CNS_FK_B_EQUILIBRIUM]) {
    signals.section_b_component = true;
    const matched = matchEquilibriumBracket(text);
    if (matched) {
      patch[CNS_FK_B_EQUILIBRIUM] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_b_equilibrium_bracket", "cns", src, CNS_FK_B_EQUILIBRIUM,
          "Which equilibrium bracket applies?",
          B_EQUILIBRIUM_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_B_EQUILIBRIUM]) {
    signals.section_b_component = true;
  }

  // ENT confirmation for equilibrium
  const eqBracketId = (patch[CNS_FK_B_EQUILIBRIUM] ?? ef[CNS_FK_B_EQUILIBRIUM])?.value as string | undefined;
  if (eqBracketId && eqBracketId !== "eq_none" && !ef[CNS_FK_B_EQUILIBRIUM_ENT]) {
    if (/\b(?:ent|otolaryngol|ear\s+nose\s+throat)\b/i.test(text) && /\bconfirm/i.test(text)) {
      patch[CNS_FK_B_EQUILIBRIUM_ENT] = makeFact(true, src);
    } else {
      pending.push(
        makePending("cns_b_equilibrium_confirm", "cns", src, CNS_FK_B_EQUILIBRIUM_ENT,
          "Has an ENT (ear, nose and throat) specialist confirmed the equilibrium impairment?",
          ["Yes, ENT confirmed", "No"],
        ),
      );
    }
  }

  // ── Section B — Swallowing (IX/X/XII) ────────────────────────────────────
  if (B_SWALLOWING_RE.test(text) && !ef[CNS_FK_B_SWALLOWING]) {
    signals.section_b_component = true;
    const matched = matchSwallowingBracket(text);
    if (matched) {
      patch[CNS_FK_B_SWALLOWING] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_b_swallowing_bracket", "cns", src, CNS_FK_B_SWALLOWING,
          "Which swallowing/speech (cranial nerves IX/X/XII) bracket applies?",
          B_SWALLOWING_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_B_SWALLOWING]) {
    signals.section_b_component = true;
  }

  // ── Section B — Station and Gait ─────────────────────────────────────────
  if (B_STATION_GAIT_RE.test(text) && !ef[CNS_FK_B_STATION_GAIT]) {
    signals.section_b_component = true;
    const matched = matchStationGaitBracket(text);
    if (matched) {
      patch[CNS_FK_B_STATION_GAIT] = makeFact(matched, src);
    } else {
      pending.push(
        makePending("cns_b_station_gait_bracket", "cns", src, CNS_FK_B_STATION_GAIT,
          "Which station and gait bracket applies?",
          B_STATION_GAIT_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_B_STATION_GAIT]) {
    signals.section_b_component = true;
  }

  // ── Section B — Respiration (CNS neurological) ───────────────────────────
  if (B_RESPIRATION_RE.test(text) && !ef[CNS_FK_B_RESPIRATION]) {
    signals.section_b_component = true;
    pending.push(
      makePending("cns_b_respiration_bracket", "cns", src, CNS_FK_B_RESPIRATION,
        "Which CNS neurological respiration bracket applies?",
        B_RESPIRATION_CHIPS,
      ),
    );
  } else if (ef[CNS_FK_B_RESPIRATION]) {
    signals.section_b_component = true;
  }

  // ── Section C — Paralysed Limbs ───────────────────────────────────────────
  if (C_RE.test(text)) {
    const detected = detectParalysedLimbs(text);
    if (detected.length > 0) {
      const existing = (ef[CNS_FK_C_LIMBS]?.value as string[] | undefined) ?? [];
      const merged   = [...new Set([...existing, ...detected])];
      patch[CNS_FK_C_LIMBS] = makeFact(merged, src);
      signals.paralysed_limbs = true;
    } else {
      // section C mentioned but no specific limb detected
      pending.push(
        makePending("cns_c_limb_pick", "cns", src, CNS_FK_C_LIMBS,
          "Which paralysed limb option applies? (Select all that apply, one at a time.)",
          LIMB_CHIPS,
        ),
      );
    }
  } else if (ef[CNS_FK_C_LIMBS]) {
    signals.paralysed_limbs = true;
  }

  return {
    extractedFactsPatch:          patch,
    pendingObservationsToAdd:     pending,
    pendingObservationsToResolve: [],
    slotSignalsPatch:             signals,
    displayValuesPatch:           {},
    warnings:                     [],
  };
}
