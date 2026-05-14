// Heuristic outcome-class classifier (ADR-0001).
// Bulk classification by row inspection; per-row hand-labels in
// `outcomeClassOverrides.json` take precedence at fixture-generation time.
//
// Mapping rules (priority order):
//   1. Extraction status indicates intentional skip → `unsupported_safe_fail`.
//   2. Numeric expected PI% present → `exact_calculation`.
//   3. Description present but PI% missing → `clarification_required`.
//   4. Otherwise → `routing_only`.

import type { GatiodSystemKey } from "../../../src/v2/contracts.js";
import type { ExpectedOutcomeClass } from "./scenarioTypes.js";

/** Map workbook chapter labels to GatiodSystemKey. */
export const CHAPTER_TO_SYSTEM: Record<string, GatiodSystemKey> = {
  "Chapter 3 - Upper limb": "upper_limb",
  "Chapter 4 - Lower limb": "lower_limb",
  "Chapter 5 - Spine": "spine",
  "Chapter 6 - Respiratory function": "respiratory",
  "Chapter 7 - Renal function": "renal",
  "Chapter 8 - Gastro digestive tract": "gastro_digestive",
  "Chapter 9 - Hearing": "hearing",
  "Chapter 10 - Central nervous system": "cns",
  "Chapter 11 - Visual function": "visual",
};

/** Cross-system component labels use bare system names. */
export const COMPONENT_SYSTEM_TO_KEY: Record<string, GatiodSystemKey> = {
  "Upper limb": "upper_limb",
  "Lower limb": "lower_limb",
  "Spine": "spine",
  "Respiratory": "respiratory",
  "Renal": "renal",
  "Gastro": "gastro_digestive",
  "Gastro digestive": "gastro_digestive",
  "Gastro-digestive": "gastro_digestive",
  "Hearing": "hearing",
  "CNS": "cns",
  "Central nervous system": "cns",
  "Visual": "visual",
  "Visual function": "visual",
};


const SKIPPED_STATUS_RE = /\b(rejected|skipped|out of scope|unsupported|deferred)\b/i;

export interface HeuristicClassifierInput {
  system: GatiodSystemKey;
  injuryDescription: string | null;
  /** Raw "PI%" cell value as it appears in the workbook (string or number). */
  rawPiPercent: string | number | null;
  /** "Extraction status" cell, if present. */
  extractionStatus?: string | null;
  /** "Side affected" cell, if present. Used by hearing-specific heuristics. */
  sideAffected?: string | null;
}

const HEARING_NID_RE = /\b(noise[-\s]?induced\s+deafness|nid\b|better\s+ear\s+ahl)\b/i;
const HEARING_INJURY_RE = /\b(injury|accident|trauma)\b/i;

/**
 * Hearing-specific gotchas where "PI% present" does NOT mean
 * `exact_calculation`:
 *
 *   1. NID rows do not include the patient's age, but the engine requires
 *      it for presbycusis deduction. Readiness will (correctly) ask for age,
 *      so the right outcome class is `clarification_required`.
 *   2. Bilateral / not-applicable injury rows have AHL but no single
 *      affected ear; the V2 hearing model only supports one affected ear
 *      per injury assessment, so readiness asks which ear is affected.
 */
function hearingNeedsClarification(
  description: string | null,
  side: string | null | undefined,
): boolean {
  if (!description) return false;
  if (HEARING_NID_RE.test(description)) return true;
  const sideRaw = (side ?? "").trim().toLowerCase();
  if (
    HEARING_INJURY_RE.test(description) &&
    (sideRaw === "bilateral" || sideRaw === "not applicable" || sideRaw === "")
  ) {
    return true;
  }
  return false;
}

/**
 * Upper / lower limb V2 model assesses one side per assessment. The
 * assistant correctly asks "which side?" when it can't infer one. Two
 * cases of legitimate `clarification_required`:
 *
 *   1. Workbook "Side affected" is "Bilateral" / "Not applicable" — V2
 *      doesn't yet support combined bilateral assessment.
 *   2. The description doesn't contain a side word at all — common for
 *      Scenario Catalogue (parent) rows, which are side-agnostic by design.
 *      Specific Scenarios rows have side prefixes; catalogue rows don't.
 */
