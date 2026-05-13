import { randomUUID } from "crypto";
import { DBE_CONDITIONS as LOWER_DBE_CONDITIONS } from "../../engine/lowerLimbData.js";
import type {
  ExtractedFact,
  GatiodSystemKey,
  NormalizedUtterance,
  OntologyMatch,
  PendingObservation,
  SlotSignals,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";

// ── Fact key constants (shared with argBuilder) ──────────────────────────────

export const LL_FK_SIDE              = "side";
export const LL_FK_ROM_JOINTS        = "rom_joints";
export const LL_FK_ROM_FROM_NERVE    = "rom_from_nerve";
export const LL_FK_NERVE_SELECTIONS  = "nerve_selections";
export const LL_FK_LEG_AMPUTATION    = "leg_amputation";
export const LL_FK_TOE_AMPUTATIONS   = "toe_amputations";
export const LL_FK_SHORTENING_CM     = "shortening_cm";
export const LL_FK_DBE_SELECTIONS    = "dbe_selections";

// ── Internal types ────────────────────────────────────────────────────────────

export interface LlRomJointEntry { isAnkylosed: boolean; measurements: Record<string, number> }
export interface LlNerveSelectionEntry {
  nerveKey: string;
  deficitType: "sensory" | "motor" | "combined";
  lossType: "total" | "partial";
}
export interface LlDbeSelectionEntry {
  conditionId: string;
  selectedPercent: number;
  selectedAnatomicalKey?: string;
}
export type ToeKey = "great" | "second" | "third" | "fourth" | "fifth";
export type LlToeAmputations = Record<ToeKey, string>;

// ── Pattern tables ────────────────────────────────────────────────────────────

const DIRECTION_MAP: Record<string, string> = {
  flexion: "flexion",
  extension: "extension",
  abduction: "abduction",
  adduction: "adduction",
  "internal rotation": "internal_rotation",
  "external rotation": "external_rotation",
  // Slice-19 — workbook uses "malrotation" as an umbrella term for
  // internal/external rotation ankylosis; e.g. "Right knee ankylosed in
  // internal or external malrotation: 10°". Map both to the corresponding
  // rotation direction.
  "internal malrotation": "internal_rotation",
  "external malrotation": "external_rotation",
  malrotation: "internal_rotation",
  // Slice-30 — knee varus/valgus deformity. Engine treats these as
  // angular deformities; map to flexion as a fallback so ROM tables
  // can match. (Knee engine doesn't have a separate varus/valgus
  // direction yet — open follow-up if engine table grows.)
  varus: "flexion",
  valgus: "flexion",
  "flexion contracture": "flexion_contracture",
  dorsiflexion: "dorsiflexion",
  plantarflexion: "plantarflexion",
  inversion: "inversion",
  eversion: "eversion",
};

const DIRECTION_RE = new RegExp(
  `\\b(${Object.keys(DIRECTION_MAP).join("|")})\\s+(\\d+)(?:\\s*[°º]|\\s+degrees?)`,
  "gi"
);

// Slice-18 — workbook ROM phrasings put text between the direction word
// and the angle, e.g. "active forward flexion from neutral / arc: 40°" or
// "ankylosed in flexion: 25° }position of function". Mirror of the upper-
// limb loose fallback. Used only when the strict pattern produces no
// matches.
const DIRECTION_LOOSE_RE = new RegExp(
  `\\b(${Object.keys(DIRECTION_MAP).join("|")})\\b[^°º\\d]{0,80}?(\\d+)\\s*[°º]`,
  "gi"
);

const BARE_ANGLE_RE = /\b(\d+)(?:\s*[°º]|\s+degrees?)/g;
const ANKYLOSIS_RE = /\b(ankylos(?:ed)?|fixed\s+at|fused)\b/i;

const JOINT_MAP: Record<string, string> = {
  hip: "hip",
  knee: "knee",
  ankle: "ankle",
  subtalar: "subtalar",
  "great toe mtp": "great_toe_mtp",
  "great toe ip": "great_toe_ip",
  "great toe metatarsophalangeal": "great_toe_mtp",
  "great toe interphalangeal": "great_toe_ip",
  "great toe": "great_toe_mtp",
  "big toe": "great_toe_mtp",
  hallux: "great_toe_mtp",
  "lesser toes": "lesser_toes_mtp",
  "lesser toes mtp": "lesser_toes_mtp",
  "2nd toe": "lesser_toes_mtp",
  "second toe": "lesser_toes_mtp",
};

// Slice-28 — long-form anatomical names for great toe joints. Workbook uses
// "great toe interphalangeal joint" / "great toe metatarsophalangeal joint"
// in addition to the short forms.
const JOINT_RE = /\b(hip|knee|ankle|subtalar|great\s+toe\s+(?:metatarsophalangeal|interphalangeal)|great\s+toe(?:\s+(?:mtp|ip))?|big\s+toe|hallux|lesser\s+toes?(?:\s+mtp)?|2nd\s+toe|second\s+toe)\b/gi;

const NERVE_MAP: Record<string, string> = {
  "lumbosacral plexus": "lumbosacral_l3_s1",
  "lumbosacral": "lumbosacral_l3_s1",
  femoral: "femoral",
  obturator: "obturator",
  "superior gluteal": "superior_gluteal",
  "inferior gluteal": "inferior_gluteal",
  "lateral femoral cutaneous": "lateral_femoral_cutaneous",
  sciatic: "sciatic",
  "common peroneal": "common_peroneal",
  "superficial peroneal": "superficial_peroneal",
  "deep peroneal": "deep_peroneal",
  tibial: "tibial",
  sural: "sural",
  "medial plantar": "medial_plantar",
  "lateral plantar": "lateral_plantar",
};

// Slice-25 — `tibial plateau` is a knee bone, not the tibial nerve.
// `femoral neck/head/condyle` is a femur location, not the femoral nerve.
// Negative lookahead excludes these so DBE auto-population can run.
const NERVE_RE = /\b(lumbosacral(?:\s+plexus)?|femoral(?!\s+(?:neck|head|condyle|shaft))|obturator|superior\s+gluteal|inferior\s+gluteal|lateral\s+femoral\s+cutaneous|sciatic|common\s+peroneal|superficial\s+peroneal|deep\s+peroneal|tibial(?!\s+(?:plateau|shaft|condyle))|sural|medial\s+plantar|lateral\s+plantar)\b/i;

const DEFICIT_RE = /\b(sensory|motor|combined)\b/i;
const LOSS_RE = /\b(total|partial)\b/i;
const SIDE_RE = /\b(left|right)\b/i;
const SIDE_BILATERAL_RE = /\b(bilateral|both\s+(?:sides?|legs?|limbs?|lower\s+limbs?)|left\s+and\s+right|right\s+and\s+left)\b/i;
const ROM_FROM_NERVE_YES = /\b(due\s+to\s+nerve|from\s+nerve|because\s+of\s+nerve|rom\s+from\s+nerve)\b/i;
const ROM_FROM_NERVE_NO = /\b(independent|not\s+(?:from|related\s+to)\s+nerve|separate\s+rom)\b/i;
const NO_OTHER_FINDINGS_RE = /\bno\s+other\s+findings?\b/i;
const NEGATE_NERVE_RE = /\b(no|without|absent|negative)\s+(?:nerve|neurological|neuropathy|palsy)\b/i;
const NEGATE_AMP_RE = /\b(no|without)\s+(?:amputation|amp\b)/i;
const NEGATE_DBE_RE = /\b(no|without|negative)\s+(?:dbe|diagnosis.?based|fracture|instability|oa|osteoarthritis)\b/i;
const SHORTENING_KEYWORD_RE = /\bshorten(?:ing)?\b|\blimb\s+length\s+discrepancy\b|\bleg\s+length\s+discrepancy\b/i;
const SHORTENING_CM_RE = /\b(\d+(?:\.\d+)?)\s*cm\b/i;
// Slice-30 — workbook "Lower limb length: Left limb length discrepancy: 1.5"
// uses bare numbers without "cm" suffix. Match a number after the keyword.
const SHORTENING_BARE_NUMBER_RE = /\b(?:length\s+)?discrepancy[^:]*:\s*(\d+(?:\.\d+)?)\b/i;

const LEG_AMP_RE = /\b(above[\s-](?:the\s+)?knee|ak\s+amp(?:utation)?|trans[\s-]?femoral|through\s+(?:the\s+)?femur|below[\s-](?:the\s+)?knee|bk\s+amp(?:utation)?|trans[\s-]?tibial|syme['s]*(?:\s+amp(?:utation)?)?|midtarsal|chopart(?:'s)?|transmetatarsal|trans[\s-]?metatarsal)\b/i;
// Generic amputation signal — "loss of leg/limb" or bare "amputated/amputation" without
// a level term. Sets slotSignalsPatch.amputation_present so readiness can ask for the level
// rather than asking "what type of finding?" (which "loss of" already answers).
const GENERIC_AMP_RE = /\b(?:loss\s+of\s+(?:(?:both|the|a)\s+)?(?:legs?|lower\s+limbs?|limbs?|feet|foot)|(?:legs?|lower\s+limbs?)\s+(?:was\s+|were\s+)?amputated|amputat(?:ion|ed))\b/i;

const LEG_AMP_MAP: Record<string, string> = {
  "above knee": "above_knee",
  "above the knee": "above_knee",
  "ak amp": "above_knee",
  "ak amputation": "above_knee",
  "transfemoral": "above_knee",
  "trans femoral": "above_knee",
  "through the femur": "above_knee",
  "through femur": "above_knee",
  "below knee": "below_knee",
  "below the knee": "below_knee",
  "bk amp": "below_knee",
  "bk amputation": "below_knee",
  "transtibial": "below_knee",
  "trans tibial": "below_knee",
  "syme": "syme",
  "symes": "syme",
  "syme amputation": "syme",
  "midtarsal": "midtarsal",
  "chopart": "midtarsal",
  "choparts": "midtarsal",
  "transmetatarsal": "transmetatarsal",
  "trans metatarsal": "transmetatarsal",
};

const TOE_NAME_MAP: Record<string, ToeKey> = {
  "great toe": "great",
  "big toe": "great",
  "hallux": "great",
  "1st toe": "great",
  "first toe": "great",
  "2nd toe": "second",
  "second toe": "second",
  "3rd toe": "third",
  "third toe": "third",
  "4th toe": "fourth",
  "fourth toe": "fourth",
  "5th toe": "fifth",
  "fifth toe": "fifth",
  "little toe": "fifth",
  "pinky toe": "fifth",
};

const TOE_NAME_RE = /\b(great\s+toe|big\s+toe|hallux|1st\s+toe|first\s+toe|2nd\s+toe|second\s+toe|3rd\s+toe|third\s+toe|4th\s+toe|fourth\s+toe|5th\s+toe|fifth\s+toe|little\s+toe|pinky\s+toe)\b/gi;

const GREAT_TOE_AMP_LEVEL_RE = /\b(through\s+ip|ip\s+joint|through\s+mtp|mtp\s+joint|with\s+(?:1st\s+)?metatarsal|metatarsal\s+level)\b/i;
const LESSER_TOE_AMP_LEVEL_RE = /\b(through\s+dip|dip\s+joint|through\s+pip|pip\s+joint|through\s+mtp|mtp\s+joint|with\s+metatarsal|metatarsal\s+level)\b/i;

// Slice-21 — workbook uses lay-language phalanx counts. For each toe + count
// + optional metatarsal, we map to the engine's level codes.
//   Great toe (2 phalanges total):
//     "one phalanx"   → ip (3%)
//     "both phalanges" or "two phalanges" → mtp (14%)
//     "...and 1st metatarsal" → metatarsal (23%)
//   Other toes (3 phalanges total):
//     "one phalanx"   → dip (1%)
//     "two phalanges" → pip (2%)
//     "three phalanges" → mtp (3%)
//     "...and Nth metatarsal" → metatarsal (7%)
const TOE_PHALANX_AMP_RE =
  /\bloss\s+of\s+(?:(?:the\s+)?(left|right)\s+)?(great\s+toe|big\s+toe|hallux|1st\s+toe|first\s+toe|2nd\s+toe|second\s+toe|3rd\s+toe|third\s+toe|4th\s+toe|fourth\s+toe|5th\s+toe|fifth\s+toe|little\s+toe)\s*[-–—]\s*(one|two|three|both)\s+(phalanx|phalanges)(?:\s+and\s+(?:\d+(?:st|nd|rd|th)?\s+)?metatarsal)?/i;
// "Loss of all toes of one foot" / "Loss of left all toes"
const ALL_TOES_AMP_RE = /\bloss\s+of\s+(?:(?:the\s+)?(left|right)\s+)?all\s+toes\b/i;

// Slice-31 — "Loss of left first metatarsal" / "Loss of right 2nd metatarsal".
// Bare-metatarsal amputation (no associated phalanx loss). Maps to the
// engine's per-toe `metatarsal` level for the corresponding toe.
const METATARSAL_AMP_RE =
  /\bloss\s+of\s+(?:(?:the\s+)?(left|right)\s+)?(1st|first|2nd|second|3rd|third|4th|fourth|5th|fifth)\s+metatarsal\b/i;
const METATARSAL_TO_TOE: Record<string, ToeKey> = {
  "1st": "great", first: "great",
  "2nd": "second", second: "second",
  "3rd": "third", third: "third",
  "4th": "fourth", fourth: "fourth",
  "5th": "fifth", fifth: "fifth",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(
  value: T,
  sourceText: string,
  method: ExtractedFact<T>["extractionMethod"] = "regex",
  confidence = 0.9
): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText, confidence, extractionMethod: method, createdAt: now, updatedAt: now };
}

