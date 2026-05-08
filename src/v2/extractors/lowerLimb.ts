import { randomUUID } from "crypto";
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

const BARE_ANGLE_RE = /\b(\d+)(?:\s*[°º]|\s+degrees?)/g;
const ANKYLOSIS_RE = /\b(ankylos(?:ed)?|fixed\s+at|fused)\b/i;

const JOINT_MAP: Record<string, string> = {
  hip: "hip",
  knee: "knee",
  ankle: "ankle",
  subtalar: "subtalar",
  "great toe mtp": "great_toe_mtp",
  "great toe ip": "great_toe_ip",
  "great toe": "great_toe_mtp",
  "big toe": "great_toe_mtp",
  hallux: "great_toe_mtp",
  "lesser toes": "lesser_toes_mtp",
  "lesser toes mtp": "lesser_toes_mtp",
  "2nd toe": "lesser_toes_mtp",
  "second toe": "lesser_toes_mtp",
};

const JOINT_RE = /\b(hip|knee|ankle|subtalar|great\s+toe(?:\s+(?:mtp|ip))?|big\s+toe|hallux|lesser\s+toes?(?:\s+mtp)?|2nd\s+toe|second\s+toe)\b/gi;

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

const NERVE_RE = /\b(lumbosacral(?:\s+plexus)?|femoral|obturator|superior\s+gluteal|inferior\s+gluteal|lateral\s+femoral\s+cutaneous|sciatic|common\s+peroneal|superficial\s+peroneal|deep\s+peroneal|tibial|sural|medial\s+plantar|lateral\s+plantar)\b/i;

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
const SHORTENING_KEYWORD_RE = /\bshorten(?:ing)?\b/i;
const SHORTENING_CM_RE = /\b(\d+(?:\.\d+)?)\s*cm\b/i;

const LEG_AMP_RE = /\b(above[\s-](?:the\s+)?knee|ak\s+amp(?:utation)?|trans[\s-]?femoral|through\s+(?:the\s+)?femur|below[\s-](?:the\s+)?knee|bk\s+amp(?:utation)?|trans[\s-]?tibial|syme['s]*(?:\s+amp(?:utation)?)?|midtarsal|chopart(?:'s)?|transmetatarsal|trans[\s-]?metatarsal)\b/i;

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
  if (SIDE_BILATERAL_RE.test(text)) {
    warnings.push("Bilateral lower limb: side must be specified per case; asking.");
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
  const canonicalJoint: string | undefined =
    jointMatches.length > 0 ? (JOINT_MAP[jointMatches[0]] ?? jointMatches[0].replace(/\s+/g, "_")) : undefined;

  // Parse direction+angle pairs
  const directionPairs: { direction: string; angle: number }[] = [];
  {
    const dirRe = new RegExp(DIRECTION_RE.source, "gi");
    let dm: RegExpExecArray | null;
    while ((dm = dirRe.exec(text)) !== null) {
      const dirKey = DIRECTION_MAP[dm[1].toLowerCase()] ?? dm[1].toLowerCase();
      directionPairs.push({ direction: dirKey, angle: Number(dm[2]) });
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
    const cmMatch = SHORTENING_CM_RE.exec(text);
    if (cmMatch) {
      const discrepancyCm = parseFloat(cmMatch[1]);
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
    }
  }

  // ── Toe amputations ───────────────────────────────────────────────────────
  const toeMatches: { toe: ToeKey; rawText: string }[] = [];
  {
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
  const dbeMatches = ontologyMatches.filter((m) => m.type === "dbe" && m.system === "lower_limb");
  if (dbeMatches.length > 0) {
    slotSignalsPatch.dbe_condition = true;
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