function limbNeedsClarification(
  side: string | null | undefined,
  description: string | null,
): boolean {
  const sideRaw = (side ?? "").trim().toLowerCase();
  if (sideRaw === "bilateral" || sideRaw === "both sides" || sideRaw === "not applicable") {
    return true;
  }
  if (!description) return false;
  // Description-implied bilateral ("both upper limbs", "both legs") — V2
  // assesses one side per assessment, so these need clarification first.
  if (/\bboth\s+(upper\s+limbs?|lower\s+limbs?|legs?|hands?|feet|arms?)\b/i.test(description)) {
    return true;
  }
  // Slice-34 — only treat `left|right|bilateral` as side qualifiers. "Both"
  // alone is too greedy: "Loss of great toe - both phalanges" matched the
  // side-word check, marking the row exact_calculation, but the assistant
  // correctly asks "which lower limb?" since no side is specified.
  if (!/\b(left|right|bilateral)\b/i.test(description)) {
    return true;
  }
  return false;
}

const RESPIRATORY_PATHWAY_RE =
  /\b(occupational\s+asthma|asbestosis|asbestos\s+(?:exposure|profusion)|standard\s+respiratory|workplace\s+asthma)\b/i;

const RESPIRATORY_PFT_RE = /\b(fvc|fev1|dlco|vo2\s*max)\b|\d+\s*%\s*predicted/i;

/**
 * Respiratory engine has three pathways: standard PFT-based, occupational
 * asthma (medication-class driven), and asbestosis (profusion + restriction).
 *
 * Cases that legitimately need clarification:
 *   1. No pathway named — the engine can't pick from PFT numbers alone.
 *   2. Occupational asthma pathway WITHOUT a PFT value — the engine
 *      requires FEV1 > 80 even on the medication-based asthma path
 *      (otherwise it silently returns 0%, which the slice-17 readiness
 *      fix now blocks). Workbook asthma rows describe medication regimens
 *      but no PFT values, so they're structurally clarification_required.
 *   3. Asbestosis pathway WITHOUT radio-confirmation or PFT — same shape.
 */
function respiratoryNeedsClarification(description: string | null): boolean {
  if (!description) return false;
  if (!RESPIRATORY_PATHWAY_RE.test(description)) return true;
  // Pathway present — but does the description carry enough downstream
  // facts to actually compute? Asthma needs FEV1; asbestosis needs profusion.
  const hasPft = RESPIRATORY_PFT_RE.test(description);
  const isAsthma = /\boccupational\s+asthma\b/i.test(description);
  if (isAsthma && !hasPft) return true;
  return false;
}

const RENAL_NUMERIC_RE = /\b\d+(?:\.\d+)?\s*(?:%|mg|µmol|umol|ml\/min|kg)/i;
const RENAL_QUALITATIVE_RE = /\bckd\s+stage|gfr|creatinine|eGFR|crCl|dialysis\b/i;

/**
 * Renal engine needs numeric lab values (serum creatinine, creatinine
 * clearance, eGFR) to compute. Workbook rows like "Solitary kidney,
 * regardless of cause" describe a clinical state without those values; the
 * assistant correctly asks for them. These rows are `clarification_required`,
 * not `exact_calculation`. Rows that include numbers (or explicit qualitative
 * markers like "CKD stage 4") should remain `exact_calculation`.
 */
function renalNeedsClarification(description: string | null): boolean {
  if (!description) return false;
  if (RENAL_NUMERIC_RE.test(description)) return false;
  if (RENAL_QUALITATIVE_RE.test(description)) return false;
  return true;
}

/**
 * CNS workbook rows use policy bracket-criteria language rather than
 * doctor-facing clinical text. The CNS extractor cannot bracket-match
 * these, so they correctly produce `routing_only` (routes to CNS but
 * no slot is filled). Two patterns cover all 26 affected rows:
 *
 *   1. Section-heading prefix: "Consciousness / awareness: Brief repetitive…"
 *      — a CNS section name followed by colon then the bracket description.
 *   2. Aphasia bracket rows: "Minimal disturbance in comprehension…",
 *      "Able to comprehend but unable to produce…" — standalone bracket
 *      criterion without an explicit section prefix.
 */
const CNS_SECTION_PREFIX_RE =
  /^(consciousness\s*[/]\s*awareness|sleep\s+and\s+arousal|mental\s+status|behaviour\s*[/]\s*mood|cranial\s+nerve|vestibulocochlear|station\s+and\s+gait|optic\s+nerve|respiration\s+related|olfactor)/i;
const CNS_APHASIA_BRACKET_RE =
  /^(minimal|moderate|severe)\s+(disturbance|impairment)\s+in\s+(comprehension|production|language)/i;
const CNS_COMPREHENSION_BRACKET_RE = /^(able|unable)\s+to\s+comprehend/i;

function cnsIsRoutingOnly(description: string | null): boolean {
  if (!description) return false;
  if (CNS_SECTION_PREFIX_RE.test(description)) return true;
  if (CNS_APHASIA_BRACKET_RE.test(description)) return true;
  if (CNS_COMPREHENSION_BRACKET_RE.test(description)) return true;
  return false;
}

