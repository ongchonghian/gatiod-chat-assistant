import { z } from "zod";
import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import { getActiveBrackets, type GastroDigestiveValue } from "../../engine/gastroDigestiveData.js";
import {
  GASTRO_FK_SUBSYSTEM,
  GASTRO_FK_COLONAL_SUBPATH,
  GASTRO_FK_LIVER_BILIARY_SUBPATH,
  GASTRO_FK_BRACKET_INDEX,
  GASTRO_FK_WEIGHT_LOSS,
  GASTRO_FK_PI_PERCENT,
  GASTRO_FK_CLINICAL_JUSTIFICATION,
} from "../extractors/gastro.js";

// ── Inline Zod schema ─────────────────────────────────────────────────────────

const GastroValueSchema = z.object({
  subSystem: z.enum(["upperDigestive", "colonicRectalAnal", "liverBiliary", "herniation"]),
  colonalSubPath: z.enum(["colonicRectal", "anal"]).optional(),
  liverBiliarySubPath: z.enum(["liver", "biliary"]).optional(),
  selectedBracketIndex: z.number().int().min(0).max(3),
  piPercent: z.number().min(0).max(100),
  weightLossPercent: z.number().min(0).max(100).optional(),
  clinicalJustification: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.subSystem === "colonicRectalAnal" && !val.colonalSubPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "colonalSubPath required for colonicRectalAnal", path: ["colonalSubPath"] });
  }
  if (val.subSystem === "liverBiliary" && !val.liverBiliarySubPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "liverBiliarySubPath required for liverBiliary", path: ["liverBiliarySubPath"] });
  }
  // Validate bracket index against active brackets
  const brackets = getActiveBrackets(val as GastroDigestiveValue);
  if (val.selectedBracketIndex >= brackets.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `bracket index ${val.selectedBracketIndex} out of range (max ${brackets.length - 1})`, path: ["selectedBracketIndex"] });
    return;
  }
  // Validate piPercent within bracket range
  const bracket = brackets[val.selectedBracketIndex];
  if (bracket && (val.piPercent < bracket.min || val.piPercent > bracket.max)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `piPercent ${val.piPercent}% out of range for ${bracket.label} (${bracket.min}–${bracket.max}%)`, path: ["piPercent"] });
  }
});

export type GastroValue = z.infer<typeof GastroValueSchema>;

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildGastroArgs(facts: V2SystemFacts): BuildResult<GastroValue> {
  if (!facts[GASTRO_FK_SUBSYSTEM]) {
    return { ok: false, warnings: ["Gastro subsystem is required."], zodErrors: ["subSystem: required"] };
  }
  if (facts[GASTRO_FK_BRACKET_INDEX] === undefined) {
    return { ok: false, warnings: ["Severity bracket index is required."], zodErrors: ["selectedBracketIndex: required"] };
  }
  if (facts[GASTRO_FK_PI_PERCENT] === undefined) {
    return { ok: false, warnings: ["PI% is required."], zodErrors: ["piPercent: required"] };
  }

  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  function read<T>(key: string, fallback: T): T {
    if (facts[key] !== undefined) { userSupplied.push(key); return facts[key].value as T; }
    builderZeroFilled.push(key);
    return fallback;
  }

  const args = {
    subSystem:            read<GastroValue["subSystem"]>(GASTRO_FK_SUBSYSTEM, "upperDigestive"),
    colonalSubPath:       facts[GASTRO_FK_COLONAL_SUBPATH] ? (userSupplied.push(GASTRO_FK_COLONAL_SUBPATH), facts[GASTRO_FK_COLONAL_SUBPATH].value as GastroValue["colonalSubPath"]) : undefined,
    liverBiliarySubPath:  facts[GASTRO_FK_LIVER_BILIARY_SUBPATH] ? (userSupplied.push(GASTRO_FK_LIVER_BILIARY_SUBPATH), facts[GASTRO_FK_LIVER_BILIARY_SUBPATH].value as GastroValue["liverBiliarySubPath"]) : undefined,
    selectedBracketIndex: read<number>(GASTRO_FK_BRACKET_INDEX, 0),
    piPercent:            read<number>(GASTRO_FK_PI_PERCENT, 0),
    weightLossPercent:    facts[GASTRO_FK_WEIGHT_LOSS] ? (userSupplied.push(GASTRO_FK_WEIGHT_LOSS), facts[GASTRO_FK_WEIGHT_LOSS].value as number) : undefined,
    clinicalJustification: facts[GASTRO_FK_CLINICAL_JUSTIFICATION] ? (userSupplied.push(GASTRO_FK_CLINICAL_JUSTIFICATION), facts[GASTRO_FK_CLINICAL_JUSTIFICATION].value as string) : undefined,
  };

  const parsed = GastroValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_gastro_digestive",
    args: parsed.data,
    warnings: [],
    provenance: { userSupplied, builderZeroFilled, factsHash: hashExtractedFacts(facts) },
  };
}
