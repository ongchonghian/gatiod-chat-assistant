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
  SNELLEN_ACUITY,
  VISUAL_FIELD_LOSS,
  FUNCTIONAL_MODIFIERS,
  SPECIFIC_CONDITIONS,
  DIPLOPIA_OPTIONS,
} from "../../engine/visualAssessmentData.js";

// ── Fact key constants (shared with readiness and argBuilder) ─────────────────

export const VISUAL_FK_LEFT_ACUITY       = "visual_left_acuity_id";
export const VISUAL_FK_RIGHT_ACUITY      = "visual_right_acuity_id";
export const VISUAL_FK_LEFT_FIELD        = "visual_left_field_id";
export const VISUAL_FK_RIGHT_FIELD       = "visual_right_field_id";
export const VISUAL_FK_LEFT_MODIFIERS    = "visual_left_modifiers";
export const VISUAL_FK_RIGHT_MODIFIERS   = "visual_right_modifiers";
export const VISUAL_FK_LEFT_CONDITIONS   = "visual_left_conditions";
export const VISUAL_FK_RIGHT_CONDITIONS  = "visual_right_conditions";
export const VISUAL_FK_DIPLOPIA          = "visual_diplopia_id";
export const VISUAL_FK_LEFT_ENUCLEATED   = "visual_left_enucleated";
export const VISUAL_FK_RIGHT_ENUCLEATED  = "visual_right_enucleated";

// ── Chip arrays (exported for resolver) ───────────────────────────────────────

export const ACUITY_CHIPS   = SNELLEN_ACUITY.map((s) => `${s.label} (${s.percent}%)`);
export const FIELD_CHIPS    = VISUAL_FIELD_LOSS.map((f) => `${f.label} (${f.percent}%)`);
export const DIPLOPIA_CHIPS = DIPLOPIA_OPTIONS.map((d) => `${d.label} (${d.percent}%)`);

// ── ID lookups from chip text (exported for resolver reverse-mapping) ─────────

export function acuityIdFromChip(chip: string): string | undefined {
  const norm = chip.toLowerCase().trim();
  for (const s of SNELLEN_ACUITY) {
    if (norm.startsWith(s.label.toLowerCase()) || norm === s.id) return s.id;
  }
  if (/nlp|no\s+light|hand\s+move|counting\s+fing|lt_6_60|<\s*6\/60/.test(norm)) return "lt_6_60";
  return undefined;
}

export function fieldIdFromChip(chip: string): string | undefined {
  const norm = chip.toLowerCase().trim();
  for (const f of VISUAL_FIELD_LOSS) {
    if (norm.startsWith(f.label.toLowerCase().slice(0, 12)) || norm === f.id) return f.id;
  }
  return undefined;
}

export function diplopiaIdFromChip(chip: string): string | undefined {
  const norm = chip.toLowerCase().trim();
  for (const d of DIPLOPIA_OPTIONS) {
    if (norm.startsWith(d.label.toLowerCase()) || norm === d.id) return d.id;
  }
  return undefined;
}

// ── Parsing helpers ────────────────────────────────────────────────────────────

function parseSnellenId(text: string): string | null {
  if (/\b(nlp\b|no\s+light\s+perception|hand\s+movements?\b|counting\s+fingers?\b|cf\b|hm\b)\b/i.test(text)) return "lt_6_60";
  if (/[<＜]\s*6\s*[/]\s*60\b/.test(text)) return "lt_6_60";
  // Match denominators longest first to avoid "6" matching "6_60"
  const m = /\b6\s*[/]\s*(7\.5|12|15|18|24|30|36|48|60|9|6)\b/.exec(text);
  if (m) {
    const id = `6_${m[1]}`;
    return SNELLEN_ACUITY.find((s) => s.id === id) ? id : null;
  }
  return null;
}

