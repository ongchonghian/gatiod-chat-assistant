import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import { hearingValueSchema, type HearingValue } from "../../engine/hearingData.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
  HEARING_FK_OCCUPATIONAL_YEARS,
} from "../extractors/hearing.js";

export function buildHearingArgs(facts: V2SystemFacts): BuildResult<HearingValue> {
  const path = facts[HEARING_FK_PATH]?.value as "nid" | "injury" | undefined;
  if (!path) {
    return { ok: false, warnings: ["Hearing path (NID or injury) is required."], zodErrors: ["path: required"] };
  }

  const userSupplied: string[] = [HEARING_FK_PATH];
  const builderZeroFilled: string[] = [];

  let args: unknown;

  if (path === "nid") {
    if (!facts[HEARING_FK_LEFT_EAR_AHL] || !facts[HEARING_FK_RIGHT_EAR_AHL]) {
      return { ok: false, warnings: ["Both left and right ear AHL values are required for NID."], zodErrors: ["leftEarAhl: required", "rightEarAhl: required"] };
    }
    if (!facts[HEARING_FK_AGE]) {
      return { ok: false, warnings: ["Patient age is required for NID (presbycusis deduction)."], zodErrors: ["age: required"] };
    }

    userSupplied.push(HEARING_FK_LEFT_EAR_AHL, HEARING_FK_RIGHT_EAR_AHL, HEARING_FK_AGE);
    const occYears = facts[HEARING_FK_OCCUPATIONAL_YEARS];
    if (occYears) userSupplied.push(HEARING_FK_OCCUPATIONAL_YEARS);
    else builderZeroFilled.push(HEARING_FK_OCCUPATIONAL_YEARS);

    args = {
      path: "nid",
      leftEarAhl:  facts[HEARING_FK_LEFT_EAR_AHL].value as number,
      rightEarAhl: facts[HEARING_FK_RIGHT_EAR_AHL].value as number,
      age:         facts[HEARING_FK_AGE].value as number,
      ...(occYears ? { occupationalExposureYears: occYears.value as number } : {}),
    };
  } else {
    const affectedEar = facts[HEARING_FK_AFFECTED_EARS]?.value as "left" | "right" | undefined;
    if (!affectedEar) {
      return { ok: false, warnings: ["Affected ear is required for injury path."], zodErrors: ["affectedEars: required"] };
    }
    userSupplied.push(HEARING_FK_AFFECTED_EARS);

    // Clinical validation: the affected ear's AHL is required — Zod marks both optional
    // but the engine returns 0% when the affected ear's AHL is absent (see calculateInjury).
    if (affectedEar === "right" && !facts[HEARING_FK_RIGHT_EAR_AHL]) {
      return {
        ok: false,
        warnings: ["Right ear AHL is required for right-ear injury hearing assessment."],
        zodErrors: ["rightEarAhl: required for affected right ear"],
      };
    }
    if (affectedEar === "left" && !facts[HEARING_FK_LEFT_EAR_AHL]) {
      return {
        ok: false,
        warnings: ["Left ear AHL is required for left-ear injury hearing assessment."],
        zodErrors: ["leftEarAhl: required for affected left ear"],
      };
    }

    const leftAhl  = facts[HEARING_FK_LEFT_EAR_AHL];
    const rightAhl = facts[HEARING_FK_RIGHT_EAR_AHL];
    if (leftAhl)  userSupplied.push(HEARING_FK_LEFT_EAR_AHL);
    if (rightAhl) userSupplied.push(HEARING_FK_RIGHT_EAR_AHL);

    args = {
      path: "injury",
      affectedEars: affectedEar,
      ...(leftAhl  ? { leftEarAhl:  leftAhl.value  as number } : {}),
      ...(rightAhl ? { rightEarAhl: rightAhl.value as number } : {}),
    };
  }

  const parsed = hearingValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_hearing",
    args: parsed.data,
    warnings: [],
    provenance: { userSupplied, builderZeroFilled, factsHash: hashExtractedFacts(facts) },
  };
}
