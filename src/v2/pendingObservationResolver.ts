import type {
  GatiodSystemKey,
  NormalizedUtterance,
  PendingObservation,
  PendingObservationResolutionResult,
  V2SessionState,
  V2SystemFacts,
} from "./contracts.js";
import { graduateObservation } from "./stateMachine.js";
import {
  FK_NERVE_SELECTIONS,
  FK_ROM_FROM_NERVE,
  FK_ROM_JOINTS,
  type NerveSelectionEntry,
  type RomJointEntry,
} from "./extractors/upperLimb.js";
import {
  SP_FK_ENTRIES,
  SP_FK_REGION,
  resolveSpineSeverityKeyFromText,
  type SpineCategoryEntryFact,
} from "./extractors/spine.js";
import {
  getSeveritiesForCategory,
  type DiagnosisCategory,
  type SeverityKey,
  type SpondylolysisPathway,
  type SpinalRegion,
} from "../engine/spineAssessmentData.js";
import { RENAL_FK_CREATININE_CLEARANCE } from "./extractors/renal.js";
import {
  GASTRO_FK_SUBSYSTEM,
  GASTRO_FK_COLONAL_SUBPATH,
  GASTRO_FK_LIVER_BILIARY_SUBPATH,
  GASTRO_FK_BRACKET_INDEX,
  GASTRO_FK_PI_PERCENT,
} from "./extractors/gastro.js";
import { getActiveBrackets } from "../engine/gastroDigestiveData.js";
import type { GastroDigestiveValue, GastroSubSystem, ColonalSubPath, LiverBiliarySubPath } from "../engine/gastroDigestiveData.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
} from "./extractors/hearing.js";
import {
  bracketIdFromChip,
  G1A_CHIPS, G1B_CHIPS, G1C_CHIPS, G2_CHIPS, G3_CHIPS, G4_CHIPS,
  B_OLFACTION_CHIPS, B_FACIAL_CHIPS, B_EQUILIBRIUM_CHIPS,
  B_SWALLOWING_CHIPS, B_STATION_GAIT_CHIPS, B_RESPIRATION_CHIPS, LIMB_CHIPS,
  CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
  CNS_FK_G2, CNS_FK_G3, CNS_FK_G4,
  CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL, CNS_FK_B_EQUILIBRIUM,
  CNS_FK_B_SWALLOWING, CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  CNS_FK_C_LIMBS,
} from "./extractors/cns.js";
import {
  GROUP1_SUBCATEGORIES, GROUP2_BRACKETS, GROUP3_BRACKETS, GROUP4_BRACKETS,
  OLFACTION_BRACKETS, FACIAL_NERVE_BRACKETS, EQUILIBRIUM_BRACKETS,
  SWALLOWING_BRACKETS, STATION_GAIT_BRACKETS, RESPIRATION_BRACKETS,
  PARALYSED_LIMB_OPTIONS,
  type SeverityBracket,
} from "../engine/cnsAssessmentData.js";
import {
  acuityIdFromChip, fieldIdFromChip, diplopiaIdFromChip,
  VISUAL_FK_LEFT_ACUITY, VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD, VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_DIPLOPIA,
} from "./extractors/visual.js";