function makeObservation(
  system: GatiodSystemKey,
  type: PendingObservation["type"],
  sourceText: string,
  parsed: Record<string, unknown>,
  missingFields: string[],
  clarificationQuestion: string,
  candidateAnswers: string[]
): PendingObservation {
  const now = nowIso();
  return {
    id: randomUUID(),
    system,
    type,
    sourceText,
    parsed,
    missingFields,
    clarificationQuestion,
    candidateAnswers,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeLegAmpText(raw: string): string {
  const key = raw.toLowerCase().trim()
    .replace(/'s\b/g, "")
    .replace(/\s+(?:amputation|amp)\b/g, "")
    .replace(/trans[\s-]/g, "trans ")
    .replace(/\s+/g, " ")
    .trim();
  return LEG_AMP_MAP[key] ?? key.replace(/\s+/g, "_");
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractLowerLimb(
  utterance: NormalizedUtterance,
  currentSystemState: V2SystemState,
  ontologyMatches: OntologyMatch[] = []
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const raw = utterance.raw;
  const existingFacts = currentSystemState.extractedFacts;

  const factsPatch: V2SystemFacts = {};
  const pendingToAdd: PendingObservation[] = [];
  const pendingToResolve: string[] = [];
  const slotSignalsPatch: Partial<SlotSignals> = {};
  const displayValuesPatch: Record<string, string> = {};
  const warnings: string[] = [];

  // ── Side ───────────────────────────────────────────────────────────────────
  // Also treat as bilateral when both "left" and "right" appear in the text
  // (catches "left lower limb and right lower limb" which isn't adjacent).
  const hasBothSides = /\bleft\b/i.test(text) && /\bright\b/i.test(text);
  if (SIDE_BILATERAL_RE.test(text) || hasBothSides) {
    warnings.push("Bilateral lower limb detected.");
    // Ask whether the same findings apply to both legs or each needs separate assessment.
    // Do NOT ask "which side?" — the doctor already told us both are affected.
    pendingToAdd.push({
      ...makeObservation(
        "lower_limb",
        "bilateral_mode_choice",
        raw,
        { bilateral: true, system: "lower_limb" },
        ["bilateral_mode"],
        "Both lower limbs are affected. Do both legs have the same findings, or would you like to assess each leg separately?",
        ["Same findings for both", "Assess each leg separately"],
      ),
      expectedAnswer: { kind: "enum", factKey: "bilateral_mode", choices: ["same", "separate"] },
    });
  } else {
    const sideMatch = SIDE_RE.exec(text);
    if (sideMatch) {
      const side = sideMatch[1].toLowerCase() as "left" | "right";
      factsPatch[LL_FK_SIDE] = makeFact(side, raw);
      slotSignalsPatch.side = true;
      displayValuesPatch.side = side;
    }
  }

  // ── ROM ────────────────────────────────────────────────────────────────────
  const isAnkylosed = ANKYLOSIS_RE.test(text);

  // Detect joint
  const jointMatches: string[] = [];
  {
    const jointRe = new RegExp(JOINT_RE.source, "gi");
    let jm: RegExpExecArray | null;
    while ((jm = jointRe.exec(text)) !== null) {
      jointMatches.push(jm[0].toLowerCase().trim().replace(/\s+/g, " "));
    }
  }
  // Slice-25 — prefer longest joint match. Same shape as upper_limb fix.
  // Slice-28 — also consider position: when both "ankle" and "subtalar"
  // appear (workbook prefix "Ankle/subtalar:" then "Right ankle ankylosed"),
  // the actual joint being assessed is the one closest to the angle word,
  // not the longest. Strategy: if there's an angle in the text, prefer
  // joint occurrences nearest to the angle; otherwise fall back to longest.
  const angleMatch = /\d+\s*[°º]/.exec(text);
  let longestLowerJoint = "";
  if (angleMatch) {
    const anglePos = angleMatch.index;
    // Find joint occurrences with positions.
    const jointOccurrences: { word: string; pos: number }[] = [];
    const jrSearch = new RegExp(JOINT_RE.source, "gi");
    let jrm: RegExpExecArray | null;
    while ((jrm = jrSearch.exec(text)) !== null) {
      jointOccurrences.push({ word: jrm[0].toLowerCase().trim().replace(/\s+/g, " "), pos: jrm.index });
    }
    // Closest to angle wins; ties broken by longest word.
    jointOccurrences.sort((a, b) => {
      const distA = Math.abs(anglePos - a.pos);
      const distB = Math.abs(anglePos - b.pos);
      if (distA !== distB) return distA - distB;
      return b.word.length - a.word.length;
    });
    longestLowerJoint = jointOccurrences[0]?.word ?? "";
  }
  if (!longestLowerJoint) {
    longestLowerJoint = jointMatches.reduce(
      (best, cur) => (cur.length > best.length ? cur : best),
      jointMatches[0] ?? "",
    );
  }
  const canonicalJoint: string | undefined =
    longestLowerJoint
      ? (JOINT_MAP[longestLowerJoint] ?? longestLowerJoint.replace(/\s+/g, "_"))
      : undefined;

  // Parse direction+angle pairs (strict: direction immediately followed by angle)
  const directionPairs: { direction: string; angle: number }[] = [];
  {
    const dirRe = new RegExp(DIRECTION_RE.source, "gi");
    let dm: RegExpExecArray | null;
    while ((dm = dirRe.exec(text)) !== null) {
      const dirKey = DIRECTION_MAP[dm[1].toLowerCase()] ?? dm[1].toLowerCase();
      directionPairs.push({ direction: dirKey, angle: Number(dm[2]) });
    }
  }
  // Slice-28 — joint-context-aware direction aliasing. Engine uses
  // "dorsiflexion" / "plantarflexion" for ankle (anatomical names);
  // workbook clinical descriptions say "extension" / "flexion" instead.
  // For the ankle joint, normalize these aliases so the angle lands in
  // the engine's actual table.
  const ANKLE_DIRECTION_ALIASES: Record<string, string> = {
    extension: "dorsiflexion",
    flexion: "plantarflexion",
  };
  const aliasDirectionForJoint = (dirKey: string): string => {
    if (canonicalJoint === "ankle" && ANKLE_DIRECTION_ALIASES[dirKey]) {
      return ANKLE_DIRECTION_ALIASES[dirKey];
    }
    return dirKey;
  };

  // Slice-27 — pair direction words and angles by proximity, preferring
  // the LONGEST direction word that appears within ~80 chars before the
  // angle. Workbook phrasings like "extension to / flexion contracture:
  // 90°" contain two candidate direction words; the longer ("flexion
  // contracture") is the intended one. The earlier slice-18 strategy
  // (regex with intervening-text wildcard) matched the first direction
  // greedily and produced a knee.extension measurement that doesn't
  // exist in the engine, returning 0%.
  if (directionPairs.length === 0) {
    // Find all direction word occurrences with their positions.
    const dirOccurrences: { word: string; pos: number }[] = [];
    const dirWords = Object.keys(DIRECTION_MAP);
    for (const word of dirWords) {
      const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        dirOccurrences.push({ word: word.toLowerCase(), pos: m.index });
      }
    }
    // Find all angle occurrences with their positions.
    const angleRe = /(\d+)\s*[°º]/g;
    const angleOccurrences: { angle: number; pos: number }[] = [];
    let am: RegExpExecArray | null;
    while ((am = angleRe.exec(text)) !== null) {
      angleOccurrences.push({ angle: Number(am[1]), pos: am.index });
    }
    // For each angle, pick the longest direction word within 80 chars before it.
    const seenDirections = new Set<string>();
    for (const { angle, pos: angleP } of angleOccurrences) {
      const candidates = dirOccurrences.filter((d) => d.pos < angleP && angleP - d.pos <= 80);
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => b.word.length - a.word.length || a.pos - b.pos);
      const chosen = candidates[0];
      const baseKey = DIRECTION_MAP[chosen.word] ?? chosen.word;
      const dirKey = aliasDirectionForJoint(baseKey);
      if (seenDirections.has(dirKey)) continue;
      seenDirections.add(dirKey);
      directionPairs.push({ direction: dirKey, angle });
    }
  }

  // Bare angles (no direction keyword)
  const bareAngles: number[] = [];
  if (directionPairs.length === 0) {
    const bRe = new RegExp(BARE_ANGLE_RE.source, "g");
    let bm: RegExpExecArray | null;
    while ((bm = bRe.exec(text)) !== null) {
      bareAngles.push(Number(bm[1]));
    }
  }

  if (directionPairs.length > 0 && canonicalJoint) {
    const existingRomJoints = (existingFacts[LL_FK_ROM_JOINTS]?.value ?? {}) as Record<string, LlRomJointEntry>;
    const jointEntry = existingRomJoints[canonicalJoint] ?? { isAnkylosed: false, measurements: {} };
    const updatedMeasurements = { ...jointEntry.measurements };
    for (const { direction, angle } of directionPairs) {
      updatedMeasurements[direction] = angle;
      displayValuesPatch[`rom_${canonicalJoint}_${direction}`] = `${angle}°`;
    }
    const updatedJoints = {
      ...existingRomJoints,
      [canonicalJoint]: { isAnkylosed: isAnkylosed || jointEntry.isAnkylosed, measurements: updatedMeasurements },
    };
    factsPatch[LL_FK_ROM_JOINTS] = makeFact(updatedJoints, raw);
    slotSignalsPatch.rom_joint = true;
    slotSignalsPatch.rom_measurements = true;
    slotSignalsPatch.ankylosis_flag = true;
  } else if (bareAngles.length > 0 && canonicalJoint) {
    const chipsByJoint: Record<string, string[]> = {
      hip: ["Flexion", "Extension", "Abduction", "Adduction", "Internal Rotation", "External Rotation", "Flexion Contracture"],
      knee: ["Flexion", "Flexion Contracture"],
      ankle: ["Dorsiflexion", "Plantarflexion"],
      subtalar: ["Inversion", "Eversion"],
      great_toe_mtp: ["Extension", "Flexion"],
      great_toe_ip: ["Flexion"],
      lesser_toes_mtp: ["Extension", "Flexion"],
    };
    const chips = chipsByJoint[canonicalJoint] ?? ["Flexion", "Extension"];
    pendingToAdd.push(
      makeObservation(
        "lower_limb",
        "rom_measurement",
        raw,
        { joint: canonicalJoint, angle: bareAngles[0], isAnkylosed },
        ["direction"],
        `Which ${canonicalJoint.replace(/_/g, " ")} movement does ${bareAngles[0]}° apply to?`,
        chips
      )
    );
    slotSignalsPatch.rom_joint = true;
  } else if (bareAngles.length > 0 && !canonicalJoint) {
    pendingToAdd.push(
      makeObservation(
        "lower_limb",
        "rom_measurement",
        raw,
        { angle: bareAngles[0], isAnkylosed },
        ["joint", "direction"],
        `${bareAngles[0]}° — which joint and movement does this apply to?`,
        ["Hip", "Knee", "Ankle", "Subtalar"]
      )
    );
  }

  // ── Nerve ─────────────────────────────────────────────────────────────────
  if (NEGATE_NERVE_RE.test(text)) {
    factsPatch[LL_FK_NERVE_SELECTIONS] = makeFact([] as LlNerveSelectionEntry[], raw);
    slotSignalsPatch.nerve_present = false;
    displayValuesPatch.nerve_present = "none";
  } else {
    const nerveMatch = NERVE_RE.exec(text);
    if (nerveMatch) {
      const nerveKey = NERVE_MAP[nerveMatch[0].toLowerCase().trim()] ?? nerveMatch[0].toLowerCase().replace(/\s+/g, "_");
      const deficitMatch = DEFICIT_RE.exec(text);
      const lossMatch = LOSS_RE.exec(text);

      if (deficitMatch && lossMatch) {
        const deficitType = deficitMatch[1].toLowerCase() as "sensory" | "motor" | "combined";
        const lossType = lossMatch[1].toLowerCase() as "total" | "partial";
        const existing = (existingFacts[LL_FK_NERVE_SELECTIONS]?.value ?? []) as LlNerveSelectionEntry[];
        const updated = [...existing.filter((n) => n.nerveKey !== nerveKey), { nerveKey, deficitType, lossType }];
        factsPatch[LL_FK_NERVE_SELECTIONS] = makeFact(updated, raw);
        slotSignalsPatch.nerve_present = true;
        slotSignalsPatch.nerve_details = true;
        displayValuesPatch.nerve_name = nerveKey;
        displayValuesPatch.nerve_deficit = `${deficitType} ${lossType}`;
      } else {
        const missingFields: string[] = [];
        if (!deficitMatch) missingFields.push("deficitType");
        if (!lossMatch) missingFields.push("lossType");
        pendingToAdd.push(
          makeObservation(
            "lower_limb",
            "nerve_deficit",
            raw,
            { nerveKey },
            missingFields,
            `For the ${nerveMatch[0]} nerve: is the deficit sensory, motor, or combined? Total or partial loss?`,
            ["Sensory partial", "Sensory total", "Motor partial", "Motor total", "Combined partial", "Combined total"]
          )
        );
        slotSignalsPatch.nerve_present = true;
      }
    }
  }

  // ── ROM-from-nerve gate ────────────────────────────────────────────────────
  if (ROM_FROM_NERVE_YES.test(text)) {
    factsPatch[LL_FK_ROM_FROM_NERVE] = makeFact(true, raw);
    slotSignalsPatch.rom_from_nerve = true;
    displayValuesPatch.rom_from_nerve = "due to nerve";
  } else if (ROM_FROM_NERVE_NO.test(text)) {
    factsPatch[LL_FK_ROM_FROM_NERVE] = makeFact(false, raw);
    slotSignalsPatch.rom_from_nerve = true;
    displayValuesPatch.rom_from_nerve = "independent";
  }

  // ── Shortening ────────────────────────────────────────────────────────────
  if (SHORTENING_KEYWORD_RE.test(text)) {
    // Try "X cm" first; fall back to bare number after "discrepancy:"
    // (workbook style: "Left limb length discrepancy: 1.5"). Treat the
    // bare number as cm — workbook uses cm consistently.
    const cmMatch = SHORTENING_CM_RE.exec(text);
    const bareMatch = !cmMatch ? SHORTENING_BARE_NUMBER_RE.exec(text) : null;
    const discrepancyCm = cmMatch
      ? parseFloat(cmMatch[1])
      : bareMatch
      ? parseFloat(bareMatch[1])
      : null;
    if (discrepancyCm !== null) {
      factsPatch[LL_FK_SHORTENING_CM] = makeFact(discrepancyCm, raw);
      displayValuesPatch.shortening_cm = `${discrepancyCm}cm`;
    } else {
      pendingToAdd.push(
        makeObservation(
          "lower_limb",
          "other",
          raw,
          { type: "shortening" },
          ["discrepancyCm"],
          "What is the leg length discrepancy in centimetres?",
          ["0.5 cm", "1 cm", "1.5 cm", "2 cm", "2.5 cm", "3 cm"]
        )
      );
    }
  }

  // ── Leg amputation ────────────────────────────────────────────────────────
  if (NEGATE_AMP_RE.test(text)) {
    factsPatch[LL_FK_LEG_AMPUTATION] = makeFact("none", raw);
    slotSignalsPatch.amputation_present = false;
    displayValuesPatch.amputation_present = "none";
  } else {
    const legAmpMatch = LEG_AMP_RE.exec(text);
    if (legAmpMatch) {
      const legLevel = normalizeLegAmpText(legAmpMatch[1]);
      factsPatch[LL_FK_LEG_AMPUTATION] = makeFact(legLevel, raw);
      slotSignalsPatch.amputation_present = true;
      displayValuesPatch.amputation_level = legLevel;
    } else if (GENERIC_AMP_RE.test(text)) {
      // "loss of leg/limb" or bare "amputated/amputation" — level not yet stated.
      // Signal the finding type so readiness asks for the level specifically rather
      // than the generic "what type of finding?" question.
      slotSignalsPatch.amputation_present = true;
    }
  }

  // ── Slice-21 phalanx-count toe amputation ─────────────────────────────────
  // Workbook uses "one phalanx" / "two phalanges" / "both phalanges" with an
  // optional metatarsal suffix. Map to engine level codes before falling
  // back to the medical-shorthand path below.
  let toePhalanxConsumed = false;
  {
    const m = TOE_PHALANX_AMP_RE.exec(text);
    if (m) {
      const toeKey = TOE_NAME_MAP[m[2].toLowerCase().replace(/\s+/g, " ")];
      const phalCount = m[3].toLowerCase();
      const hasMetatarsal = /and\s+(?:\d+(?:st|nd|rd|th)?\s+)?metatarsal/i.test(m[0]);
      let level: string | undefined;
      if (toeKey === "great") {
        if (phalCount === "one") level = "ip";
        else if (phalCount === "two" || phalCount === "both") {
          level = hasMetatarsal ? "metatarsal" : "mtp";
        }
      } else if (toeKey) {
        if (phalCount === "one") level = "dip";
        else if (phalCount === "two") level = "pip";
        else if (phalCount === "three") level = hasMetatarsal ? "metatarsal" : "mtp";
      }
      if (toeKey && level) {
        const existingToes = (existingFacts[LL_FK_TOE_AMPUTATIONS]?.value ?? {}) as LlToeAmputations;
        const updatedToes: LlToeAmputations = { ...existingToes } as LlToeAmputations;
        updatedToes[toeKey] = level;
        factsPatch[LL_FK_TOE_AMPUTATIONS] = makeFact(updatedToes, raw);
        slotSignalsPatch.amputation_present = true;
        displayValuesPatch[`toe_amp_${toeKey}`] = level;
        toePhalanxConsumed = true;
      }
    }
  }

  // ── Slice-31 bare-metatarsal amputation ───────────────────────────────────
  if (!toePhalanxConsumed) {
    const mm = METATARSAL_AMP_RE.exec(text);
    if (mm) {
      const toeKey = METATARSAL_TO_TOE[mm[2].toLowerCase()];
      if (toeKey) {
        const existingToes = (existingFacts[LL_FK_TOE_AMPUTATIONS]?.value ?? {}) as LlToeAmputations;
        const updatedToes: LlToeAmputations = { ...existingToes } as LlToeAmputations;
        updatedToes[toeKey] = "metatarsal";
        factsPatch[LL_FK_TOE_AMPUTATIONS] = makeFact(updatedToes, raw);
        slotSignalsPatch.amputation_present = true;
        displayValuesPatch[`toe_amp_${toeKey}`] = "metatarsal";
        toePhalanxConsumed = true;
      }
    }
  }

  // ── Slice-21 "all toes" pattern ───────────────────────────────────────────
  // "Loss of left all toes of one foot" → all five toes at MTP (whole-toe
  // loss). Engine treats this as the foot-loss equivalent at the toe level;
  // the FOOT_AMPUTATION_CAP handles the upper bound.
  if (!toePhalanxConsumed && ALL_TOES_AMP_RE.test(text)) {
    const allMtp: LlToeAmputations = {
      great: "mtp", second: "mtp", third: "mtp", fourth: "mtp", fifth: "mtp",
    };
    factsPatch[LL_FK_TOE_AMPUTATIONS] = makeFact(allMtp, raw);
    slotSignalsPatch.amputation_present = true;
    displayValuesPatch.toe_amp_all = "all_mtp";
    toePhalanxConsumed = true;
  }

  // ── Toe amputations ───────────────────────────────────────────────────────
  // Slice-28 — only treat toe-name mentions as amputation candidates when
  // the text has an amputation-marker verb. The previous fall-through
  // defaulted "great toe" / "2nd toe" to MTP-level amputation even for
  // ankylosis rows like "Great toe MTP joint: Right great toe ... ankylosed
  // in flexion: 30°" — the toe_amputations fact was added on top of the
  // ankylosis ROM, doubling the engine output (10% expected, 14% observed).
  const HAS_AMP_MARKER = /\b(loss\s+of|amputation|amputated|disarticulation|amputee)\b/i;
  const toeMatches: { toe: ToeKey; rawText: string }[] = [];
  if (!toePhalanxConsumed && HAS_AMP_MARKER.test(text)) {
    const toeRe = new RegExp(TOE_NAME_RE.source, "gi");
    let tm: RegExpExecArray | null;
    while ((tm = toeRe.exec(text)) !== null) {
      const toeKey = TOE_NAME_MAP[tm[0].toLowerCase().trim().replace(/\s+/g, " ")];
      if (toeKey) toeMatches.push({ toe: toeKey, rawText: tm[0] });
    }
  }
  if (toeMatches.length > 0) {
    const existingToes = (existingFacts[LL_FK_TOE_AMPUTATIONS]?.value ?? {}) as LlToeAmputations;
    const updatedToes: LlToeAmputations = { ...existingToes } as LlToeAmputations;
    for (const { toe } of toeMatches) {
      if (toe === "great") {
        const levelMatch = GREAT_TOE_AMP_LEVEL_RE.exec(text);
        if (levelMatch) {
          const raw_level = levelMatch[1].toLowerCase();
          let level = "mtp";
          if (/ip/.test(raw_level)) level = "ip";
          else if (/metatarsal/.test(raw_level)) level = "metatarsal";
          updatedToes[toe] = level;
        } else {
          updatedToes[toe] = "mtp";
        }
      } else {
        const levelMatch = LESSER_TOE_AMP_LEVEL_RE.exec(text);
        if (levelMatch) {
          const raw_level = levelMatch[1].toLowerCase();
          let level = "mtp";
          if (/dip/.test(raw_level)) level = "dip";
          else if (/pip/.test(raw_level)) level = "pip";
          else if (/metatarsal/.test(raw_level)) level = "metatarsal";
          updatedToes[toe] = level;
        } else {
          updatedToes[toe] = "mtp";
        }
      }
      displayValuesPatch[`toe_amp_${toe}`] = updatedToes[toe];
    }
    factsPatch[LL_FK_TOE_AMPUTATIONS] = makeFact(updatedToes, raw);
    slotSignalsPatch.amputation_present = true;
  }

  // ── DBE conditions from ontology matches ──────────────────────────────────
  // Slice-23 — auto-populate FK_DBE_SELECTIONS when the doctor's
  // description has a single dominant high-confidence ontology match.
  const dbeMatches = ontologyMatches.filter((m) => m.type === "dbe" && m.system === "lower_limb");
  if (dbeMatches.length > 0) {
    slotSignalsPatch.dbe_condition = true;
    const top = dbeMatches[0];
    const next = dbeMatches[1];
    // Slice-26 — accept dominance when EITHER (a) gap ≥ 0.1 OR (b) top
    // is high-confidence (≥0.55) absolute even with a smaller gap.
    // Workbook DBE rows often have multiple variants of a fracture
    // (displaced/undisplaced/comminuted) scoring within 0.05-0.1 of
    // each other, but the top match is unambiguous when the description
    // includes the distinguishing token ("sacrum", "5th metatarsal").
    const dominantEnough =
      top.score >= 0.4 &&
      (!next || top.score - next.score >= 0.1 || top.score >= 0.55);
    if (dominantEnough && !factsPatch[LL_FK_DBE_SELECTIONS] && !existingFacts[LL_FK_DBE_SELECTIONS]) {
      const cond = LOWER_DBE_CONDITIONS.find((c) => c.id === top.canonicalId);
      if (cond) {
        const updated: LlDbeSelectionEntry[] = [{ conditionId: cond.id, selectedPercent: cond.minPercent }];
        factsPatch[LL_FK_DBE_SELECTIONS] = makeFact(updated, raw);
        slotSignalsPatch.dbe_present = true;
        displayValuesPatch.dbe_condition = `${cond.label} (${cond.minPercent}%)`;
      }
    }
  }

  // ── DBE negation ──────────────────────────────────────────────────────────
  if (NEGATE_DBE_RE.test(text)) {
    factsPatch[LL_FK_DBE_SELECTIONS] = makeFact([] as LlDbeSelectionEntry[], raw);
    slotSignalsPatch.dbe_present = false;
    displayValuesPatch.dbe_present = "none";
  }

  // ── "No other findings" ───────────────────────────────────────────────────
  if (NO_OTHER_FINDINGS_RE.test(text)) {
    if (!factsPatch[LL_FK_NERVE_SELECTIONS]) {
      factsPatch[LL_FK_NERVE_SELECTIONS] = makeFact([] as LlNerveSelectionEntry[], raw);
    }
    if (!factsPatch[LL_FK_LEG_AMPUTATION]) {
      factsPatch[LL_FK_LEG_AMPUTATION] = makeFact("none", raw);
    }
    if (!factsPatch[LL_FK_TOE_AMPUTATIONS]) {
      const emptyToes: LlToeAmputations = { great: "none", second: "none", third: "none", fourth: "none", fifth: "none" };
      factsPatch[LL_FK_TOE_AMPUTATIONS] = makeFact(emptyToes, raw);
    }
    if (!factsPatch[LL_FK_SHORTENING_CM]) {
      factsPatch[LL_FK_SHORTENING_CM] = makeFact(0, raw);
    }
    if (!factsPatch[LL_FK_DBE_SELECTIONS]) {
      factsPatch[LL_FK_DBE_SELECTIONS] = makeFact([] as LlDbeSelectionEntry[], raw);
    }
    displayValuesPatch.no_other_findings = "true";
  }

  return {
    extractedFactsPatch: factsPatch,
    pendingObservationsToAdd: pendingToAdd,
    pendingObservationsToResolve: pendingToResolve,
    slotSignalsPatch,
    displayValuesPatch,
    warnings,
  };
}
