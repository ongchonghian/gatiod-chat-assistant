// Zod schemas for the semantic interpreter output (REQ-SC-OUTPUT-001).
//
// `SemanticInterpretationSchema` is the authoritative shape of the model's
// JSON response. The hardening rules from ADR-0003 are enforced here:
//
//   - `additionalProperties: false` on every object (`.strict()` in Zod 3)
//   - `calculationReady` is `z.literal(false)` — the interpreter cannot mark
//     any finding as calculation-ready
//   - `requiresUserConsensus` is `z.literal(true)` — the interpreter cannot
//     bypass consensus
//   - `candidateSystems[].system` and `candidateFindings[].system` are the
//     `GatiodSystemKey` enum
//   - `findingType` and `completeness` use the fixed enums from contracts.ts
//
// Source-span verification (every `sourceSpan` must trace back to the
// original utterance) is NOT a Zod-level check — it is enforced by the
// safety validator in `semanticInterpreterValidator.ts` because it requires
// access to the source text.

import { z } from "zod";
import type {
  GatiodSystemKey,
  SemanticCandidateFinding,
  SemanticCandidateSystem,
  SemanticInterpretation,
} from "./contracts.js";

const GATIOD_SYSTEM_KEYS = [
  "upper_limb",
  "lower_limb",
  "spine",
  "respiratory",
  "renal",
  "gastro_digestive",
  "hearing",
  "cns",
  "visual",
] as const satisfies ReadonlyArray<GatiodSystemKey>;

const SystemKeySchema = z.enum(GATIOD_SYSTEM_KEYS);

const SemanticSystemStatusSchema = z.enum([
  "structured_supported",
  "structured_shadow",
  "legacy_deferred",
]);

const SemanticFindingTypeSchema = z.enum([
  "amputation",
  "rom",
  "neurological",
  "dbe",
  "spine_diagnosis",
  "hearing_loss",
  "respiratory_function",
  "renal_function",
  "gastro_subsystem",
  "cns_component",
  "visual_component",
  "other",
]);

const SemanticFindingCompletenessSchema = z.enum([
  "complete_for_extraction",
  "missing_calculation_fields",
  "unsupported",
]);

export const SemanticCandidateSystemSchema = z
  .object({
    system: SystemKeySchema,
    confidence: z.number().min(0).max(1),
    status: SemanticSystemStatusSchema,
    evidence: z.array(z.string()),
    rationale: z.string().min(1),
  })
  .strict() satisfies z.ZodType<SemanticCandidateSystem>;

export const SemanticCandidateFindingSchema = z
  .object({
    system: SystemKeySchema,
    sourceSpan: z.string().min(1),
    findingType: SemanticFindingTypeSchema,
    proposedMapping: z.string().min(1),
    systemConfidence: z.number().min(0).max(1),
    mappingConfidence: z.number().min(0).max(1),
    completeness: SemanticFindingCompletenessSchema,
    explicitlyStatedFields: z.array(z.string()),
    inferredFields: z.array(z.string()),
    missingFields: z.array(z.string()),
    calculationReady: z.literal(false),
  })
  .strict() satisfies z.ZodType<SemanticCandidateFinding>;

export const SemanticInterpretationSchema = z
  .object({
    id: z.string().min(1),
    sourceText: z.string().min(1),
    sourceHash: z.string().min(1),
    candidateSystems: z.array(SemanticCandidateSystemSchema),
    candidateFindings: z.array(SemanticCandidateFindingSchema),
    unsupportedTerms: z.array(z.string()),
    assumptions: z.array(z.string()),
    requiresUserConsensus: z.literal(true),
    createdAt: z.string().min(1),
  })
  .strict() satisfies z.ZodType<SemanticInterpretation>;

/** Safe-parse helper that returns the typed interpretation or a structured
 *  failure with the Zod issues serialised. */
export function parseSemanticInterpretation(
  raw: unknown,
):
  | { ok: true; interpretation: SemanticInterpretation }
  | { ok: false; issues: string[] } {
  const result = SemanticInterpretationSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, interpretation: result.data };
  }
  const issues = result.error.issues.map(
    (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
  );
  return { ok: false, issues };
}
