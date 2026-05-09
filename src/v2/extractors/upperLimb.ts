import { randomUUID } from "crypto";
import { DBE_CONDITIONS as UPPER_DBE_CONDITIONS } from "../../engine/upperLimbData.js";
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

export const FK_SIDE              = "side";
export const FK_ROM_JOINTS        = "rom_joints";
export const FK_ROM_FROM_NERVE    = "rom_from_nerve";
export const FK_NERVE_SELECTIONS  = "nerve_selections";
export const FK_ARM_AMPUTATION    = "arm_amputation";
export const FK_FINGER_AMPUTATIONS= "finger_amputations";
export const FK_DBE_SELECTIONS    = "dbe_selections";

// ── Internal types ────────────────────────────────────────────────────────────

export interface RomJointEntry { isAnkylosed: boolean; measurements: Record<string, number> }
export interface NerveSelectionEntry {
  nerveKey: string;
  deficitType: "sensory" | "motor" | "combined";
  lossType: "total" | "partial";
  severityId?: string;
}
export interface DbeSelectionEntry {
  conditionId: string;
  selectedPercent: number;
  selectedAnatomicalKey?: string;
}

// ── Pattern tables ────────────────────────────────────────────────────────────

const DIRECTION_MAP: Record<string, string> = {
  flexion: "flexion",
  extension: "extension",
  abduction: "abduction",
  adduction: "adduction",
  "internal rotation": "internal_rotation",
  "external rotation": "external_rotation",
  pronation: "pronation",
  supination: "supination",
  "radial deviation": "radial_deviation",
  "ulnar deviation": "ulnar_deviation",
  "flexion contracture": "flexion_contracture",
  dorsiflexion: "dorsiflexion",
  plantarflexion: "plantarflexion",
};

const DIRECTION_RE = new RegExp(
  `\\b(${Object.keys(DIRECTION_MAP).join("|")})\\s+(\\d+)(?:\\s*[°º]|\\s+degrees?)`,
  "gi"
);

// Slice-18 — workbook phrasings put text between the direction word and the
// angle, e.g. "active flexion from neutral / arc of active flexion: 140°"
// or "ankylosed in adduction: 50°". Allow up to ~80 non-digit chars between
// direction and the angle so the extractor can pull `flexion + 140` from
// these natural-language formats. Falls back from DIRECTION_RE; only used
// when the strict pattern produces no matches.
const DIRECTION_LOOSE_RE = new RegExp(
  `\\b(${Object.keys(DIRECTION_MAP).join("|")})\\b[^°º\\d]{0,80}?(\\d+)\\s*[°º]`,
  "gi"
);

const BARE_ANGLE_RE = /\b(\d+)(?:\s*[°º]|\s+degrees?)/g;
const ANKYLOSIS_RE = /\b(ankylos(?:ed)?|fixed\s+at|fused)\b/i;

const JOINT_MAP: Record<string, string> = {
  shoulder: "shoulder",
  elbow: "elbow",
  wrist: "wrist",
  thumb: "thumb_mp",
  "thumb ip": "thumb_ip",
  "thumb mp": "thumb_mp",
  "thumb cmc": "thumb_cmc",
  // Slice-22 — long-form anatomical joint names used by the workbook.
  "thumb interphalangeal": "thumb_ip",
  "thumb metacarpophalangeal": "thumb_mp",
  "thumb carpometacarpal": "thumb_cmc",
  "finger distal interphalangeal": "finger_dip",
  "finger proximal interphalangeal": "finger_pip",
  "finger metacarpophalangeal": "finger_mcp",
  finger: "index_mcp",
  "index finger": "index_mcp",
  "middle finger": "middle_mcp",
  "ring finger": "ring_mcp",
  "little finger": "little_mcp",
};

const JOINT_RE = /\b(shoulder|elbow|wrist|thumb(?:\s+(?:ip|mp|cmc|interphalangeal|metacarpophalangeal|carpometacarpal))?|finger\s+(?:distal\s+interphalangeal|proximal\s+interphalangeal|metacarpophalangeal)|(?:index|middle|ring|little)\s+finger|finger)\b/gi;