const DIRECTION_TEXT_MAP: Record<string, string> = {
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

function nowIso(): string { return new Date().toISOString(); }

function resolveRomMeasurement(
  obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const normalized = text.trim().toLowerCase();

  // Map chip reply to canonical direction key
  let directionKey: string | undefined;
  for (const [label, key] of Object.entries(DIRECTION_TEXT_MAP)) {
    if (normalized === label || normalized === label.replace(/\s+/g, " ")) {
      directionKey = key;
      break;
    }
  }
  if (!directionKey) {
    // Try partial match (e.g. "flexion 90°" in a re-reply)
    for (const [label, key] of Object.entries(DIRECTION_TEXT_MAP)) {
      if (normalized.includes(label)) { directionKey = key; break; }
    }
  }
  if (!directionKey) return { resolved: false };

  const parsed = obs.parsed as { joint?: string; angle?: number; isAnkylosed?: boolean };
  const joint = parsed.joint;
  const angle = parsed.angle;
  if (!joint || angle === undefined) return { resolved: false };

  const existingJoint: RomJointEntry = { isAnkylosed: parsed.isAnkylosed ?? false, measurements: {} };
  const updatedEntry: RomJointEntry = {
    isAnkylosed: existingJoint.isAnkylosed,
    measurements: { ...existingJoint.measurements, [directionKey]: angle },
  };

  const factsPatch: V2SystemFacts = {
    [FK_ROM_JOINTS]: {
      value: { [joint]: updatedEntry },
      sourceText: obs.sourceText,
      confidence: 1.0,
      extractionMethod: "user_selected",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
  return { resolved: true, factsPatch };
}

function resolveNerveDeficit(
  obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const normalized = text.trim().toLowerCase();

  const deficitMatch = /\b(sensory|motor|combined)\b/i.exec(normalized);
  const lossMatch = /\b(total|partial)\b/i.exec(normalized);

  if (!deficitMatch || !lossMatch) return { resolved: false };

  const parsed = obs.parsed as { nerveKey?: string };
  if (!parsed.nerveKey) return { resolved: false };

  const entry: NerveSelectionEntry = {
    nerveKey: parsed.nerveKey,
    deficitType: deficitMatch[1].toLowerCase() as "sensory" | "motor" | "combined",
    lossType: lossMatch[1].toLowerCase() as "total" | "partial",
  };

  const factsPatch: V2SystemFacts = {
    [FK_NERVE_SELECTIONS]: {
      value: [entry],
      sourceText: text,
      confidence: 1.0,
      extractionMethod: "user_selected",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
  return { resolved: true, factsPatch };
}

function resolveRomFromNerve(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const normalized = text.trim().toLowerCase();
  const isDue = /\b(due\s+to\s+nerve|from\s+nerve|because\s+of\s+nerve|rom\s+from\s+nerve)\b/.test(normalized);
  const isIndependent = /\b(independent|not\s+from\s+nerve|separate\s+rom)\b/.test(normalized);

  if (!isDue && !isIndependent) return { resolved: false };

  const factsPatch: V2SystemFacts = {
    [FK_ROM_FROM_NERVE]: {
      value: isDue,
      sourceText: text,
      confidence: 1.0,
      extractionMethod: "user_selected",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
  return { resolved: true, factsPatch };
}

// ── Spine region resolution (other/spine_region subtype) ─────────────────────

const SPINE_REGION_MAP: Record<string, SpinalRegion> = {
  "cervical (c1–c7)": "cervical",
  "cervical": "cervical",
  "thoraco-lumbar (t1–l1)": "thoraco_lumbar",
  "thoraco-lumbar": "thoraco_lumbar",
  "thoracolumbar": "thoraco_lumbar",
  "lumbo-sacral (l2–s1)": "lumbo_sacral",
  "lumbo-sacral": "lumbo_sacral",
  "lumbosacral": "lumbo_sacral",
  "lumbar": "lumbo_sacral",
};

function resolveSpineRegion(
  obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const normalized = text.trim().toLowerCase();
  const region = SPINE_REGION_MAP[normalized]
    ?? Object.entries(SPINE_REGION_MAP).find(([k]) => normalized.includes(k))?.[1];
  if (!region) return { resolved: false };

  const parsed = obs.parsed as { partialCategory?: DiagnosisCategory };
  const factsPatch: V2SystemFacts = {
    [SP_FK_REGION]: {
      value: region,
      sourceText: text,
      confidence: 1.0,
      extractionMethod: "user_selected",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };

  // If the obs carried a partial category, keep it in state as a prompt for the next round
  // (severity obs will be created on the next extractor pass)
  void parsed;

  return { resolved: true, factsPatch };
}

// ── Spine severity_bracket resolution ────────────────────────────────────────

function resolveSpineSeverity(
  obs: PendingObservation,
  text: string,
  state: V2SessionState,
  system: GatiodSystemKey
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const normalized = text.trim().toLowerCase();
  const parsed = obs.parsed as {
    diagnosisCategory: DiagnosisCategory;
    partialEntry: SpineCategoryEntryFact;
    region: SpinalRegion;
  };

  if (!parsed.diagnosisCategory || !parsed.partialEntry) return { resolved: false };

  // Find which severity option label matches the doctor's chip reply
  const severityOptions = getSeveritiesForCategory(parsed.diagnosisCategory, {
    spondylolysisPathway: parsed.partialEntry.spondylolysisPathway,
  });

  let matchedKey: SeverityKey | undefined;
  for (const opt of severityOptions) {
    if (normalized === opt.label.toLowerCase() || normalized.includes(opt.key.replace(/_/g, " ").toLowerCase())) {
      matchedKey = opt.key;
      break;
    }
    // Allow partial match of the short label key
    if (normalized.includes(opt.key.toLowerCase())) {
      matchedKey = opt.key;
      break;
    }
  }

  // Fallback to the shared severity parser so chip text like
  // "Compression or burst fractures of <25% with residual pain" or natural
  // phrasings reach the same matcher used by the extractor.
  if (!matchedKey) {
    matchedKey = resolveSpineSeverityKeyFromText(
      text,
      parsed.diagnosisCategory,
      parsed.partialEntry.spondylolysisPathway
    );
    if (matchedKey) {
      // Validate the parsed key is actually one of the offered options for
      // this category/pathway before accepting it.
      const allowed = severityOptions.some((o) => o.key === matchedKey);
      if (!allowed) matchedKey = undefined;
    }
  }

  if (!matchedKey) return { resolved: false };

  const completedEntry: SpineCategoryEntryFact = {
    ...parsed.partialEntry,
    severityKey: matchedKey,
  };

  const existingEntries = (
    state.systems[system].extractedFacts[SP_FK_ENTRIES]?.value ?? []
  ) as SpineCategoryEntryFact[];

  const idx = existingEntries.findIndex((e) => e.diagnosisCategory === parsed.diagnosisCategory);
  const updatedEntries =
    idx >= 0
      ? existingEntries.map((e, i) => (i === idx ? completedEntry : e))
      : [...existingEntries, completedEntry];

  const factsPatch: V2SystemFacts = {
    [SP_FK_ENTRIES]: {
      value: updatedEntries.filter((e) => e.severityKey !== ""),
      sourceText: text,
      confidence: 1.0,
      extractionMethod: "user_selected",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
  return { resolved: true, factsPatch };
}

// ── Gastro-digestive pending obs resolvers ────────────────────────────────────

const GASTRO_SUBSYSTEM_MAP: Record<string, GastroSubSystem> = {
  "upper gi": "upperDigestive",
  "upper digestive": "upperDigestive",
  "oesophagus": "upperDigestive",
  "stomach": "upperDigestive",
  "duodenum": "upperDigestive",
  "pancreas": "upperDigestive",
  "colon": "colonicRectalAnal",
  "colon/rectum/anus": "colonicRectalAnal",
  "colonic": "colonicRectalAnal",
  "rectal": "colonicRectalAnal",
  "anal": "colonicRectalAnal",
  "liver": "liverBiliary",
  "liver/biliary": "liverBiliary",
  "biliary": "liverBiliary",
  "hernia": "herniation",
  "herniation": "herniation",
};

function resolveGastroSubsystem(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  const subsystem = GASTRO_SUBSYSTEM_MAP[norm]
    ?? Object.entries(GASTRO_SUBSYSTEM_MAP).find(([k]) => norm.includes(k))?.[1];
  if (!subsystem) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [GASTRO_FK_SUBSYSTEM]: { value: subsystem, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

function resolveGastroColonalSubpath(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  let subPath: ColonalSubPath | undefined;
  if (/anal|anal\s+disease/.test(norm)) subPath = "anal";
  else if (/colonic|rectal|colon/.test(norm)) subPath = "colonicRectal";
  if (!subPath) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [GASTRO_FK_COLONAL_SUBPATH]: { value: subPath, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

function resolveGastroLiverBiliarySubpath(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  let subPath: LiverBiliarySubPath | undefined;
  if (/biliary|bile\s+duct|biliary\s+tract/.test(norm)) subPath = "biliary";
  else if (/liver|hepatic/.test(norm)) subPath = "liver";
  if (!subPath) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [GASTRO_FK_LIVER_BILIARY_SUBPATH]: { value: subPath, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

const CLASS_ROMAN_MAP: Record<string, number> = {
  "class i": 0, "class 1": 0, "class ii": 1, "class 2": 1,
  "class iii": 2, "class 3": 2, "class iv": 3, "class 4": 3,
  "i": 0, "1": 0, "ii": 1, "2": 1, "iii": 2, "3": 2, "iv": 3, "4": 3,
};

function resolveGastroBracket(
  obs: PendingObservation,
  text: string,
  state: V2SessionState,
  system: GatiodSystemKey
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();

  // Try class map
  let idx: number | undefined = CLASS_ROMAN_MAP[norm];
  if (idx === undefined) {
    for (const [k, v] of Object.entries(CLASS_ROMAN_MAP)) {
      if (norm.includes(k)) { idx = v; break; }
    }
  }

  // Also accept chip label format "Class I (0–9%): ..."
  if (idx === undefined) {
    const m = /class\s*([1-4ivI]+)/i.exec(text);
    if (m) {
      const raw = m[1].toLowerCase();
      idx = CLASS_ROMAN_MAP[raw] ?? CLASS_ROMAN_MAP["class " + raw];
    }
  }

  if (idx === undefined) return { resolved: false };

  // Validate against active brackets for the subsystem
  const ef = state.systems[system].extractedFacts;
  const subsystem = ef[GASTRO_FK_SUBSYSTEM]?.value as GastroSubSystem | undefined;
  if (!subsystem) return { resolved: false };

  const brackets = getActiveBrackets({
    subSystem: subsystem,
    colonalSubPath: ef[GASTRO_FK_COLONAL_SUBPATH]?.value as ColonalSubPath | undefined,
    liverBiliarySubPath: ef[GASTRO_FK_LIVER_BILIARY_SUBPATH]?.value as LiverBiliarySubPath | undefined,
    selectedBracketIndex: idx,
    piPercent: null,
  } as GastroDigestiveValue);

  if (idx >= brackets.length) return { resolved: false };

  return {
    resolved: true,
    factsPatch: {
      [GASTRO_FK_BRACKET_INDEX]: { value: idx, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

function resolveGastroPiPercent(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*%?$/.exec(norm) ?? /^(\d+(?:\.\d+)?)/.exec(norm);
  if (!m) return { resolved: false };
  const pi = parseFloat(m[1]);
  if (isNaN(pi) || pi < 0 || pi > 100) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [GASTRO_FK_PI_PERCENT]: { value: pi, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

// ── Hearing pending obs resolvers ─────────────────────────────────────────────

function resolveHearingPath(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  let path: "nid" | "injury" | undefined;
  if (/\b(nid|noise[- ]induced|occupational\s+deafness|noise\s+induced)\b/.test(norm)) path = "nid";
  else if (/\b(injury|accident|trauma)\b/.test(norm)) path = "injury";
  if (!path) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [HEARING_FK_PATH]: { value: path, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

function resolveHearingAhl(
  obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  const parsed = obs.parsed as { missingEar?: string };
  const m = /(\d+(?:\.\d+)?)\s*(?:db)?$/.exec(norm) ?? /^(\d+(?:\.\d+)?)/.exec(norm);
  if (!m) return { resolved: false };
  const ahl = parseFloat(m[1]);
  if (isNaN(ahl) || ahl < 0) return { resolved: false };

  const factsPatch: V2SystemFacts = {};
  if (parsed.missingEar === "both") {
    // If only one value given for "both" query — assume one ear; need another round
    factsPatch[HEARING_FK_LEFT_EAR_AHL]  = { value: ahl, sourceText: text, confidence: 0.8, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() };
    factsPatch[HEARING_FK_RIGHT_EAR_AHL] = { value: ahl, sourceText: text, confidence: 0.8, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() };
  } else if (parsed.missingEar === "left") {
    factsPatch[HEARING_FK_LEFT_EAR_AHL] = { value: ahl, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() };
  } else {
    factsPatch[HEARING_FK_RIGHT_EAR_AHL] = { value: ahl, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() };
  }
  return { resolved: true, factsPatch };
}

function resolveHearingAge(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const m = /\b(\d{2,3})\b/.exec(text.trim());
  if (!m) return { resolved: false };
  const age = parseInt(m[1], 10);
  if (isNaN(age) || age < 18 || age > 120) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [HEARING_FK_AGE]: { value: age, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

function resolveHearingAffectedEar(
  _obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const norm = text.trim().toLowerCase();
  let ear: "left" | "right" | undefined;
  if (/\bleft\b/.test(norm)) ear = "left";
  else if (/\bright\b/.test(norm)) ear = "right";
  if (!ear) return { resolved: false };
  return {
    resolved: true,
    factsPatch: {
      [HEARING_FK_AFFECTED_EARS]: { value: ear, sourceText: text, confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
    },
  };
}

// ── Renal eGFR disambiguation (policy fix §4) ─────────────────────────────────

function resolveEgfrDisambiguation(
  obs: PendingObservation,
  text: string
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const normalized = text.trim().toLowerCase();
  const isCockcroftGault = /cockcroft|gault|creatinine\s+clearance|crcl/i.test(normalized)
    || normalized.includes("accept as creatinine clearance")
    || normalized.includes("cockcroft-gault");
  const isDecline = /ckd[-\s]epi|mdrd|decline|cannot use|ckd epi/i.test(normalized)
    || normalized.includes("cannot use");

  if (!isCockcroftGault && !isDecline) return { resolved: false };

  if (isDecline) {
    // Return empty patch — observation is dismissed without adding data
    return { resolved: true, factsPatch: {} };
  }

  // Accept as creatinine clearance
  const parsed = obs.parsed as { egfrValue?: number };
  if (parsed.egfrValue === undefined) return { resolved: false };

  const factsPatch: V2SystemFacts = {
    [RENAL_FK_CREATININE_CLEARANCE]: {
      value: parsed.egfrValue,
      sourceText: text,
      confidence: 0.8,
      extractionMethod: "user_selected",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
  return { resolved: true, factsPatch };
}

/**
 * Generic resolver driven by `obs.expectedAnswer` (Issue #12, RC-5/RC-6).
 *
 * When an observation declares its expected answer shape — enum / number /
 * boolean / text — the doctor's reply is graduated into the named fact
 * without a system-specific code path. This unblocks respiratory FVC/FEV1
 * numerics, respiratory asthma prereq confirmations, renal sex, and spine
 * diagnosis category, which previously had no resolver and stalled the
 * conversation.
 */
function resolveByExpectedAnswer(
  obs: PendingObservation,
  text: string,
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const ea = obs.expectedAnswer;
  if (!ea) return { resolved: false };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { resolved: false };

  const buildFact = (value: unknown) => ({
    [ea.factKey]: {
      value,
      sourceText: text,
      confidence: 0.9,
      extractionMethod: "user_selected" as const,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  });

  switch (ea.kind) {
    case "enum": {
      const norm = trimmed.toLowerCase();
      const match = ea.choices.find(
        (c) => c.toLowerCase() === norm || norm.includes(c.toLowerCase()),
      );
      if (!match) return { resolved: false };
      return { resolved: true, factsPatch: buildFact(match) };
    }
    case "number": {
      // Accept "45", "45%", "45 dB", "45.5 cm" etc. — first number token wins.
      const m = trimmed.match(/-?\d+(?:\.\d+)?/);
      if (!m) return { resolved: false };
      const n = Number(m[0]);
      if (!Number.isFinite(n)) return { resolved: false };
      if (typeof ea.min === "number" && n < ea.min) return { resolved: false };
      if (typeof ea.max === "number" && n > ea.max) return { resolved: false };
      return { resolved: true, factsPatch: buildFact(n) };
    }
    case "boolean": {
      const norm = trimmed.toLowerCase();
      if (/^(yes|y|true|confirm|confirmed|ok|okay)$/.test(norm)) {
        return { resolved: true, factsPatch: buildFact(true) };
      }
      if (/^(no|n|false|deny|denied|skip|reject)$/.test(norm)) {
        return { resolved: true, factsPatch: buildFact(false) };
      }
      return { resolved: false };
    }
    case "text": {
      return { resolved: true, factsPatch: buildFact(trimmed) };
    }
  }
}

// ── CNS bracket pending obs resolvers ────────────────────────────────────────

const CNS_BRACKET_SUBTYPE_MAP: Record<string, { factKey: string; brackets: SeverityBracket[] }> = {
  cns_g1a_bracket: { factKey: CNS_FK_G1A, brackets: GROUP1_SUBCATEGORIES[0].brackets as unknown as SeverityBracket[] },
  cns_g1b_bracket: { factKey: CNS_FK_G1B, brackets: GROUP1_SUBCATEGORIES[1].brackets as unknown as SeverityBracket[] },
  cns_g1c_bracket: { factKey: CNS_FK_G1C, brackets: GROUP1_SUBCATEGORIES[2].brackets as unknown as SeverityBracket[] },
  cns_g2_bracket:  { factKey: CNS_FK_G2,  brackets: GROUP2_BRACKETS },
  cns_g3_bracket:  { factKey: CNS_FK_G3,  brackets: GROUP3_BRACKETS },
  cns_g4_bracket:  { factKey: CNS_FK_G4,  brackets: GROUP4_BRACKETS },
  cns_b_olfaction_bracket:    { factKey: CNS_FK_B_OLFACTION,    brackets: OLFACTION_BRACKETS    },
  cns_b_facial_bracket:       { factKey: CNS_FK_B_FACIAL,       brackets: FACIAL_NERVE_BRACKETS },
  cns_b_equilibrium_bracket:  { factKey: CNS_FK_B_EQUILIBRIUM,  brackets: EQUILIBRIUM_BRACKETS  },
  cns_b_swallowing_bracket:   { factKey: CNS_FK_B_SWALLOWING,   brackets: SWALLOWING_BRACKETS   },
  cns_b_station_gait_bracket: { factKey: CNS_FK_B_STATION_GAIT, brackets: STATION_GAIT_BRACKETS },
  cns_b_respiration_bracket:  { factKey: CNS_FK_B_RESPIRATION,  brackets: RESPIRATION_BRACKETS  },
};

// Chip arrays for limb ID resolution
const LIMB_LABEL_TO_ID = new Map(PARALYSED_LIMB_OPTIONS.map((o) => [o.label.toLowerCase(), o.id]));

function resolveCnsPendingObs(
  obs: PendingObservation,
  text: string,
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const subtype = (obs.parsed as Record<string, unknown>).subtype as string | undefined;
  if (!subtype) return { resolved: false };

  // Bracket selection
  const bracketDef = CNS_BRACKET_SUBTYPE_MAP[subtype];
  if (bracketDef) {
    const bracketId = bracketIdFromChip(text, bracketDef.brackets)
      ?? bracketIdFromChip(text.trim().toLowerCase(), bracketDef.brackets);
    if (!bracketId) return { resolved: false };
    return {
      resolved: true,
      factsPatch: { [bracketDef.factKey]: { value: bracketId, sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() } },
    };
  }

  // Section C limb pick
  if (subtype === "cns_c_limb_pick") {
    const norm = text.trim().toLowerCase();
    const limbId = LIMB_LABEL_TO_ID.get(norm)
      ?? PARALYSED_LIMB_OPTIONS.find((o) => norm.includes(o.label.toLowerCase().slice(0, 10)))?.id;
    if (!limbId) return { resolved: false };
    return {
      resolved: true,
      factsPatch: {
        [CNS_FK_C_LIMBS]: { value: [limbId], sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() },
      },
    };
  }

  // Spine-complication clarify — "Yes, this is spine" → we can't reroute here,
  // just dismiss the observation so CNS doesn't block. The spine extractor will
  // pick it up on the next turn when the doctor routes to spine.
  if (subtype === "cns_spine_complication_clarify") {
    return { resolved: true, factsPatch: {} };
  }

  return { resolved: false };
}

// ── Visual pending obs resolvers ──────────────────────────────────────────────

function resolveVisualPendingObs(
  obs: PendingObservation,
  text: string,
): { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } {
  const subtype = (obs.parsed as Record<string, unknown>).subtype as string | undefined;
  if (!subtype) return { resolved: false };

  // Diplopia zone selection
  if (subtype === "visual_diplopia_zone") {
    const dipId = diplopiaIdFromChip(text) ?? diplopiaIdFromChip(text.trim().toLowerCase());
    if (!dipId) return { resolved: false };
    return {
      resolved: true,
      factsPatch: { [VISUAL_FK_DIPLOPIA]: { value: dipId, sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() } },
    };
  }

  // Acuity eye-side pick: which eye has acuityId stored in obs.parsed?
  if (subtype === "visual_acuity_eye_pick") {
    const acuityId = (obs.parsed as Record<string, unknown>).acuityId as string | undefined;
    if (!acuityId) return { resolved: false };
    const norm = text.trim().toLowerCase();
    const isRight = /right/.test(norm);
    const isLeft  = /left/.test(norm);
    const isBoth  = /both/.test(norm);
    if (!isRight && !isLeft && !isBoth) return { resolved: false };

    const factsPatch: V2SystemFacts = {};
    const makeF = (v: string) => ({ value: v, sourceText: text, confidence: 1.0, extractionMethod: "user_selected" as const, createdAt: nowIso(), updatedAt: nowIso() });
    if (isRight || isBoth) factsPatch[VISUAL_FK_RIGHT_ACUITY] = makeF(acuityId);
    if (isLeft  || isBoth) factsPatch[VISUAL_FK_LEFT_ACUITY]  = makeF(acuityId);
    return { resolved: true, factsPatch };
  }

  // Acuity chip-pick for a named eye (e.g. right eye acuity clarification)
  if (subtype === "visual_right_acuity_pick") {
    const id = acuityIdFromChip(text);
    if (!id) return { resolved: false };
    return { resolved: true, factsPatch: { [VISUAL_FK_RIGHT_ACUITY]: { value: id, sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() } } };
  }
  if (subtype === "visual_left_acuity_pick") {
    const id = acuityIdFromChip(text);
    if (!id) return { resolved: false };
    return { resolved: true, factsPatch: { [VISUAL_FK_LEFT_ACUITY]: { value: id, sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() } } };
  }

  // Field chip-pick for a named eye
  if (subtype === "visual_right_field_pick") {
    const id = fieldIdFromChip(text);
    if (!id) return { resolved: false };
    return { resolved: true, factsPatch: { [VISUAL_FK_RIGHT_FIELD]: { value: id, sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() } } };
  }
  if (subtype === "visual_left_field_pick") {
    const id = fieldIdFromChip(text);
    if (!id) return { resolved: false };
    return { resolved: true, factsPatch: { [VISUAL_FK_LEFT_FIELD]: { value: id, sourceText: text, confidence: 1.0, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() } } };
  }

  return { resolved: false };
}

// ── Unused parameter suppression (LIMB_CHIPS chip arrays imported but
//    currently only used for display — suppress TS warning) ─────────────────
void [G1A_CHIPS, G1B_CHIPS, G1C_CHIPS, G2_CHIPS, G3_CHIPS, G4_CHIPS,
      B_OLFACTION_CHIPS, B_FACIAL_CHIPS, B_EQUILIBRIUM_CHIPS,
      B_SWALLOWING_CHIPS, B_STATION_GAIT_CHIPS, B_RESPIRATION_CHIPS, LIMB_CHIPS];

/**
 * Try to resolve the oldest pending observation using the current utterance.
 * For sprint 1 handles: rom_measurement, nerve_deficit, other (rom_from_nerve).
 * For sprint 3 adds: severity_bracket (spine), other/spine_region.
 * For sprint 4 adds: other/egfr_disambiguation (renal policy fix §4).
 * For sprint 5 adds: hearing_value (hearing path/ahl/age/affected_ear), other/gastro_* subtypes.
 * REQ-A1/A4 adds: other/cns_* bracket subtypes, visual_value/visual_* subtypes.
 * Issue #12 / Phase E: a generic `expectedAnswer`-driven resolver runs first
 * for any observation that declares one.
 */
export function tryResolvePendingObservation(
  state: V2SessionState,
  system: GatiodSystemKey,
  utterance: NormalizedUtterance
): PendingObservationResolutionResult {
  const systemState = state.systems[system];
  if (systemState.pendingObservations.length === 0) {
    return { resolved: false, blocked: false, state };
  }

  const obs = systemState.pendingObservations[0];
  const text = utterance.normalizedText;
  let resolution: { resolved: true; factsPatch: V2SystemFacts } | { resolved: false } =
    resolveByExpectedAnswer(obs, text);

  // Fall through to system-specific handlers only when the generic
  // expectedAnswer-based resolution did not match.
  if (!resolution.resolved && obs.type === "rom_measurement") {
    resolution = resolveRomMeasurement(obs, text);
  } else if (!resolution.resolved && obs.type === "nerve_deficit") {
    resolution = resolveNerveDeficit(obs, text);
  } else if (!resolution.resolved && obs.type === "severity_bracket") {
    resolution = resolveSpineSeverity(obs, text, state, system);
  } else if (!resolution.resolved && obs.type === "hearing_value") {
    const subtype = (obs.parsed as Record<string, unknown>).subtype as string | undefined;
    if (subtype === "hearing_path") {
      resolution = resolveHearingPath(obs, text);
    } else if (subtype === "hearing_ahl") {
      resolution = resolveHearingAhl(obs, text);
    } else if (subtype === "hearing_age") {
      resolution = resolveHearingAge(obs, text);
    } else if (subtype === "hearing_affected_ear") {
      resolution = resolveHearingAffectedEar(obs, text);
    }
  } else if (!resolution.resolved && obs.type === "visual_value") {
    resolution = resolveVisualPendingObs(obs, text);
  } else if (!resolution.resolved && obs.type === "other") {
    const subtype = (obs.parsed as Record<string, unknown>).subtype as string | undefined;
    if (subtype?.startsWith("cns_")) {
      resolution = resolveCnsPendingObs(obs, text);
    } else if (subtype === "spine_region") {
      resolution = resolveSpineRegion(obs, text);
    } else if (subtype === "egfr_disambiguation") {
      resolution = resolveEgfrDisambiguation(obs, text);
    } else if (subtype === "gastro_subsystem") {
      resolution = resolveGastroSubsystem(obs, text);
    } else if (subtype === "gastro_colonal_subpath") {
      resolution = resolveGastroColonalSubpath(obs, text);
    } else if (subtype === "gastro_liver_biliary_subpath") {
      resolution = resolveGastroLiverBiliarySubpath(obs, text);
    } else if (subtype === "gastro_bracket") {
      resolution = resolveGastroBracket(obs, text, state, system);
    } else if (subtype === "gastro_pi_percent") {
      resolution = resolveGastroPiPercent(obs, text);
    } else {
      resolution = resolveRomFromNerve(obs, text);
    }
  }

  if (!resolution.resolved) {
    return {
      resolved: false,
      blocked: true,
      state,
      system,
      observationId: obs.id,
      clarificationQuestion: obs.clarificationQuestion,
      candidateAnswers: obs.candidateAnswers,
      auditEvent: { type: "pending_observation_unresolved", observationId: obs.id, reply: text },
    };
  }

  const nextState = graduateObservation(state, system, obs.id, resolution.factsPatch);
  return {
    resolved: true,
    blocked: false,
    state: nextState,
    system,
    observationId: obs.id,
    auditEvent: {
      type: "pending_observation_resolved",
      observationId: obs.id,
      factKeys: Object.keys(resolution.factsPatch),
    },
  };
}