function parseFieldId(text: string): string | null {
  if (/\b(full\s+field|normal\s+visual\s+field|≥\s*120|>=?\s*120)\b/i.test(text)) return "field_full";
  if (/([<＜]\s*20\s*(?:°|deg)|less\s+than\s+20\s*(?:°|deg)?)/i.test(text)) return "field_lt20";

  const degMatch = /\b(\d+(?:\.\d+)?)\s*(?:°|deg(?:rees?)?)\b/i.exec(text);
  if (!degMatch) return null;
  const deg = parseFloat(degMatch[1]);

  if (deg >= 120) return "field_full";
  if (deg >= 110) return "field_110_120";
  if (deg >= 100) return "field_100_110";
  if (deg >= 90)  return "field_90_100";
  if (deg >= 80)  return "field_80_90";
  if (deg >= 70)  return "field_70_80";
  if (deg >= 60)  return "field_60_70";
  if (deg >= 50)  return "field_50_60";
  if (deg >= 40)  return "field_40_50";
  if (deg >= 30)  return "field_30_40";
  if (deg >= 20)  return "field_20_30";
  return "field_lt20";
}

// Returns a diplopiaId, "ambiguous" (diplopia present but no zone), or null (no diplopia mention)
function parseDiplopiaId(text: string): string | "ambiguous" | null {
  if (/\b(no\s+diplopia|no\s+double\s+vision|diplopia\s+none|diplopia[:]\s*none)\b/i.test(text)) return "dip_none";
  if (/\b(uncorrectable\s+diplopia|diplopia\s+(?:not\s+correctable|uncorrectable)|prism.?resistant)\b/i.test(text)) return "dip_uncorrectable";
  if (/\b(central\s+30(?:\s*°)?|within\s+(?:central\s+)?30\s*°|dip(?:lopia)?\s+central)\b/i.test(text)) return "dip_central30";
  if (/\b(30\s*[-–to]+\s*60\s*°?)\b/i.test(text)) return "dip_30_60";
  if (/\b(beyond\s+60\s*°?|greater\s+than\s+60\s*°?|>\s*60\s*°?)\b/i.test(text)) return "dip_beyond60";
  // Diplopia present but no zone — must not silently infer
  if (/\b(diplopia|double\s+vision)\b/i.test(text)) return "ambiguous";
  return null;
}

// ── Eye-side and visual context patterns ──────────────────────────────────────

const RIGHT_EYE_RE  = /\b(?:right\s+eye|right-eye|re\b|od\b)\b/i;
const LEFT_EYE_RE   = /\b(?:left\s+eye|left-eye|le\b|os\b)\b/i;
const BOTH_EYES_RE  = /\b(?:both\s+eyes?|bilateral(?:\s+eyes?)?|ou\b|each\s+eye)\b/i;
const VISUAL_CTX_RE = /\b(?:vision|visual|acuity|snellen|ophthal|ocular|eyes?\b|od\b|os\b|visual\s+field|field\s+of\s+vision)\b/i;

const SNELLEN_PRESENT_RE = /\b6\s*[/]\s*(?:7\.5|12|15|18|24|30|36|48|60|9|6)\b|\b(?:nlp\b|hand\s+movements?|counting\s+fingers?)/i;
const FIELD_PRESENT_RE   = /\b\d+(?:\.\d+)?\s*(?:°|deg(?:rees?)?)|\bfull\s+field\b|[<＜]\s*20\s*(?:°|deg)/i;

// ── Enucleation patterns ───────────────────────────────────────────────────────

const LEFT_ENUCLEATION_RE  = /\b(?:left\s+eye\s+(?:enucleated|removed|absent|prosthetic?|artificial|excised)|enucleation\s+(?:of\s+)?left|left\s+(?:prosthetic?|artificial)\s+eye|left\s+enucleation)\b/i;
const RIGHT_ENUCLEATION_RE = /\b(?:right\s+eye\s+(?:enucleated|removed|absent|prosthetic?|artificial|excised)|enucleation\s+(?:of\s+)?right|right\s+(?:prosthetic?|artificial)\s+eye|right\s+enucleation)\b/i;

// ── Functional modifier patterns ──────────────────────────────────────────────

const MODIFIER_PATTERNS: Array<{ re: RegExp; id: string }> = [
  { re: /\b(loss\s+of\s+accommodation|pseudophakia|aphakia(?:\s+requiring)?|accommodation\s+(?:loss|impairment))\b/i,                          id: "accommodation"  },
  { re: /\b(contrast\s+(?:sensitivity\s+)?(?:loss|deficit)|glare\s+(?:sensitivity|disability|acuity)|loss\s+of\s+(?:contrast|glare\s+acuity))\b/i, id: "contrast_glare" },
  { re: /\b(colour\s+(?:differentiation\s+)?(?:loss|deficiency|impairment)|color\s+(?:differentiation\s+)?(?:loss|deficiency)|loss\s+of\s+colour\s+(?:vision|differentiation))\b/i, id: "colour" },
  { re: /\b(high\s+astigmatism|significant\s+astigmatism|aniseikonia|cylinder\s*>3\.5|astigmatism\s*>3\.5[Dd]?)\b/i,                          id: "astigmatism"    },
];

