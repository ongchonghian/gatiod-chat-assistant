import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import { RenalValueSchema, type RenalValue } from "../../engine/renalData.js";
import {
  RENAL_FK_SEX,
  RENAL_FK_SERUM_CREATININE,
  RENAL_FK_CREATININE_CLEARANCE,
  RENAL_FK_CKD_STAGE,
  RENAL_FK_CLINICAL_SEVERITY,
  RENAL_FK_SOLITARY_KIDNEY,
  RENAL_FK_PROVISIONAL_AWARD,
} from "../extractors/renal.js";

export function buildRenalArgs(facts: V2SystemFacts): BuildResult<RenalValue> {
  if (!facts[RENAL_FK_SEX]) {
    return {
      ok: false,
      warnings: ["Patient sex is required for renal assessment."],
      zodErrors: ["sex: required"],
    };
  }

  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  function read<T>(key: string, fallback: T): T {
    if (facts[key] !== undefined) {
      userSupplied.push(key);
      return facts[key].value as T;
    }
    builderZeroFilled.push(key);
    return fallback;
  }

  const args: RenalValue = {
    sex:                  read<RenalValue["sex"]>(RENAL_FK_SEX, "male"),
    serumCreatinine:      read<number | null>(RENAL_FK_SERUM_CREATININE, null),
    creatinineClearance:  read<number | null>(RENAL_FK_CREATININE_CLEARANCE, null),
    ckdStage:             read<RenalValue["ckdStage"]>(RENAL_FK_CKD_STAGE, null),
    clinicalSeverity:     read<RenalValue["clinicalSeverity"]>(RENAL_FK_CLINICAL_SEVERITY, null),
    solitaryKidney:       read<boolean>(RENAL_FK_SOLITARY_KIDNEY, false),
    provisionalAward:     read<boolean>(RENAL_FK_PROVISIONAL_AWARD, true),
    selectedPi:           null,
  };

  const parsed = RenalValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_renal",
    args: parsed.data,
    warnings: [],
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
