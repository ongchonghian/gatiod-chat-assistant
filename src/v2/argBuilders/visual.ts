import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import { visualValueSchema, type VisualValue } from "../../engine/visualAssessmentData.js";
import {
  VISUAL_FK_LEFT_ACUITY,
  VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD,
  VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_LEFT_MODIFIERS,
  VISUAL_FK_RIGHT_MODIFIERS,
  VISUAL_FK_LEFT_CONDITIONS,
  VISUAL_FK_RIGHT_CONDITIONS,
  VISUAL_FK_DIPLOPIA,
  VISUAL_FK_LEFT_ENUCLEATED,
  VISUAL_FK_RIGHT_ENUCLEATED,
} from "../extractors/visual.js";

export function buildVisualArgs(facts: V2SystemFacts): BuildResult<VisualValue> {
  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  function readString(key: string, defaultVal: string): string {
    if (facts[key] !== undefined) { userSupplied.push(key); return facts[key].value as string; }
    builderZeroFilled.push(key);
    return defaultVal;
  }

  function readStringArray(key: string): string[] {
    if (facts[key] !== undefined) { userSupplied.push(key); return facts[key].value as string[]; }
    builderZeroFilled.push(key);
    return [];
  }

  function readBool(key: string): boolean {
    if (facts[key] !== undefined) { userSupplied.push(key); return Boolean(facts[key].value); }
    builderZeroFilled.push(key);
    return false;
  }

  const leftEnucleated  = readBool(VISUAL_FK_LEFT_ENUCLEATED);
  const rightEnucleated = readBool(VISUAL_FK_RIGHT_ENUCLEATED);

  // Enucleation forces worst-case acuity and field; overrides any separately
  // stored values so the engine correctly scores 50% monocular.
  const leftAcuity  = leftEnucleated  ? "lt_6_60"    : readString(VISUAL_FK_LEFT_ACUITY,  "");
  const rightAcuity = rightEnucleated ? "lt_6_60"    : readString(VISUAL_FK_RIGHT_ACUITY, "");
  const leftField   = leftEnucleated  ? "field_lt20" : readString(VISUAL_FK_LEFT_FIELD,   "");
  const rightField  = rightEnucleated ? "field_lt20" : readString(VISUAL_FK_RIGHT_FIELD,  "");

  const leftModifiers   = leftEnucleated  ? [] : readStringArray(VISUAL_FK_LEFT_MODIFIERS);
  const rightModifiers  = rightEnucleated ? [] : readStringArray(VISUAL_FK_RIGHT_MODIFIERS);
  const leftConditions  = leftEnucleated  ? [] : readStringArray(VISUAL_FK_LEFT_CONDITIONS);
  const rightConditions = rightEnucleated ? [] : readStringArray(VISUAL_FK_RIGHT_CONDITIONS);

  // Default diplopia to "dip_none" (0%) when not supplied — binocular diplopia
  // is an additive entry and should only be scored when explicitly provided.
  const diplopiaId = readString(VISUAL_FK_DIPLOPIA, "dip_none");

  const args: VisualValue = {
    leftEye: {
      acuityId: leftAcuity,
      fieldId: leftField,
      functionalModifiers: leftModifiers,
      specificConditions: leftConditions,
    },
    rightEye: {
      acuityId: rightAcuity,
      fieldId: rightField,
      functionalModifiers: rightModifiers,
      specificConditions: rightConditions,
    },
    diplopiaId,
  };

  const parsed = visualValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_visual",
    args,
    warnings: [],
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
