import { randomUUID } from "crypto";
import type {
  ExtractedFact,
  NormalizedUtterance,
  PendingObservation,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import type { ColonalSubPath, GastroSubSystem, LiverBiliarySubPath } from "../../engine/gastroDigestiveData.js";
import { getActiveBrackets } from "../../engine/gastroDigestiveData.js";

// ── Fact key constants ────────────────────────────────────────────────────────

export const GASTRO_FK_SUBSYSTEM            = "gastro_subsystem";
export const GASTRO_FK_COLONAL_SUBPATH      = "gastro_colonal_subpath";
export const GASTRO_FK_LIVER_BILIARY_SUBPATH = "gastro_liver_biliary_subpath";
export const GASTRO_FK_BRACKET_INDEX        = "gastro_bracket_index";
export const GASTRO_FK_WEIGHT_LOSS          = "gastro_weight_loss_percent";
export const GASTRO_FK_PI_PERCENT           = "gastro_pi_percent";
export const GASTRO_FK_CLINICAL_JUSTIFICATION = "gastro_clinical_justification";

// ── Pattern tables (policy fix §3 — all 4 subsystems) ────────────────────────

// Upper digestive (oesophagus, stomach, duodenum, small intestine, pancreas)
const SUBSYS_UPPER_RE = /\b(upper\s+(?:gi|digestive)|oesophag(?:us|eal|al)|esophag|stomach|gastric|duodenal?|duoden|small\s+intestine|pancrea[st]|pylori|gord?|peptic|reflux)\b/i;

// Colonic/rectal/anal (large intestine, rectum, anus) — policy fix §3
const SUBSYS_COLONIC_RE = /\b(colon(?:ic)?|rectal?|rectum|anal|anus|faecal|fecal|colitis|crohn|large\s+intestine|bowel\s+disorder|ibs|inflammatory\s+bowel|diverticular)\b/i;

// Liver/biliary
const SUBSYS_LIVER_BILIARY_RE = /\b(liver|hepatic|hepatitis|cirrhosis|ascites|biliary|bile\s+duct|cholangitis|jaundice|bilirubin)\b/i;

// Herniation — policy fix §3 (was missing from legacy slot policy)
const SUBSYS_HERNIA_RE = /\b(hernia(?:tion)?|hernial|inguinal|femoral|umbilical|incisional|abdominal\s+wall\s+(?:defect|hernia))\b/i;

// Colonal sub-path
const COLONAL_ANAL_RE = /\b(anal|anus|perianal|faecal\s+incontinence|fecal\s+incontinence|anal\s+disease|anorectal)\b/i;

// Liver/biliary sub-path
const LIVER_BILIARY_SUBPATH_RE = /\b(biliary|bile\s+duct|cholangitis|biliary\s+tract|common\s+bile)\b/i;

// Severity bracket
const CLASS_RE = /\bclass\s*([1-4ivIV]+)\b/i;
const CLASS_MAP: Record<string, number> = {
  "1": 0, "i": 0, "ii": 1, "2": 1, "iii": 2, "3": 2, "iv": 3, "4": 3,
};

// PI% — look for explicit PI% or standalone % in gastro context
const PI_EXPLICIT_RE = /\b(?:pi|permanent\s+incapacity|pi%)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?/i;
const PI_PERCENT_RE  = /\b(\d+(?:\.\d+)?)\s*%(?:\s|$|\b)/;

// Weight loss (upper digestive)
const WEIGHT_LOSS_RE = /\bweight\s+loss\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(value: T, text: string): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: text, confidence: 0.9, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

function extractClass(text: string): number | undefined {
  const m = CLASS_RE.exec(text);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  return CLASS_MAP[raw] ?? CLASS_MAP[raw.replace(/^i+$/, (s) => s.length.toString())];
}

function extractPiPercent(text: string): number | undefined {
  const explicit = PI_EXPLICIT_RE.exec(text);
  if (explicit) return parseFloat(explicit[1]);
  const generic = PI_PERCENT_RE.exec(text);
  if (generic) return parseFloat(generic[1]);
  return undefined;
}

function buildBracketChips(subsystem: GastroSubSystem, subPath?: string): string[] {
  const value = { subSystem: subsystem, colonalSubPath: subPath as ColonalSubPath | undefined, liverBiliarySubPath: subPath as LiverBiliarySubPath | undefined, selectedBracketIndex: 0, piPercent: null };
  return getActiveBrackets(value).map((b, i) => `${b.label} (${b.min}–${b.max}%): ${b.criteria.substring(0, 60)}…`);
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractGastro(
  utterance: NormalizedUtterance,
  systemState: V2SystemState
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const src  = utterance.raw;
  const ef   = systemState.extractedFacts;
  const patch: V2SystemFacts = {};
  const pending: PendingObservation[] = [];
  const signals: Partial<import("../contracts.js").SlotSignals> = {};
  const display: Record<string, string> = {};

  // ── Subsystem detection ───────────────────────────────────────────────────
  let detectedSubsystem: GastroSubSystem | undefined;
  if      (SUBSYS_UPPER_RE.test(text))         detectedSubsystem = "upperDigestive";
  else if (SUBSYS_HERNIA_RE.test(text))        detectedSubsystem = "herniation";
  else if (SUBSYS_LIVER_BILIARY_RE.test(text)) detectedSubsystem = "liverBiliary";
  else if (SUBSYS_COLONIC_RE.test(text))       detectedSubsystem = "colonicRectalAnal";

  if (detectedSubsystem) {
    patch[GASTRO_FK_SUBSYSTEM] = makeFact(detectedSubsystem, src);
    signals.subSystem = true;
    display["subsystem"] = detectedSubsystem;
  }

  const currentSubsystem = (patch[GASTRO_FK_SUBSYSTEM] ?? ef[GASTRO_FK_SUBSYSTEM])?.value as GastroSubSystem | undefined;

  // If subsystem still unknown, ask for it
  if (!currentSubsystem) {
    pending.push({
      id: randomUUID(),
      system: "gastro_digestive",
      type: "other",
      sourceText: src,
      parsed: { subtype: "gastro_subsystem" },
      missingFields: ["subSystem"],
      clarificationQuestion: "Which gastro-digestive subsystem applies?",
      candidateAnswers: ["Upper GI (oesophagus/stomach/duodenum/pancreas)", "Colon/rectum/anus", "Liver/biliary", "Hernia"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: display, warnings: [] };
  }

  // ── Sub-path for colonicRectalAnal ────────────────────────────────────────
  if (currentSubsystem === "colonicRectalAnal") {
    const existingSubPath = ef[GASTRO_FK_COLONAL_SUBPATH]?.value as ColonalSubPath | undefined;
    if (!existingSubPath) {
      const subPath: ColonalSubPath = COLONAL_ANAL_RE.test(text) ? "anal" : "colonicRectal";
      if (COLONAL_ANAL_RE.test(text) || /\b(colon|rectal|rectum|large\s+intestine|colitis|crohn)\b/i.test(text)) {
        patch[GASTRO_FK_COLONAL_SUBPATH] = makeFact(subPath, src);
        display["colonal_subpath"] = subPath;
      } else {
        // Need to ask
        pending.push({
          id: randomUUID(),
          system: "gastro_digestive",
          type: "other",
          sourceText: src,
          parsed: { subtype: "gastro_colonal_subpath" },
          missingFields: ["colonalSubPath"],
          clarificationQuestion: "Is this a colonic/rectal disorder or anal disease?",
          candidateAnswers: ["Colonic & Rectal Disease", "Anal Disease"],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    }
  }

  // ── Sub-path for liverBiliary ─────────────────────────────────────────────
  if (currentSubsystem === "liverBiliary") {
    const existingSubPath = ef[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value as LiverBiliarySubPath | undefined;
    if (!existingSubPath) {
      const subPath: LiverBiliarySubPath = LIVER_BILIARY_SUBPATH_RE.test(text) ? "biliary" : "liver";
      if (LIVER_BILIARY_SUBPATH_RE.test(text) || /\b(liver|hepatic|cirrhosis|ascites|hepatitis)\b/i.test(text)) {
        patch[GASTRO_FK_LIVER_BILIARY_SUBPATH] = makeFact(subPath, src);
        display["liver_biliary_subpath"] = subPath;
      } else {
        pending.push({
          id: randomUUID(),
          system: "gastro_digestive",
          type: "other",
          sourceText: src,
          parsed: { subtype: "gastro_liver_biliary_subpath" },
          missingFields: ["liverBiliarySubPath"],
          clarificationQuestion: "Is this liver disease or biliary tract disease?",
          candidateAnswers: ["Liver Disease", "Biliary Tract Disease"],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    }
  }

  // If there are pending sub-path obs, don't proceed further
  if (pending.length > 0) {
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: display, warnings: [] };
  }

  // Determine effective sub-path for bracket lookup
  const colonalSubPath = (patch[GASTRO_FK_COLONAL_SUBPATH] ?? ef[GASTRO_FK_COLONAL_SUBPATH])?.value as ColonalSubPath | undefined;
  const liverSubPath   = (patch[GASTRO_FK_LIVER_BILIARY_SUBPATH] ?? ef[GASTRO_FK_LIVER_BILIARY_SUBPATH])?.value as LiverBiliarySubPath | undefined;

  // ── Severity bracket ──────────────────────────────────────────────────────
  const existingBracket = ef[GASTRO_FK_BRACKET_INDEX]?.value as number | undefined;
  const classFact = extractClass(text);
  if (classFact !== undefined) {
    patch[GASTRO_FK_BRACKET_INDEX] = makeFact(classFact, src);
    signals.selectedBracketIndex = true;
    display["bracket_index"] = String(classFact);
  } else if (existingBracket === undefined) {
    // Ask for bracket
    const chips = buildBracketChips(currentSubsystem, colonalSubPath ?? liverSubPath);
    pending.push({
      id: randomUUID(),
      system: "gastro_digestive",
      type: "other",
      sourceText: src,
      parsed: { subtype: "gastro_bracket", subsystem: currentSubsystem, colonalSubPath, liverSubPath },
      missingFields: ["selectedBracketIndex"],
      clarificationQuestion: "Which severity class applies to this case?",
      candidateAnswers: chips.length > 0 ? chips : ["Class I", "Class II", "Class III", "Class IV"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  if (pending.length > 0) {
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: display, warnings: [] };
  }

  // ── Weight loss (upper digestive only) ────────────────────────────────────
  if (currentSubsystem === "upperDigestive") {
    const wlMatch = WEIGHT_LOSS_RE.exec(text);
    if (wlMatch) {
      patch[GASTRO_FK_WEIGHT_LOSS] = makeFact(parseFloat(wlMatch[1]), src);
      display["weight_loss_percent"] = `${wlMatch[1]}%`;
    }
  }

  // ── PI% ───────────────────────────────────────────────────────────────────
  const existingPi = ef[GASTRO_FK_PI_PERCENT]?.value as number | undefined;
  const piValue = extractPiPercent(text);
  if (piValue !== undefined) {
    patch[GASTRO_FK_PI_PERCENT] = makeFact(piValue, src);
    signals.piPercent = true;
    display["pi_percent"] = `${piValue}%`;
  } else if (existingPi === undefined) {
    // Determine bracket range to inform the question
    const bracketIndex = (patch[GASTRO_FK_BRACKET_INDEX] ?? ef[GASTRO_FK_BRACKET_INDEX])?.value as number | undefined;
    let rangeHint = "";
    if (bracketIndex !== undefined) {
      const brackets = getActiveBrackets({
        subSystem: currentSubsystem,
        colonalSubPath,
        liverBiliarySubPath: liverSubPath,
        selectedBracketIndex: bracketIndex,
        piPercent: null,
      });
      const b = brackets[bracketIndex];
      if (b) rangeHint = ` (${b.min}–${b.max}%)`;
    }
    pending.push({
      id: randomUUID(),
      system: "gastro_digestive",
      type: "other",
      sourceText: src,
      parsed: { subtype: "gastro_pi_percent" },
      missingFields: ["piPercent"],
      clarificationQuestion: `What PI% should be assigned within the selected severity class${rangeHint}?`,
      candidateAnswers: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  if (existingPi !== undefined || piValue !== undefined) {
    signals.piPercent = true;
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
