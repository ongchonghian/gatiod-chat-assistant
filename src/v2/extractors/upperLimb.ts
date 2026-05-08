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
  finger: "index_mcp",
  "index finger": "index_mcp",
  "middle finger": "middle_mcp",
  "ring finger": "ring_mcp",
  "little finger": "little_mcp",
};

const JOINT_RE = /\b(shoulder|elbow|wrist|thumb(?:\s+(?:ip|mp|cmc))?|(?:index|middle|ring|little)\s+finger|finger)\b/gi;

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

const NERVE_RE = /\b(median(?:\s+(?:above|below))?|anterior\s+interosseous|ulnar(?:\s+(?:above|below))?|radial(?:\s+(?:upper|elbow))?|suprascapular|brachial\s+plexus|upper\s+trunk|middle\s+trunk|lower\s+trunk)\b/i;

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
  const canonicalJoint: string | undefined =
    jointMatches.length > 0 ? (JOINT_MAP[jointMatches[0]] ?? jointMatches[0]) : undefined;

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

  // ── DBE conditions from ontology matches ──────────────────────────────────
  const dbeMatches = ontologyMatches.filter((m) => m.type === "dbe" && m.system === "upper_limb");
  if (dbeMatches.length > 0) {
    // DBE conditions are only wired from ontology lookup results, not raw text (D2)
    slotSignalsPatch.dbe_condition = true;
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
