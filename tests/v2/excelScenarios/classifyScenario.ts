// Heuristic outcome-class classifier (ADR-0001 / ADR-0002).
// Bulk classification by row inspection; per-row hand-labels in
// `outcomeClassOverrides.json` take precedence at fixture-generation time.
//
// Mapping rules (priority order):
//   1. CNS / Visual systems → `legacy_deferred` (ADR-0002).
//   2. Extraction status indicates intentional skip → `unsupported_safe_fail`.
//   3. Numeric expected PI% present → `exact_calculation`.
//   4. Description present but PI% missing → `clarification_required`.
//   5. Otherwise → `routing_only`.

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

const DEFERRED_SYSTEMS: ReadonlySet<GatiodSystemKey> = new Set(["cns", "visual"]);

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

export function classifyComponentHeuristic(
  input: HeuristicClassifierInput,
): ExpectedOutcomeClass {
  if (DEFERRED_SYSTEMS.has(input.system)) return "legacy_deferred";

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