/**
 * Visual engine readiness validator requires both-eye context before it
 * can call assess_visual. Workbook SPC rows for visual acuity give one
 * eye at a time (after spliceVisualRegion produces "Left eye: visual
 * acuity 6/9") — the assistant correctly routes to visual but asks for
 * the other eye, yielding `routing_only`. Mark these explicitly so the
 * calibration thresholds aren't penalised for correct behaviour.
 *
 * Also mark "6/6" rows: normal vision — the engine asks whether there is
 * a compensable impairment, which is `routing_only` in shadow.
 */
function visualIsRoutingOnly(description: string | null): boolean {
  if (!description) return false;
  // Single-eye acuity rows produced by spliceVisualRegion
  if (/\b(right|left)\s+eye:\s*(visual acuity|legal blindness)/i.test(description)) return true;
  // Normal acuity — engine routes correctly but cannot compute PI without impairment
  if (/\b6\/6\b/.test(description)) return true;
  return false;
}

/**
 * Visual engine assesses one eye at a time. Workbook catalogue rows that
 * describe "any eye" or "one eye" without specifying which require the
 * assistant to ask "which eye?" before calculating. Rows that specify
 * "right eye" or "left eye" explicitly can go direct to extraction.
 *
 * Cases that legitimately need clarification:
 *   1. "in any eye" phrasing — no specific eye given.
 *   2. "legal blindness in one eye" without a side.
 *   3. "remaining horizontal visual field" — catalogue rows omit side.
 *   4. Colour-vision loss without a side.
 */
// Combined regex for visual extractor's CONDITION_PATTERNS (glaucoma, cataract,
// corneal, orbital, mydriasis) — must match the extractor's CONDITION_PATTERNS.
const VISUAL_CONDITION_RE =
  /\b(glaucomat?(?:ous)?|cataract|lens\s+subluxation|corneal\s+(?:opacity|scar|decompensation|damage|scarring)|orbital\s+(?:deformit|enophthalmos|hypoglobus|hyperglobus)|enophthalmos|hypoglobus|hyperglobus|traumatic\s+mydriasis|mydriasis|iris\s+abnormali|pupillary\s+abnormali)\b/i;

// Regex for contrast/glare modifier — mirrors MODIFIER_PATTERNS contrast_glare entry.
const VISUAL_CONTRAST_GLARE_RE =
  /\b(contrast\s+(?:sensitivity\s+)?(?:loss|deficit)|glare\s+(?:sensitivity|disability|acuity)|loss\s+of\s+(?:contrast|glare\s+acuity))\b/i;

// Regex for accommodation/pseudophakia/aphakia modifier — mirrors MODIFIER_PATTERNS.
const VISUAL_ACCOMMODATION_RE =
  /\b(loss\s+of\s+accommodation|pseudophakia|aphakia(?:\s+requiring)?|accommodation\s+(?:loss|impairment))\b/i;

function visualNeedsClarification(description: string | null): boolean {
  if (!description) return false;
  if (/\bin any eye\b/i.test(description)) return true;
  if (/\bin one eye\b/i.test(description) && !/\b(right|left)\b/i.test(description)) return true;
  if (/remaining horizontal visual field/i.test(description) && !/\b(right|left)\b/i.test(description)) return true;
  if (/legal blindness/i.test(description) && !/\b(right|left)\b/i.test(description)) return true;
  if (/differentiate colou?r/i.test(description) && !/\b(right|left)\b/i.test(description)) return true;
  // Specific condition or contrast/glare modifier without eye laterality — the V2 visual
  // extractor now requires an explicit eye side rather than silently applying bilaterally.
  const noLaterality = !/\b(right|left|both)\s+eye/i.test(description);
  if (noLaterality && VISUAL_CONDITION_RE.test(description)) return true;
  if (noLaterality && VISUAL_CONTRAST_GLARE_RE.test(description)) return true;
  if (noLaterality && VISUAL_ACCOMMODATION_RE.test(description)) return true;
  return false;
}

