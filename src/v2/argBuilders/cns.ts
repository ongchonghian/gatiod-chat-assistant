import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import {
  cnsValueSchema,
  type CnsValue,
  type GroupSelection,
  GROUP1_SUBCATEGORIES,
  GROUP2_BRACKETS,
  GROUP3_BRACKETS,
  GROUP4_BRACKETS,
  OLFACTION_BRACKETS,
  FACIAL_NERVE_BRACKETS,
  EQUILIBRIUM_BRACKETS,
  SWALLOWING_BRACKETS,
  STATION_GAIT_BRACKETS,
  RESPIRATION_BRACKETS,
  PARALYSED_LIMB_OPTIONS,
  type SeverityBracket,
} from "../../engine/cnsAssessmentData.js";
import {
  CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
  CNS_FK_G2, CNS_FK_G2_NEURO,
  CNS_FK_G3,
  CNS_FK_G4, CNS_FK_G4_PSYCH,
  CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL,
  CNS_FK_B_EQUILIBRIUM, CNS_FK_B_EQUILIBRIUM_ENT,
  CNS_FK_B_SWALLOWING, CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  CNS_FK_C_LIMBS,
} from "../extractors/cns.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve a bracketId string to a GroupSelection.
// For range brackets (min < max), uses bracket.min (conservative default).
function toGroupSelection(bracketId: string | undefined, brackets: SeverityBracket[]): GroupSelection {
  if (!bracketId) return { bracketId: "", value: 0 };
  const b = brackets.find((x) => x.id === bracketId);
  if (!b) return { bracketId: "", value: 0 };
  return { bracketId: b.id, value: b.min };
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildCnsArgs(facts: V2SystemFacts): BuildResult<CnsValue> {
  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  function read(key: string): string | undefined {
    if (facts[key] !== undefined) {
      userSupplied.push(key);
      return facts[key].value as string;
    }
    builderZeroFilled.push(key);
    return undefined;
  }

  function readBool(key: string, defaultVal: boolean): boolean {
    if (facts[key] !== undefined) {
      userSupplied.push(key);
      return Boolean(facts[key].value);
    }
    builderZeroFilled.push(key);
    return defaultVal;
  }

  // Section A brackets
  const g1aBrackets = GROUP1_SUBCATEGORIES[0].brackets as unknown as SeverityBracket[];
  const g1bBrackets = GROUP1_SUBCATEGORIES[1].brackets as unknown as SeverityBracket[];
  const g1cBrackets = GROUP1_SUBCATEGORIES[2].brackets as unknown as SeverityBracket[];

  const group1Consciousness = toGroupSelection(read(CNS_FK_G1A), g1aBrackets);
  const group1Episodic      = toGroupSelection(read(CNS_FK_G1B), g1bBrackets);
  const group1Arousal       = toGroupSelection(read(CNS_FK_G1C), g1cBrackets);
  const group2              = toGroupSelection(read(CNS_FK_G2),  GROUP2_BRACKETS);
  const group2NeuropsychologistConfirmed = readBool(CNS_FK_G2_NEURO, false);
  const group3              = toGroupSelection(read(CNS_FK_G3),  GROUP3_BRACKETS);
  const group4              = toGroupSelection(read(CNS_FK_G4),  GROUP4_BRACKETS);
  const group4PsychiatristConfirmed      = readBool(CNS_FK_G4_PSYCH, false);

  // Section B brackets
  const olfaction    = toGroupSelection(read(CNS_FK_B_OLFACTION),    OLFACTION_BRACKETS);
  const facialNerve  = toGroupSelection(read(CNS_FK_B_FACIAL),       FACIAL_NERVE_BRACKETS);
  const equilibrium  = toGroupSelection(read(CNS_FK_B_EQUILIBRIUM),  EQUILIBRIUM_BRACKETS);
  const equilibriumEntConfirmed = readBool(CNS_FK_B_EQUILIBRIUM_ENT, false);
  const swallowing   = toGroupSelection(read(CNS_FK_B_SWALLOWING),   SWALLOWING_BRACKETS);
  const stationGait  = toGroupSelection(read(CNS_FK_B_STATION_GAIT), STATION_GAIT_BRACKETS);
  const respiration  = toGroupSelection(read(CNS_FK_B_RESPIRATION),  RESPIRATION_BRACKETS);

  // Section C paralysed limbs
  let paralysedLimbs: string[] = [];
  if (facts[CNS_FK_C_LIMBS]) {
    userSupplied.push(CNS_FK_C_LIMBS);
    paralysedLimbs = facts[CNS_FK_C_LIMBS].value as string[];
  } else {
    builderZeroFilled.push(CNS_FK_C_LIMBS);
  }

  // Validate limb IDs against PARALYSED_LIMB_OPTIONS
  const validLimbIds = new Set(PARALYSED_LIMB_OPTIONS.map((o) => o.id));
  const invalidLimbs = paralysedLimbs.filter((id) => !validLimbIds.has(id));
  if (invalidLimbs.length > 0) {
    return {
      ok: false,
      warnings: [`Invalid paralysed limb IDs: ${invalidLimbs.join(", ")}`],
      zodErrors: invalidLimbs.map((id) => `paralysedLimbs: "${id}" is not a valid limb option`),
    };
  }

  const args: CnsValue = {
    group1Consciousness,
    group1Episodic,
    group1Arousal,
    group2,
    group2NeuropsychologistConfirmed,
    group3,
    group4,
    group4PsychiatristConfirmed,
    olfaction,
    facialNerve,
    equilibrium,
    equilibriumEntConfirmed,
    swallowing,
    stationGait,
    respiration,
    paralysedLimbs,
  };

  const parsed = cnsValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_cns",
    args: args as CnsValue,
    warnings: [],
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