// Slice-22 — parenthetical finger spec at the end of a workbook row, e.g.
// "Right finger metacarpophalangeal joint ankylosed: 10° (index finger)".
// Captures which finger the generic "finger" joint reference applies to.
const PAREN_FINGER_RE = /\(\s*(index|middle|ring|little|ring\s+or\s+little)\s+finger\s*\)/i;

const NERVE_MAP: Record<string, string> = {
  median: "median_below",
  "median above": "median_above",
  "median below": "median_below",
  "anterior interosseous": "median_anterior_interosseous",
  ulnar: "ulnar_below",
  "ulnar above": "ulnar_above",
  "ulnar below": "ulnar_below",
  radial: "radial_elbow",
  "radial upper": "radial_upper",
  "radial elbow": "radial_elbow",
  suprascapular: "suprascapular",
  "brachial plexus": "brachial_c5_t1",
  "upper trunk": "upper_trunk_c5_c6",
  "middle trunk": "middle_trunk_c7",
  "lower trunk": "lower_trunk_c8_t1",
};

// Slice-19 — `ulnar deviation` and `radial deviation` are wrist ROM
// directions, not nerves. Negative lookahead excludes them so the
// extractor doesn't treat "Right wrist ankylosed in ulnar deviation: 10°"
// as a partial ulnar-nerve specification.
const NERVE_RE = /\b(median(?:\s+(?:above|below))?|anterior\s+interosseous|ulnar(?!\s+deviation)(?:\s+(?:above|below))?|radial(?!\s+deviation)(?:\s+(?:upper|elbow))?|suprascapular|brachial\s+plexus|upper\s+trunk|middle\s+trunk|lower\s+trunk)\b/i;

const DEFICIT_RE = /\b(sensory|motor|combined)\b/i;
const LOSS_RE = /\b(total|partial)\b/i;
const SIDE_RE = /\b(left|right)\b/i;
const SIDE_BILATERAL_RE = /\b(bilateral|both\s+sides?)\b/i;
const ROM_FROM_NERVE_YES = /\b(due\s+to\s+nerve|from\s+nerve|because\s+of\s+nerve|rom\s+from\s+nerve)\b/i;
const ROM_FROM_NERVE_NO = /\b(independent|not\s+(?:from|related\s+to)\s+nerve|separate\s+rom)\b/i;
const NO_OTHER_FINDINGS_RE = /\bno\s+other\s+findings?\b/i;
const NEGATE_NERVE_RE = /\b(no|without|absent|negative)\s+(?:nerve|neurological|neuropathy|palsy)\b/i;
const NEGATE_AMP_RE = /\b(no|without)\s+(?:amputation|amp\b)/i;
const NEGATE_DBE_RE = /\b(no|without|negative)\s+(?:dbe|diagnosis.?based|fracture|instability|oa|osteoarthritis)\b/i;
const ARM_AMP_RE = /\b(above\s+elbow|below\s+elbow|at\s+wrist|wrist\s+disarticulation|trans.?humeral|trans.?radial)\b/i;