// ── Specific condition patterns ───────────────────────────────────────────────

const CONDITION_PATTERNS: Array<{ re: RegExp; id: string }> = [
  { re: /\bglaucomat?(?:ous)?\b/i,                                                                                  id: "glaucoma"  },
  { re: /\b(?:cataract|lens\s+subluxation|subluxation\s+of\s+(?:the\s+)?lens)\b/i,                                 id: "cataract"  },
  { re: /\b(?:corneal\s+(?:opacity|opacit|scar|decompensation)|corneal\s+damage|corneal\s+scarring)\b/i,           id: "corneal"   },
  { re: /\b(?:orbital\s+(?:deformit|enophthalmos|hypoglobus|hyperglobus)|enophthalmos|hypoglobus|hyperglobus)\b/i, id: "orbital"   },
  { re: /\b(?:traumatic\s+mydriasis|mydriasis|iris\s+abnormali|pupillary\s+abnormali)\b/i,                        id: "mydriasis" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(value: T, text: string): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: text, confidence: 0.9, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

function makePending(
  subtype: string,
  src: string,
  missingField: string,
  question: string,
  chips: string[],
  extra: Record<string, unknown> = {},
): PendingObservation {
  return {
    id: randomUUID(),
    system: "visual",
    type: "visual_value",
    sourceText: src,
    parsed: { subtype, ...extra },
    missingFields: [missingField],
    clarificationQuestion: question,
    candidateAnswers: chips,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function mergeStringArray(existing: string[] | undefined, newItems: string[]): string[] {
  return [...new Set([...(existing ?? []), ...newItems])];
}

// ── Main extractor ─────────────────────────────────────────────────────────────

export function extractVisual(
  utterance: NormalizedUtterance,
  systemState: V2SystemState,
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const src  = utterance.raw;
  const ef   = systemState.extractedFacts;
  const patch: V2SystemFacts = {};
  const pending: PendingObservation[] = [];
  const signals: Partial<import("../contracts.js").SlotSignals> = {};

  // Quick exit: no visual context and no diplopia mention
  if (!VISUAL_CTX_RE.test(text) && !/\b(diplopia|double\s+vision)\b/i.test(text)) {
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: {}, warnings: [] };
  }

  // ── Enucleation ────────────────────────────────────────────────────────────
  if (LEFT_ENUCLEATION_RE.test(text) && !ef[VISUAL_FK_LEFT_ENUCLEATED]) {
    patch[VISUAL_FK_LEFT_ENUCLEATED] = makeFact(true, src);
    patch[VISUAL_FK_LEFT_ACUITY]     = makeFact("lt_6_60", src);
    patch[VISUAL_FK_LEFT_FIELD]      = makeFact("field_lt20", src);
    signals.leftEye = true;
  }
  if (RIGHT_ENUCLEATION_RE.test(text) && !ef[VISUAL_FK_RIGHT_ENUCLEATED]) {
    patch[VISUAL_FK_RIGHT_ENUCLEATED] = makeFact(true, src);
    patch[VISUAL_FK_RIGHT_ACUITY]     = makeFact("lt_6_60", src);
    patch[VISUAL_FK_RIGHT_FIELD]      = makeFact("field_lt20", src);
    signals.rightEye = true;
  }

  // ── Segment-based per-eye parsing ─────────────────────────────────────────
  // Split text at clause boundaries and assign each clause to a side
  const clauses = text.split(/[,;]|\s+(?:and|with)\s+/i);
  const rightClauses: string[] = [];
  const leftClauses:  string[] = [];
  const bothClauses:  string[] = [];

  for (const cl of clauses) {
    if (BOTH_EYES_RE.test(cl)) { bothClauses.push(cl); }
    else if (RIGHT_EYE_RE.test(cl)) { rightClauses.push(cl); }
    else if (LEFT_EYE_RE.test(cl)) { leftClauses.push(cl); }
    // Clauses with no side context are not assigned to avoid silently applying
    // to both eyes. They are only used for diplopia / global context checks.
  }

  const rightText = rightClauses.join(" ");
  const leftText  = leftClauses.join(" ");
  const bothText  = bothClauses.join(" ");

  // ── Snellen acuity ─────────────────────────────────────────────────────────

  // Right eye acuity
  if (SNELLEN_PRESENT_RE.test(rightText) && !ef[VISUAL_FK_RIGHT_ACUITY] && !patch[VISUAL_FK_RIGHT_ACUITY]) {
    const id = parseSnellenId(rightText);
    if (id) { patch[VISUAL_FK_RIGHT_ACUITY] = makeFact(id, src); signals.rightEye = true; signals.acuity = true; }
  }
  // Left eye acuity
  if (SNELLEN_PRESENT_RE.test(leftText) && !ef[VISUAL_FK_LEFT_ACUITY] && !patch[VISUAL_FK_LEFT_ACUITY]) {
    const id = parseSnellenId(leftText);
    if (id) { patch[VISUAL_FK_LEFT_ACUITY] = makeFact(id, src); signals.leftEye = true; signals.acuity = true; }
  }
  // Both-eyes acuity
  if (SNELLEN_PRESENT_RE.test(bothText)) {
    const id = parseSnellenId(bothText);
    if (id) {
      if (!ef[VISUAL_FK_RIGHT_ACUITY] && !patch[VISUAL_FK_RIGHT_ACUITY]) { patch[VISUAL_FK_RIGHT_ACUITY] = makeFact(id, src); signals.rightEye = true; }
      if (!ef[VISUAL_FK_LEFT_ACUITY]  && !patch[VISUAL_FK_LEFT_ACUITY])  { patch[VISUAL_FK_LEFT_ACUITY]  = makeFact(id, src); signals.leftEye  = true; }
      signals.acuity = true;
    }
  }
  // Snellen present in full text but no side context assigned → ask which eye
  if (
    SNELLEN_PRESENT_RE.test(text) &&
    !rightText && !leftText && !bothText &&
    !ef[VISUAL_FK_RIGHT_ACUITY] && !ef[VISUAL_FK_LEFT_ACUITY]
  ) {
    const id = parseSnellenId(text);
    if (id) {
      pending.push(makePending(
        "visual_acuity_eye_pick", src, VISUAL_FK_RIGHT_ACUITY,
        `Which eye has visual acuity ${id.replace("_", "/")}?`,
        ["Right eye", "Left eye", "Both eyes"],
        { acuityId: id },
      ));
    }
  }

  // ── Visual field ───────────────────────────────────────────────────────────

  if (FIELD_PRESENT_RE.test(rightText) && !ef[VISUAL_FK_RIGHT_FIELD] && !patch[VISUAL_FK_RIGHT_FIELD]) {
    const id = parseFieldId(rightText);
    if (id) { patch[VISUAL_FK_RIGHT_FIELD] = makeFact(id, src); signals.rightEye = true; signals.field = true; }
  }
  if (FIELD_PRESENT_RE.test(leftText) && !ef[VISUAL_FK_LEFT_FIELD] && !patch[VISUAL_FK_LEFT_FIELD]) {
    const id = parseFieldId(leftText);
    if (id) { patch[VISUAL_FK_LEFT_FIELD] = makeFact(id, src); signals.leftEye = true; signals.field = true; }
  }
  if (FIELD_PRESENT_RE.test(bothText)) {
    const id = parseFieldId(bothText);
    if (id) {
      if (!ef[VISUAL_FK_RIGHT_FIELD] && !patch[VISUAL_FK_RIGHT_FIELD]) { patch[VISUAL_FK_RIGHT_FIELD] = makeFact(id, src); signals.rightEye = true; }
      if (!ef[VISUAL_FK_LEFT_FIELD]  && !patch[VISUAL_FK_LEFT_FIELD])  { patch[VISUAL_FK_LEFT_FIELD]  = makeFact(id, src); signals.leftEye  = true; }
      signals.field = true;
    }
  }

  // ── Functional modifiers ───────────────────────────────────────────────────

  for (const { re, id } of MODIFIER_PATTERNS) {
    if (!re.test(text)) continue;
    const rightCtx = RIGHT_EYE_RE.test(text);
    const leftCtx  = LEFT_EYE_RE.test(text);
    const bothCtx  = BOTH_EYES_RE.test(text);
    if (!rightCtx && !leftCtx && !bothCtx) {
      // Eye laterality is a required clinical field — no silent bilateral default.
      // Ask the doctor which eye before applying the modifier.
      if (!pending.some((p) => (p.parsed as Record<string, unknown>)?.modifierId === id)) {
        pending.push(makePending(
          "visual_modifier_eye_pick", src, VISUAL_FK_LEFT_MODIFIERS,
          "Which eye has the finding?",
          ["Right eye", "Left eye", "Both eyes"],
          { modifierId: id },
        ));
      }
      continue;
    }
    const applyRight = rightCtx || bothCtx;
    const applyLeft  = leftCtx  || bothCtx;

    if (applyRight) {
      const existArr = (patch[VISUAL_FK_RIGHT_MODIFIERS]?.value ?? ef[VISUAL_FK_RIGHT_MODIFIERS]?.value) as string[] | undefined;
      if (!existArr?.includes(id)) {
        patch[VISUAL_FK_RIGHT_MODIFIERS] = makeFact(mergeStringArray(existArr, [id]), src);
        signals.modifiers = true;
      }
    }
    if (applyLeft) {
      const existArr = (patch[VISUAL_FK_LEFT_MODIFIERS]?.value ?? ef[VISUAL_FK_LEFT_MODIFIERS]?.value) as string[] | undefined;
      if (!existArr?.includes(id)) {
        patch[VISUAL_FK_LEFT_MODIFIERS] = makeFact(mergeStringArray(existArr, [id]), src);
        signals.modifiers = true;
      }
    }
  }

  // ── Specific conditions ────────────────────────────────────────────────────

  for (const { re, id } of CONDITION_PATTERNS) {
    if (!re.test(text)) continue;
    const rightCtx = RIGHT_EYE_RE.test(text);
    const leftCtx  = LEFT_EYE_RE.test(text);
    const bothCtx  = BOTH_EYES_RE.test(text);
    if (!rightCtx && !leftCtx && !bothCtx) {
      // Eye laterality is a required clinical field — no silent bilateral default.
      if (!pending.some((p) => (p.parsed as Record<string, unknown>)?.conditionId === id)) {
        pending.push(makePending(
          "visual_condition_eye_pick", src, VISUAL_FK_LEFT_CONDITIONS,
          "Which eye has the condition?",
          ["Right eye", "Left eye", "Both eyes"],
          { conditionId: id },
        ));
      }
      continue;
    }
    const applyRight = rightCtx || bothCtx;
    const applyLeft  = leftCtx  || bothCtx;

    if (applyRight) {
      const existArr = (patch[VISUAL_FK_RIGHT_CONDITIONS]?.value ?? ef[VISUAL_FK_RIGHT_CONDITIONS]?.value) as string[] | undefined;
      if (!existArr?.includes(id)) patch[VISUAL_FK_RIGHT_CONDITIONS] = makeFact(mergeStringArray(existArr, [id]), src);
    }
    if (applyLeft) {
      const existArr = (patch[VISUAL_FK_LEFT_CONDITIONS]?.value ?? ef[VISUAL_FK_LEFT_CONDITIONS]?.value) as string[] | undefined;
      if (!existArr?.includes(id)) patch[VISUAL_FK_LEFT_CONDITIONS] = makeFact(mergeStringArray(existArr, [id]), src);
    }
  }

  // ── Diplopia (CRITICAL: monocular/binocular without zone → PendingObservation) ─

  if (!ef[VISUAL_FK_DIPLOPIA] && !patch[VISUAL_FK_DIPLOPIA]) {
    const dipId = parseDiplopiaId(text);
    if (dipId === "ambiguous") {
      // Diplopia present but zone not stated — must NOT silently assign a zone
      pending.push(makePending(
        "visual_diplopia_zone", src, VISUAL_FK_DIPLOPIA,
        "Diplopia is present. Which zone applies? (Diplopia is assessed binocularly.)",
        DIPLOPIA_CHIPS,
      ));
    } else if (dipId) {
      patch[VISUAL_FK_DIPLOPIA] = makeFact(dipId, src);
      signals.diplopiaId = true;
    }
  } else if (ef[VISUAL_FK_DIPLOPIA]) {
    signals.diplopiaId = true;
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
