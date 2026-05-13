import { z } from "zod";
import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import { SP_FK_REGION, SP_FK_ENTRIES, type SpineCategoryEntryFact } from "../extractors/spine.js";
import {
  getSeveritiesForCategory,
  isSeverityAvailableForRegion,
  type SpinalRegion,
  type DiagnosisCategory,
  type SeverityKey,
} from "../../engine/spineAssessmentData.js";

// ── Inline Zod schema (no engine-level schema for spine tool args) ────────────

const SpineEntrySchema = z.object({
  diagnosisCategory: z.enum([
    "fractures_dislocations",
    "spinal_cord_injury",
    "intervertebral_disc",
    "spondylolysis_spondylolisthesis",
    "chronic_pain_normal_mri",
  ]),
  severityKey: z.string().min(1, "severityKey is required"),
  monoparesisHalving: z.boolean(),
  bladderBowelSeverity: z.enum([
    "none",
    "incomplete_single",
    "incomplete_both",
    "complete_single",
    "complete_both",
  ]),
  discCordInvolvement: z.boolean(),
  spondylolysisPathway: z.enum(["acute_traumatic", "pre_existing_superimposed"]),
});

const SpineValueSchema = z.object({
  region: z.enum(["cervical", "thoraco_lumbar", "lumbo_sacral"]),
  categoryEntries: z.array(SpineEntrySchema).min(1, "At least one category entry is required"),
});

export type SpineValue = z.infer<typeof SpineValueSchema>;

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildSpineArgs(facts: V2SystemFacts): BuildResult<SpineValue> {
  const warnings: string[] = [];
  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  // ── Region (required) ─────────────────────────────────────────────────────
  if (!facts[SP_FK_REGION]) {
    return {
      ok: false,
      warnings: ["Spinal region is required and was not supplied."],
      zodErrors: ["region: required"],
    };
  }
  const region = facts[SP_FK_REGION].value as SpinalRegion;
  userSupplied.push("spine_region");

  // ── Category entries (required) ───────────────────────────────────────────
  const rawEntries = (facts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];
  if (rawEntries.length === 0) {
    return {
      ok: false,
      warnings: ["At least one spine diagnosis category entry is required."],
      zodErrors: ["categoryEntries: min 1"],
    };
  }
  userSupplied.push("spine_entries");

  // ── Per-entry cross-validation ────────────────────────────────────────────
  const zodErrors: string[] = [];
  for (const entry of rawEntries) {
    if (!entry.severityKey) {
      zodErrors.push(`${entry.diagnosisCategory}: severityKey is required`);
      continue;
    }
    const allowedSeverities = getSeveritiesForCategory(entry.diagnosisCategory, {
      spondylolysisPathway: entry.spondylolysisPathway,
    }).map((s) => s.key);

    if (!allowedSeverities.includes(entry.severityKey as SeverityKey)) {
      zodErrors.push(`${entry.diagnosisCategory}: severityKey "${entry.severityKey}" is not valid for this category/pathway`);
    } else if (!isSeverityAvailableForRegion(entry.severityKey as SeverityKey, region)) {
      zodErrors.push(`${entry.diagnosisCategory}: severityKey "${entry.severityKey}" is not available for region "${region}"`);
    }
  }
  if (zodErrors.length > 0) {
    return { ok: false, warnings: ["Spine entry validation failed."], zodErrors };
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  const categoryEntries = rawEntries.map((e) => ({
    diagnosisCategory: e.diagnosisCategory as DiagnosisCategory,
    severityKey: e.severityKey,
    monoparesisHalving: e.monoparesisHalving,
    bladderBowelSeverity: e.bladderBowelSeverity,
    discCordInvolvement: e.discCordInvolvement,
    spondylolysisPathway: e.spondylolysisPathway,
  }));

  const args = { region, categoryEntries };

  const parsed = SpineValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_spine",
    args: parsed.data as SpineValue,
    warnings,
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
