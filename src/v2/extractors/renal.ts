import { randomUUID } from "crypto";
import type {
  ExtractedFact,
  NormalizedUtterance,
  PendingObservation,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import type { CkdStage, ClinicalSeverity, PatientSex } from "../../engine/renalData.js";

// ── Fact key constants (shared with argBuilder) ──────────────────────────────

export const RENAL_FK_SEX                 = "renal_sex";
export const RENAL_FK_SERUM_CREATININE    = "renal_serum_creatinine";
export const RENAL_FK_CREATININE_CLEARANCE = "renal_creatinine_clearance";
export const RENAL_FK_CKD_STAGE           = "renal_ckd_stage";
export const RENAL_FK_CLINICAL_SEVERITY   = "renal_clinical_severity";
export const RENAL_FK_SOLITARY_KIDNEY     = "renal_solitary_kidney";
export const RENAL_FK_PROVISIONAL_AWARD   = "renal_provisional_award";

// ── Pattern tables ────────────────────────────────────────────────────────────

const SEX_MALE_RE   = /\b(male|man|gentleman)\b/i;
const SEX_FEMALE_RE = /\b(female|woman|lady)\b/i;

// Serum creatinine: "creatinine 150 µmol/L", "SC 180", "serum creatinine: 220"
const SERUM_CREATININE_RE = /\b(?:serum\s+)?creatinine\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:µmol\/l|umol\/l|µmol|umol)?\b/i;

// Creatinine clearance (Cockcroft-Gault): "creatinine clearance 45", "CrCl 38 ml/min", "CC 52"
const CREATININE_CLEARANCE_RE = /\b(?:creatinine\s+clearance|crcl|cc)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:ml\/min)?\b/i;

// CKD stage: "CKD stage 3", "stage 4 CKD", "CKD3"
const CKD_STAGE_RE = /\bckd\s*(?:stage\s*)?([1-5])\b|\bstage\s*([1-5])\s*ckd\b/i;

// Clinical severity
const CLIN_SEV_PERSISTING_RE    = /\b(persisting\s+despite|persists?\s+despite|persisting\s+symptoms?|persistent\s+symptoms?|not\s+controlled|refractory)\b/i;
const CLIN_SEV_INCOMPLETE_RE    = /\b(incompletely\s+controlled|incomplete\s+control|partially\s+controlled)\b/i;
const CLIN_SEV_SURVEILLANCE_RE  = /\b(continuous\s+surveillance|frequent\s+treatment|regular\s+monitoring|ongoing\s+surveillance)\b/i;
const CLIN_SEV_NONE_RE          = /\b(no\s+clinical\s+symptoms?|intermittent|not\s+requiring\s+treatment|asymptomatic)\b/i;

// Solitary kidney
const SOLITARY_KIDNEY_RE    = /\b(solitary\s+kidney|single\s+kidney|one\s+kidney|nephrectomy|unilateral\s+kidney)\b/i;
const NO_SOLITARY_KIDNEY_RE = /\b(both\s+kidneys?|bilateral\s+kidneys?|two\s+kidneys?|no\s+solitary)\b/i;

// Provisional award
const PROVISIONAL_RE    = /\b(provisional\s+award|provisional|not\s+final|interim\s+award)\b/i;
const NOT_PROVISIONAL_RE = /\b(final\s+award|confirmed\s+award|not\s+provisional|permanent\s+award)\b/i;