// Slice-20 — digit amputation patterns. Workbook phrasings:
//   "Loss of right index finger - two phalanges"
//   "Loss of left thumb - one phalanx"
//   "Loss of right thumb - both phalanges and 1st metacarpal"
//   "Loss of left index finger - three phalanges and 2nd metacarpal"
//   "Loss of right four fingers" / "Loss of left four fingers and thumb"
const DIGIT_AMP_RE = /\bloss\s+of\s+(?:(?:the\s+)?(left|right)\s+)?(thumb|index|middle|ring|little)(?:\s+finger)?\s*[-–—]\s*(one|two|three|both)\s+(phalanx|phalanges)(?:\s+and\s+(\d+)(?:st|nd|rd|th)?\s+metacarpal)?/i;
const FOUR_FINGERS_AMP_RE = /\bloss\s+of\s+(?:(?:the\s+)?(left|right)\s+)?four\s+fingers(?:\s+and\s+(?:(?:the\s+)?thumb))?(?:\s+of\s+(?:one|both)\s+hand)?/i;

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

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractUpperLimb(
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
  if (SIDE_BILATERAL_RE.test(text)) {
    warnings.push("Bilateral upper limb: side must be specified per case; asking.");
  } else {
    const sideMatch = SIDE_RE.exec(text);
    if (sideMatch) {
      const side = sideMatch[1].toLowerCase() as "left" | "right";
      factsPatch[FK_SIDE] = makeFact(side, raw);
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
      jointMatches.push(jm[0].toLowerCase());
    }
  }
  // Slice-25 — prefer longest joint match. Workbook rows say
  // "Finger PIP joint: ... finger proximal interphalangeal joint ankylosed"
  // and the bare "finger" matches at position 0 before the long-form
  // "finger proximal interphalangeal" later in the text. Without this,
  // canonical resolves to "index_mcp" (the JOINT_MAP default for bare
  // "finger") instead of "finger_pip".
  const longestJoint = jointMatches.reduce(
    (best, cur) => (cur.length > best.length ? cur : best),
    jointMatches[0] ?? "",
  );
  const canonicalJoint: string | undefined =
    longestJoint ? (JOINT_MAP[longestJoint] ?? longestJoint) : undefined;

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
  // Slice-27 — pair direction words and angles by proximity, preferring
  // the LONGEST direction word that appears within ~80 chars before the
  // angle. Mirror of the lower_limb fix; protects against workbook
  // phrasings where a generic direction word ("extension") precedes a
  // more-specific one ("flexion contracture") for the same angle.
  if (directionPairs.length === 0) {
    const dirOccurrences: { word: string; pos: number }[] = [];
    const dirWords = Object.keys(DIRECTION_MAP);
    for (const word of dirWords) {
      const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        dirOccurrences.push({ word: word.toLowerCase(), pos: m.index });
      }
    }
    const angleRe = /(\d+)\s*[°º]/g;
    const angleOccurrences: { angle: number; pos: number }[] = [];
    let am: RegExpExecArray | null;
    while ((am = angleRe.exec(text)) !== null) {
      angleOccurrences.push({ angle: Number(am[1]), pos: am.index });
    }
    const seenDirections = new Set<string>();
    for (const { angle, pos: angleP } of angleOccurrences) {
      const candidates = dirOccurrences.filter((d) => d.pos < angleP && angleP - d.pos <= 80);
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => b.word.length - a.word.length || a.pos - b.pos);
      const chosen = candidates[0];
      const dirKey = DIRECTION_MAP[chosen.word] ?? chosen.word;
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
    // Fully resolved ROM measurement → graduate to extractedFacts
    const existingRomJoints = (existingFacts[FK_ROM_JOINTS]?.value ?? {}) as Record<string, RomJointEntry>;
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
    factsPatch[FK_ROM_JOINTS] = makeFact(updatedJoints, raw);
    slotSignalsPatch.rom_joint = true;
    slotSignalsPatch.rom_measurements = true;
    slotSignalsPatch.ankylosis_flag = true;
  } else if (bareAngles.length > 0 && canonicalJoint) {
    // Slice-22 — single-direction finger/thumb joints in the engine only
    // have flexion. When ankylosed at a specific angle ("ankylosed: 50°"),
    // there's no genuine ambiguity — auto-default direction to flexion
    // rather than asking the doctor a question with one answer.
    const SINGLE_DIRECTION_ANKYLOSIS: Record<string, string> = {
      thumb_mp: "flexion",
      thumb_ip: "flexion",
      finger_dip: "flexion",
      finger_pip: "flexion",
      finger_mcp: "flexion",
    };
    const autoDirection = isAnkylosed ? SINGLE_DIRECTION_ANKYLOSIS[canonicalJoint] : undefined;
    if (autoDirection) {
      // Slice-25 — finger joints (finger_dip/pip/mcp) are perFinger in the
      // engine and use storage key `<joint>::<finger>`. Without applying the
      // parenthetical finger from the workbook ("(ring finger)"), the
      // ROM fact landed under "finger_pip" alone and the engine couldn't
      // find it. Detect the finger and use the canonical storage key.
      let storageJoint = canonicalJoint;
      if (canonicalJoint.startsWith("finger_")) {
        const fm = PAREN_FINGER_RE.exec(text);
        if (fm) {
          const fingerWord = fm[1].toLowerCase();
          // "ring or little" defaults to ring — engine has separate
          // directionsRingLittle table; either ring or little works.
          const finger =
            fingerWord === "ring or little" ? "ring" :
            fingerWord === "index" || fingerWord === "middle" ||
            fingerWord === "ring"  || fingerWord === "little" ? fingerWord : null;
          if (finger) storageJoint = `${canonicalJoint}::${finger}`;
        }
      }
      const existingRomJoints = (existingFacts[FK_ROM_JOINTS]?.value ?? {}) as Record<string, RomJointEntry>;
      const jointEntry = existingRomJoints[storageJoint] ?? { isAnkylosed: false, measurements: {} };
      const updatedJoints = {
        ...existingRomJoints,
        [storageJoint]: {
          isAnkylosed: true,
          measurements: { ...jointEntry.measurements, [autoDirection]: bareAngles[0] },
        },
      };
      factsPatch[FK_ROM_JOINTS] = makeFact(updatedJoints, raw);
      slotSignalsPatch.rom_joint = true;
      slotSignalsPatch.rom_measurements = true;
      slotSignalsPatch.ankylosis_flag = true;
      displayValuesPatch[`rom_${storageJoint}_${autoDirection}`] = `${bareAngles[0]}° (ankylosed)`;
      // Skip the pending-observation path below.
    } else {
    // Bare angle with known joint but unknown direction → pending observation
    const chipsByJoint: Record<string, string[]> = {
      shoulder: ["Flexion", "Extension", "Abduction", "Adduction", "Internal Rotation", "External Rotation"],
      elbow: ["Flexion", "Flexion Contracture", "Pronation", "Supination"],
      wrist: ["Flexion", "Extension", "Radial Deviation", "Ulnar Deviation"],
    };
    const chips = chipsByJoint[canonicalJoint] ?? ["Flexion", "Extension"];
    pendingToAdd.push(
      makeObservation(
        "upper_limb",
        "rom_measurement",
        raw,
        { joint: canonicalJoint, angle: bareAngles[0], isAnkylosed },
        ["direction"],
        `Which ${canonicalJoint} movement does ${bareAngles[0]}° apply to?`,
        chips
      )
    );
    slotSignalsPatch.rom_joint = true;
    } // close auto-direction else
  } else if (bareAngles.length > 0 && !canonicalJoint) {
    // Bare angle with no joint → ask for joint first
    pendingToAdd.push(
      makeObservation(
        "upper_limb",
        "rom_measurement",
        raw,
        { angle: bareAngles[0], isAnkylosed },
        ["joint", "direction"],
        `${bareAngles[0]}° — which joint and movement does this apply to?`,
        ["Shoulder", "Elbow", "Wrist"]
      )
    );
  }

  // ── Nerve ─────────────────────────────────────────────────────────────────
  if (NEGATE_NERVE_RE.test(text)) {
    // Explicit negation — graduate "no nerve" as empty selections
    factsPatch[FK_NERVE_SELECTIONS] = makeFact([] as NerveSelectionEntry[], raw);
    slotSignalsPatch.nerve_present = false;
    displayValuesPatch.nerve_present = "none";
  } else {
    const nerveMatch = NERVE_RE.exec(text);
    if (nerveMatch) {
      const nerveKey = NERVE_MAP[nerveMatch[0].toLowerCase()] ?? nerveMatch[0].toLowerCase();
      const deficitMatch = DEFICIT_RE.exec(text);
      const lossMatch = LOSS_RE.exec(text);

      if (deficitMatch && lossMatch) {
        const deficitType = deficitMatch[1].toLowerCase() as "sensory" | "motor" | "combined";
        const lossType = lossMatch[1].toLowerCase() as "total" | "partial";
        const existing = (existingFacts[FK_NERVE_SELECTIONS]?.value ?? []) as NerveSelectionEntry[];
        const updated = [...existing.filter((n) => n.nerveKey !== nerveKey), { nerveKey, deficitType, lossType }];
        factsPatch[FK_NERVE_SELECTIONS] = makeFact(updated, raw);
        slotSignalsPatch.nerve_present = true;
        slotSignalsPatch.nerve_details = true;
        displayValuesPatch.nerve_name = nerveKey;
        displayValuesPatch.nerve_deficit = `${deficitType} ${lossType}`;
      } else {
        // Nerve identified but deficit/loss type missing → pending observation
        const missingFields: string[] = [];
        if (!deficitMatch) missingFields.push("deficitType");
        if (!lossMatch) missingFields.push("lossType");
        pendingToAdd.push(
          makeObservation(
            "upper_limb",
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
    factsPatch[FK_ROM_FROM_NERVE] = makeFact(true, raw);
    slotSignalsPatch.rom_from_nerve = true;
    displayValuesPatch.rom_from_nerve = "due to nerve";
  } else if (ROM_FROM_NERVE_NO.test(text)) {
    factsPatch[FK_ROM_FROM_NERVE] = makeFact(false, raw);
    slotSignalsPatch.rom_from_nerve = true;
    displayValuesPatch.rom_from_nerve = "independent";
  }

  // ── Amputation ────────────────────────────────────────────────────────────
  if (NEGATE_AMP_RE.test(text)) {
    factsPatch[FK_ARM_AMPUTATION] = makeFact("none", raw);
    slotSignalsPatch.amputation_present = false;
    displayValuesPatch.amputation_present = "none";
  } else {
    const armAmpMatch = ARM_AMP_RE.exec(text);
    if (armAmpMatch) {
      const raw_amp = armAmpMatch[1].toLowerCase();
      const armLevelMap: Record<string, string> = {
        "above elbow": "above_elbow",
        "trans humeral": "above_elbow",
        "transhumeral": "above_elbow",
        "below elbow": "below_elbow",
        "trans radial": "below_elbow",
        "transradial": "below_elbow",
        "at wrist": "hand",
        "wrist disarticulation": "hand",
      };
      const armLevel = armLevelMap[raw_amp] ?? raw_amp;
      factsPatch[FK_ARM_AMPUTATION] = makeFact(armLevel, raw);
      slotSignalsPatch.amputation_present = true;
      displayValuesPatch.amputation_level = armLevel;
    }
  }

  // ── Digit amputation (slice-20) ───────────────────────────────────────────
  // Workbook digit-amputation patterns. Maps "N phalanges" / "one phalanx"
  // / "both phalanges" + optional "and Nth metacarpal" to the engine's
  // FINGER_AMPUTATION_LEVELS (ip/mp/cmc/mc_only for thumb;
  // dip/pip/mp/mc/mc_only for other fingers).
  const fingerAmps: Record<string, string> = {};
  const digitMatch = DIGIT_AMP_RE.exec(text);
  if (digitMatch) {
    const finger = digitMatch[2].toLowerCase();
    const phalCount = digitMatch[3].toLowerCase();
    const hasMetacarpal = digitMatch[5] !== undefined;
    let level: string | undefined;
    if (finger === "thumb") {
      // Thumb: ip = 1 phalanx, mp = both phalanges, cmc = both + metacarpal
      if (phalCount === "one") level = "ip";
      else if (phalCount === "two" || phalCount === "both") {
        level = hasMetacarpal ? "cmc" : "mp";
      }
    } else {
      // Non-thumb: dip/pip/mp/mc by phalanx count + optional metacarpal
      if (phalCount === "one") level = "dip";
      else if (phalCount === "two") level = "pip";
      else if (phalCount === "three") level = hasMetacarpal ? "mc" : "mp";
    }
    if (level) {
      fingerAmps[finger] = level;
      slotSignalsPatch.amputation_present = true;
    }
  }
  // Multi-finger patterns: "four fingers" / "four fingers and thumb".
  const fourFingerMatch = FOUR_FINGERS_AMP_RE.exec(text);
  if (fourFingerMatch) {
    // GATIOD: "loss of four fingers + thumb" caps at 70% (whole hand);
    // "four fingers only" caps at 60%. Mark all relevant fingers at "mp"
    // (three phalanges) which is the conventional "whole finger" loss.
    for (const f of ["index", "middle", "ring", "little"]) fingerAmps[f] = "mp";
    if (/and\s+(?:the\s+)?thumb/i.test(fourFingerMatch[0])) {
      fingerAmps.thumb = "mp"; // both phalanges = whole thumb
    }
    slotSignalsPatch.amputation_present = true;
  }
  if (Object.keys(fingerAmps).length > 0) {
    // Merge with any existing finger amputations from prior turns.
    const existing = (existingFacts[FK_FINGER_AMPUTATIONS]?.value ?? {}) as Record<string, string>;
    factsPatch[FK_FINGER_AMPUTATIONS] = makeFact({ ...existing, ...fingerAmps }, raw);
    displayValuesPatch.finger_amputations = Object.entries(fingerAmps)
      .map(([f, lvl]) => `${f}: ${lvl}`)
      .join(", ");
  }

  // ── DBE conditions from ontology matches ──────────────────────────────────
  // Slice-23 — auto-populate FK_DBE_SELECTIONS when the doctor's
  // description has a single dominant high-confidence ontology match
  // (score ≥ 0.5 AND ≥1.5× the next match's score). The doctor literally
  // wrote the condition; "stated by the doctor" per D2's inference
  // boundary is satisfied. The doctor can still edit at confirmation.
  const dbeMatches = ontologyMatches.filter((m) => m.type === "dbe" && m.system === "upper_limb");
  if (dbeMatches.length > 0) {
    slotSignalsPatch.dbe_condition = true;
    const top = dbeMatches[0];
    const next = dbeMatches[1];
    // Dominance: top score ≥ 0.4 absolute, AND either no second match OR
    // top is meaningfully ahead (≥0.1 absolute gap) OR top is high-
    // confidence (≥0.55) on its own. The threshold dropped from 0.5 →
    // 0.4 because workbook region-prefixed descriptions dilute scores
    // relative to the bare condition name (~0.55 → ~0.48).
    const dominantEnough =
      top.score >= 0.4 &&
      (!next || top.score - next.score >= 0.1 || top.score >= 0.55);
    if (dominantEnough && !factsPatch[FK_DBE_SELECTIONS] && !existingFacts[FK_DBE_SELECTIONS]) {
      const cond = UPPER_DBE_CONDITIONS.find((c) => c.id === top.canonicalId);
      if (cond) {
        const existing: DbeSelectionEntry[] = [];
        const updated = [...existing, { conditionId: cond.id, selectedPercent: cond.minPercent }];
        factsPatch[FK_DBE_SELECTIONS] = makeFact(updated, raw);
        slotSignalsPatch.dbe_present = true;
        displayValuesPatch.dbe_condition = `${cond.label} (${cond.minPercent}%)`;
      }
    }
  }

  // ── DBE negation ──────────────────────────────────────────────────────────
  if (NEGATE_DBE_RE.test(text)) {
    factsPatch[FK_DBE_SELECTIONS] = makeFact([] as DbeSelectionEntry[], raw);
    slotSignalsPatch.dbe_present = false;
    displayValuesPatch.dbe_present = "none";
  }

  // ── "No other findings" ───────────────────────────────────────────────────
  if (NO_OTHER_FINDINGS_RE.test(text)) {
    if (!factsPatch[FK_NERVE_SELECTIONS]) {
      factsPatch[FK_NERVE_SELECTIONS] = makeFact([] as NerveSelectionEntry[], raw);
    }
    if (!factsPatch[FK_ARM_AMPUTATION]) {
      factsPatch[FK_ARM_AMPUTATION] = makeFact("none", raw);
    }
    if (!factsPatch[FK_DBE_SELECTIONS]) {
      factsPatch[FK_DBE_SELECTIONS] = makeFact([] as DbeSelectionEntry[], raw);
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
