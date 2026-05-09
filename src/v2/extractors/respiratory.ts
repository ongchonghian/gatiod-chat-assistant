import type {
  ExtractedFact,
  NormalizedUtterance,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import type {
  AsbestosisProfusionBand,
  AsthmaMaintenanceMedication,
  DiagnosisCategory,
  DyspnoeaSeverity,
} from "../../engine/respiratoryData.js";

// ── Fact key constants (shared with argBuilder) ──────────────────────────────

export const RESP_FK_DIAGNOSIS            = "resp_diagnosis";
export const RESP_FK_FVC                  = "resp_fvc";
export const RESP_FK_FEV1                 = "resp_fev1";
export const RESP_FK_DLCO                 = "resp_dlco";
export const RESP_FK_VO2MAX               = "resp_vo2max";
export const RESP_FK_DYSPNOEA             = "resp_dyspnoea";
export const RESP_FK_ASTHMA_MAINT         = "resp_asthma_daily_maintenance";
export const RESP_FK_ASTHMA_TRANSFER      = "resp_asthma_transferred";
export const RESP_FK_ASTHMA_IMPROVE       = "resp_asthma_unlikely_improvement";
export const RESP_FK_ASTHMA_MED           = "resp_asthma_medication";
export const RESP_FK_ASBESTOSIS_RADIO     = "resp_asbestosis_radiological";
export const RESP_FK_ASBESTOSIS_PROFUSION = "resp_asbestosis_profusion";

// ── Pattern tables ────────────────────────────────────────────────────────────

const DIAGNOSIS_ASTHMA_RE     = /\b(occupational\s+asthma)\b/i;
const DIAGNOSIS_ASBESTOSIS_RE = /\b(asbestosis|silicosis|asbestos\s+related|silica\s+(?:exposure|dust))\b/i;

// PFT values: "FVC 65%", "FVC: 65"
const FVC_RE  = /\bfvc\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
const FEV1_RE = /\bfev[_\s]?1(?!\/fvc)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
const DLCO_RE = /\bdlco\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
const VO2_RE  = /\bvo2\s*(?:max)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i;

// Dyspnoea
const DYSP_NONE_RE     = /\bno\s+(?:dyspnoea|shortness\s+of\s+breath|\bsob\b|breathlessness)\b/i;
const DYSP_MINIMAL_RE  = /\b(?:dyspnoea|sob|breathlessness?)\s+(?:at\s+rest|on\s+minimal|minimal\s+exertion)|(?:at\s+rest|minimal\s+exertion)\s+dyspnoea\b/i;
const DYSP_MODERATE_RE = /\b(?:dyspnoea|sob|breathlessness?)\s+on\s+(?:moderate\s+exertion|climbing)|climbing\s+stairs\b/i;
const DYSP_SEVERE_RE   = /\b(?:dyspnoea|sob|breathlessness?)\s+on\s+(?:severe|heavy|strenuous)\s+exertion|severe\s+exertion\s+(?:dyspnoea|sob)\b/i;

// Occupational asthma prerequisites
//
// Slice-17 — broaden to match the workbook's natural-language phrasings.
// Workbook rows look like:
//   "Occupational asthma requiring daily maintenance bronchodilators only
//    despite transfer from exposure >=1 year"
// The original regexes wanted "requires daily maintenance", "transferred
// from exposure", and explicit "unlikely improvement" wording — none of
// which the workbook uses. We now accept the workbook forms in addition.
// "Requiring chronic respiratory medication" is, clinically, daily
// maintenance therapy by definition — workbook rows like "requiring
// low-dose inhaled steroids" and "requiring oral steroids" satisfy the
// maintenance prerequisite even though they don't use the word
// "maintenance". The medication class itself (inhaled/oral steroids,
// bronchodilators) is chronic-use only.
const ASTHMA_MAINT_RE    = /\b(?:requir(?:es?|ing)\s+(?:daily\s+)?maintenance|daily\s+maintenance\s+(?:therapy|medication|bronchodilators?|inhaled|steroids?)|maintenance\s+(?:therapy|medication)\s+(?:required|daily)|requir(?:es?|ing)\s+(?:daily\s+maintenance\s+)?(?:bronchodilators?|inhaled\s+steroids?|inhaled\s+combination|oral\s+steroids?|low[-\s]dose\s+inhaled|high[-\s]dose\s+inhaled))\b/i;
const ASTHMA_TRANSFER_RE = /\b(?:transferr?(?:ed|ing)?\s+(?:from|away\s+from)\s+exposure|removed?\s+from\s+exposure|one\s+year\s+(?:post[-\s]transfer|since\s+removal|after\s+(?:transfer|removal))|(?:despite\s+)?transfer\s+from\s+exposure(?:\s*(?:>=?|≥)\s*\d+\s+years?)?)\b/i;
// "Improvement unlikely" is implied clinically when the patient is still
// on maintenance medication ≥1 year post-transfer (otherwise they'd be
// off meds). The workbook never spells this out, so we pattern-match
// "≥1 year" in transfer/exposure context as the implicit improve clause.
const ASTHMA_IMPROVE_RE  = /\b(?:unlikely\s+(?:to\s+)?(?:further|any)?\s*improvement|no\s+further\s+improvement|not\s+likely\s+to\s+improve|(?:transfer|exposure)\s*(?:>=?|≥)\s*\d+\s+years?|(?:>=?|≥)\s*1\s+years?\s+(?:post[-\s]?transfer|after\s+transfer|since\s+(?:removal|transfer)))\b/i;

const ASTHMA_MED_ORAL_RE    = /\b(?:oral\s+steroids?|systemic\s+steroids?|oral\s+corticosteroids?|prednisolone|prednisone)\b/i;
const ASTHMA_MED_HIGH_RE    = /\b(?:high[-\s]dose\s+(?:inhaled\s+steroids?|ics)|>800\s*(?:µg|ug)|over\s+800\s*(?:µg|ug)|combination\s+therapy)\b/i;
const ASTHMA_MED_LOW_RE     = /\b(?:low[-\s]dose\s+(?:inhaled\s+steroids?|ics)|low\s+dose\s+steroids?\s+inhaled)\b/i;
const ASTHMA_MED_BRONCHO_RE = /\b(?:bronchodilators?\s+only|bronchodilators?\s+alone|saba\s+only|salbutamol\s+only)\b/i;

// Asbestosis qualifiers
const ASBESTOSIS_RADIO_RE          = /\b(?:radiologically\s+(?:definite|confirmed|proven)|definite\s+on\s+(?:imaging|xray|x-ray|ct|cxr)|confirmed\s+radiologically)\b/i;
const ASBESTOSIS_PROFUSION_HIGH_RE = /\b(?:(?:ilo\s+)?profusion\s+(?:score\s+)?(?:at\s+least\s+1\/1|1\/1|1\/2|2\/1|2\/2|3\/2|3\/3)|at\s+least\s+1\/1|≥\s*1\/1)\b/i;
const ASBESTOSIS_PROFUSION_LOW_RE  = /\b(?:(?:ilo\s+)?profusion\s+(?:score\s+)?(?:below\s+1\/1|0\/1|1\/0|<\s*1\/1)|below\s+1\/1|profusion\s+below)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(value: T, text: string): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: text, confidence: 0.9, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

function extractNumeric(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  if (!m || !m[1]) return null;
  return parseFloat(m[1]);
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractRespiratory(
  utterance: NormalizedUtterance,
  systemState: V2SystemState
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const src  = utterance.raw;
  const patch: V2SystemFacts = {};
  const signals: Partial<import("../contracts.js").SlotSignals> = {};
  const display: Record<string, string> = {};

  // ── Diagnosis type ────────────────────────────────────────────────────────
  if (DIAGNOSIS_ASTHMA_RE.test(text)) {
    patch[RESP_FK_DIAGNOSIS] = makeFact<DiagnosisCategory>("occupational_asthma", src);
    signals.diagnosis = true;
    display["diagnosis"] = "occupational_asthma";
  } else if (DIAGNOSIS_ASBESTOSIS_RE.test(text)) {
    patch[RESP_FK_DIAGNOSIS] = makeFact<DiagnosisCategory>("asbestosis_silicosis", src);
    signals.diagnosis = true;
    display["diagnosis"] = "asbestosis_silicosis";
  } else if (systemState.extractedFacts[RESP_FK_DIAGNOSIS]) {
    signals.diagnosis = true;
  }

  // ── PFT values ────────────────────────────────────────────────────────────
  const fvc    = extractNumeric(text, FVC_RE);
  const fev1   = extractNumeric(text, FEV1_RE);
  const dlco   = extractNumeric(text, DLCO_RE);
  const vo2Max = extractNumeric(text, VO2_RE);

  if (fvc    !== null) { patch[RESP_FK_FVC]    = makeFact(fvc,    src); display["fvc"]    = `${fvc}%`; }
  if (fev1   !== null) { patch[RESP_FK_FEV1]   = makeFact(fev1,   src); display["fev1"]   = `${fev1}%`; }
  if (dlco   !== null) { patch[RESP_FK_DLCO]   = makeFact(dlco,   src); display["dlco"]   = `${dlco}%`; }
  if (vo2Max !== null) { patch[RESP_FK_VO2MAX] = makeFact(vo2Max, src); display["vo2Max"] = `${vo2Max} mL/kg/min`; }

  const hasPft = fvc !== null || fev1 !== null || dlco !== null || vo2Max !== null
    || Boolean(systemState.extractedFacts[RESP_FK_FVC]
            || systemState.extractedFacts[RESP_FK_FEV1]
            || systemState.extractedFacts[RESP_FK_DLCO]
            || systemState.extractedFacts[RESP_FK_VO2MAX]);
  if (hasPft) signals.pft_values = true;

  // ── Dyspnoea ──────────────────────────────────────────────────────────────
  let dyspnoea: DyspnoeaSeverity | undefined;
  if      (DYSP_NONE_RE.test(text))     dyspnoea = "none";
  else if (DYSP_MINIMAL_RE.test(text))  dyspnoea = "on_minimal_exertion";
  else if (DYSP_MODERATE_RE.test(text)) dyspnoea = "on_moderate_exertion";
  else if (DYSP_SEVERE_RE.test(text))   dyspnoea = "on_severe_exertion";

  if (dyspnoea !== undefined) {
    patch[RESP_FK_DYSPNOEA] = makeFact(dyspnoea, src);
    display["dyspnoea"] = dyspnoea;
  }

  // ── Occupational asthma prerequisites ────────────────────────────────────
  if (ASTHMA_MAINT_RE.test(text)) {
    patch[RESP_FK_ASTHMA_MAINT]    = makeFact(true, src);
    display["asthma_daily_maintenance"] = "yes";
  }
  if (ASTHMA_TRANSFER_RE.test(text)) {
    patch[RESP_FK_ASTHMA_TRANSFER] = makeFact(true, src);
    display["asthma_transferred"] = "yes";
  }
  if (ASTHMA_IMPROVE_RE.test(text)) {
    patch[RESP_FK_ASTHMA_IMPROVE]  = makeFact(true, src);
    display["asthma_unlikely_improvement"] = "yes";
  }

  // Merge with existing for the signal check
  const ef = systemState.extractedFacts;
  const hasMaint    = Boolean((patch[RESP_FK_ASTHMA_MAINT]    ?? ef[RESP_FK_ASTHMA_MAINT])?.value);
  const hasTransfer = Boolean((patch[RESP_FK_ASTHMA_TRANSFER] ?? ef[RESP_FK_ASTHMA_TRANSFER])?.value);
  const hasImprove  = Boolean((patch[RESP_FK_ASTHMA_IMPROVE]  ?? ef[RESP_FK_ASTHMA_IMPROVE])?.value);
  if (hasMaint && hasTransfer && hasImprove) signals.asthma_prerequisites = true;

  // Asthma medication
  let asthmaMed: AsthmaMaintenanceMedication | undefined;
  if      (ASTHMA_MED_ORAL_RE.test(text))    asthmaMed = "oral_steroids";
  else if (ASTHMA_MED_HIGH_RE.test(text))    asthmaMed = "high_dose_steroids";
  else if (ASTHMA_MED_LOW_RE.test(text))     asthmaMed = "low_dose_steroids";
  else if (ASTHMA_MED_BRONCHO_RE.test(text)) asthmaMed = "bronchodilators";

  if (asthmaMed !== undefined) {
    patch[RESP_FK_ASTHMA_MED] = makeFact(asthmaMed, src);
    signals.asthma_medication = true;
    display["asthma_medication"] = asthmaMed;
  }

  // ── Asbestosis/silicosis qualifiers ───────────────────────────────────────
  if (ASBESTOSIS_RADIO_RE.test(text)) {
    patch[RESP_FK_ASBESTOSIS_RADIO] = makeFact(true, src);
    display["asbestosis_radiological"] = "yes";
  }

  let profusion: AsbestosisProfusionBand | undefined;
  if      (ASBESTOSIS_PROFUSION_HIGH_RE.test(text)) profusion = "at_least_1_1";
  else if (ASBESTOSIS_PROFUSION_LOW_RE.test(text))  profusion = "below_1_1";

  if (profusion !== undefined) {
    patch[RESP_FK_ASBESTOSIS_PROFUSION] = makeFact(profusion, src);
    signals.asbestosis_profusion = true;
    display["asbestosis_profusion"] = profusion;
  }

  return {
    extractedFactsPatch:        patch,
    pendingObservationsToAdd:   [],
    pendingObservationsToResolve: [],
    slotSignalsPatch:           signals,
    displayValuesPatch:         display,
    warnings:                   [],
  };
}