// eGFR (policy §4 — ask for disambiguation)
const EGFR_RE = /\b(egfr|e-gfr|estimated\s+gfr|gfr)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(value: T, text: string): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: text, confidence: 0.9, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractRenal(
  utterance: NormalizedUtterance,
  systemState: V2SystemState
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const src  = utterance.raw;
  const patch: V2SystemFacts = {};
  const pending: PendingObservation[] = [];
  const signals: Partial<import("../contracts.js").SlotSignals> = {};
  const display: Record<string, string> = {};

  // ── Sex ───────────────────────────────────────────────────────────────────
  if (SEX_FEMALE_RE.test(text)) {
    patch[RENAL_FK_SEX] = makeFact<PatientSex>("female", src);
    signals.sex = true;
    display["sex"] = "female";
  } else if (SEX_MALE_RE.test(text)) {
    patch[RENAL_FK_SEX] = makeFact<PatientSex>("male", src);
    signals.sex = true;
    display["sex"] = "male";
  } else if (systemState.extractedFacts[RENAL_FK_SEX]) {
    signals.sex = true;
  }

  // ── Serum creatinine ──────────────────────────────────────────────────────
  const scMatch = SERUM_CREATININE_RE.exec(text);
  if (scMatch) {
    // Exclude matches that also have "clearance" before "creatinine"
    const beforeMatch = text.slice(0, scMatch.index).toLowerCase();
    if (!beforeMatch.endsWith("clearance ") && !text.slice(scMatch.index, scMatch.index + 30).toLowerCase().includes("clearance")) {
      const sc = parseFloat(scMatch[1]);
      patch[RENAL_FK_SERUM_CREATININE] = makeFact(sc, src);
      signals.renal_inputs = true;
      display["serum_creatinine"] = `${sc} µmol/L`;
    }
  }

  // ── Creatinine clearance ──────────────────────────────────────────────────
  const ccMatch = CREATININE_CLEARANCE_RE.exec(text);
  if (ccMatch) {
    const cc = parseFloat(ccMatch[1]);
    patch[RENAL_FK_CREATININE_CLEARANCE] = makeFact(cc, src);
    signals.renal_inputs = true;
    display["creatinine_clearance"] = `${cc} mL/min`;
  }

  // ── CKD stage ─────────────────────────────────────────────────────────────
  const ckdMatch = CKD_STAGE_RE.exec(text);
  if (ckdMatch) {
    const stage = parseInt(ckdMatch[1] ?? ckdMatch[2], 10) as CkdStage;
    patch[RENAL_FK_CKD_STAGE] = makeFact(stage, src);
    signals.renal_inputs = true;
    display["ckd_stage"] = `Stage ${stage}`;
  }

  // ── Clinical severity ─────────────────────────────────────────────────────
  let clinSev: ClinicalSeverity | undefined;
  if      (CLIN_SEV_PERSISTING_RE.test(text))   clinSev = "persisting";
  else if (CLIN_SEV_INCOMPLETE_RE.test(text))   clinSev = "incompletely_controlled";
  else if (CLIN_SEV_SURVEILLANCE_RE.test(text)) clinSev = "continuous_surveillance";
  else if (CLIN_SEV_NONE_RE.test(text))         clinSev = "none";

  if (clinSev !== undefined) {
    patch[RENAL_FK_CLINICAL_SEVERITY] = makeFact(clinSev, src);
    signals.clinical_severity = true;
    signals.renal_inputs = true;
    display["clinical_severity"] = clinSev;
  }

  // ── Solitary kidney ───────────────────────────────────────────────────────
  if (SOLITARY_KIDNEY_RE.test(text)) {
    patch[RENAL_FK_SOLITARY_KIDNEY] = makeFact(true, src);
    signals.solitary_kidney = true;
    display["solitary_kidney"] = "yes";
  } else if (NO_SOLITARY_KIDNEY_RE.test(text)) {
    patch[RENAL_FK_SOLITARY_KIDNEY] = makeFact(false, src);
    signals.solitary_kidney = true;
    display["solitary_kidney"] = "no";
  }

  // ── Provisional award ─────────────────────────────────────────────────────
  if (NOT_PROVISIONAL_RE.test(text)) {
    patch[RENAL_FK_PROVISIONAL_AWARD] = makeFact(false, src);
    signals.provisional_award = true;
    display["provisional_award"] = "no";
  } else if (PROVISIONAL_RE.test(text)) {
    patch[RENAL_FK_PROVISIONAL_AWARD] = makeFact(true, src);
    signals.provisional_award = true;
    display["provisional_award"] = "yes";
  }

  // ── Policy fix §4 — eGFR disambiguation ──────────────────────────────────
  // If doctor provides eGFR, ask whether CKD-EPI/MDRD (decline) or Cockcroft-Gault (accept as clearance).
  const egfrMatch = EGFR_RE.exec(text);
  if (egfrMatch) {
    const egfrValue = parseFloat(egfrMatch[2]);
    pending.push({
      id: randomUUID(),
      system: "renal",
      type: "other",
      sourceText: src,
      parsed: { subtype: "egfr_disambiguation", egfrValue },
      missingFields: ["creatinine_clearance_or_decline"],
      clarificationQuestion:
        `The value ${egfrValue} mL/min appears to be an eGFR. The engine requires creatinine clearance (Cockcroft-Gault), not eGFR (CKD-EPI/MDRD). Which method was used?`,
      candidateAnswers: [
        "Cockcroft-Gault (accept as creatinine clearance)",
        "CKD-EPI or MDRD (cannot use — provide CKD stage or creatinine instead)",
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return {
    extractedFactsPatch:         patch,
    pendingObservationsToAdd:    pending,
    pendingObservationsToResolve: [],
    slotSignalsPatch:            signals,
    displayValuesPatch:          display,
    warnings:                    [],
  };
}