export function classifyComponentHeuristic(
  input: HeuristicClassifierInput,
): ExpectedOutcomeClass {
  if (input.extractionStatus && SKIPPED_STATUS_RE.test(input.extractionStatus)) {
    return "unsupported_safe_fail";
  }

  if (input.system === "hearing" && hearingNeedsClarification(input.injuryDescription, input.sideAffected)) {
    return "clarification_required";
  }

  if (
    (input.system === "upper_limb" || input.system === "lower_limb") &&
    limbNeedsClarification(input.sideAffected, input.injuryDescription)
  ) {
    return "clarification_required";
  }

  // Slice-21 — nerve-deficit rows without an explicit total/partial loss
  // qualifier require doctor clarification. Workbook phrasings like
  // "Right Obturator motor deficit" lack the total/partial selection that
  // the V2 nerve extractor requires before assessing.
  if (
    (input.system === "upper_limb" || input.system === "lower_limb") &&
    input.injuryDescription &&
    /\b(sensory|motor|combined)\s+(?:and\s+(?:sensory|motor|combined)\s+)?deficit\b/i.test(input.injuryDescription) &&
    !/\b(total|partial)\b/i.test(input.injuryDescription)
  ) {
    return "clarification_required";
  }

  if (input.system === "cns" && cnsIsRoutingOnly(input.injuryDescription)) {
    return "routing_only";
  }

  if (input.system === "visual" && visualIsRoutingOnly(input.injuryDescription)) {
    return "routing_only";
  }

  if (input.system === "visual" && visualNeedsClarification(input.injuryDescription)) {
    return "clarification_required";
  }

  if (input.system === "respiratory" && respiratoryNeedsClarification(input.injuryDescription)) {
    return "clarification_required";
  }

  // Slice-34 — spine "Neurogenic bladder/bowel: ..." rows describe the
  // bladder/bowel modifier outcome without the parent diagnosis category
  // (fracture / cord injury / disc / etc). The V2 spine model needs the
  // parent category first, so these are legitimately clarification_required.
  if (
    input.system === "spine" &&
    input.injuryDescription &&
    /^\s*neurogenic\s+bladder\/bowel:/i.test(input.injuryDescription) &&
    !/\b(fracture|dislocation|cord\s+injury|disc|spondy|chronic\s+pain)\b/i.test(input.injuryDescription)
  ) {
    return "clarification_required";
  }

  if (input.system === "renal" && renalNeedsClarification(input.injuryDescription)) {
    return "clarification_required";
  }

  // Gastro engine asks the doctor to pick a value within the bracket
  // (subsystem severity bracket → selected PI%). Because the workbook
  // gives a bracket range and the doctor's selection is required, gastro
  // rows are structurally `clarification_required` — even when the
  // workbook PI% is non-empty. The shadow runner sends only "Confirmed",
  // never a bracket selection, so calculation cannot complete in shadow.
  if (input.system === "gastro_digestive") {
    return "clarification_required";
  }

  const pi = parsePiPercent(input.rawPiPercent);
  if (pi !== null) return "exact_calculation";

  // Workbook range like "0-10%" / "11-30%" — exact_calculation with the
  // observed PI graded against the range. Used by renal (gastro is
  // handled above as always-clarification).
  const piRange = parsePiPercentRange(input.rawPiPercent);
  if (piRange !== null) return "exact_calculation";

  if (input.injuryDescription && input.injuryDescription.trim().length > 0) {
    return "clarification_required";
  }

  return "routing_only";
}

/**
 * Parse a workbook PI% cell into a number, or null if the cell is empty,
 * "TBD", a range like "5-10%", or otherwise non-numeric. Ranges are
 * intentionally treated as missing — call `parsePiPercentRange` to detect
 * a range cell.
 */
export function parsePiPercent(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Reject ranges: "5-10%", "5 to 10%"
  if (/[-–—]|\bto\b/i.test(trimmed)) return null;
  // Reject "TBD" / "—" / "N/A"
  if (/^(tbd|n\/a|—|-|none)$/i.test(trimmed)) return null;
  const match = trimmed.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

/**
 * Parse a range cell like "0-10%", "11-30%", "20% to 30%". Returns
 * [lo, hi] (inclusive) or null if the cell isn't a range.
 *
 * Used by the fixture builder to record expectedPiRange for systems whose
 * workbook PI% values are ranges (gastro, renal). The grader treats an
 * observed PI within the range as an exact-calculation match.
 */
export function parsePiPercentRange(raw: string | number | null | undefined): [number, number] | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return null;
  const trimmed = raw.trim();
  // "0-10%" or "0%-10%" or "20% to 30%"
  const dash = trimmed.match(/(\d+(?:\.\d+)?)\s*%?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*%?/);
  if (dash) return [Number.parseFloat(dash[1]), Number.parseFloat(dash[2])];
  const wordTo = trimmed.match(/(\d+(?:\.\d+)?)\s*%?\s+to\s+(\d+(?:\.\d+)?)\s*%?/i);
  if (wordTo) return [Number.parseFloat(wordTo[1]), Number.parseFloat(wordTo[2])];
  return null;
}
