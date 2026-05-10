import type {
  AssessmentRenderResult,
  BuildResult,
  ExtractionContext,
  GatiodSystemKey,
  OntologyMatch,
  NormalizedUtterance,
  ReadinessResult,
  StructuredExtractionResult,
  V2AssessmentInstance,
  V2SystemFacts,
  V2SystemState,
} from "./contracts.js";
import { extractUpperLimb } from "./extractors/upperLimb.js";
import { validateUpperLimbReadiness } from "./readiness/upperLimb.js";
import { buildUpperLimbArgs } from "./argBuilders/upperLimb.js";
import { renderUpperLimbResult } from "./renderers/upperLimbResult.js";
import { extractLowerLimb } from "./extractors/lowerLimb.js";
import { validateLowerLimbReadiness } from "./readiness/lowerLimb.js";
import { buildLowerLimbArgs } from "./argBuilders/lowerLimb.js";
import { renderLowerLimbResult } from "./renderers/lowerLimbResult.js";
import { extractSpine } from "./extractors/spine.js";
import { validateSpineReadiness } from "./readiness/spine.js";
import { buildSpineArgs } from "./argBuilders/spine.js";
import { renderSpineResult } from "./renderers/spineResult.js";
import { extractRespiratory } from "./extractors/respiratory.js";
import { validateRespiratoryReadiness } from "./readiness/respiratory.js";
import { buildRespiratoryArgs } from "./argBuilders/respiratory.js";
import { renderRespiratoryResult } from "./renderers/respiratoryResult.js";
import { extractRenal } from "./extractors/renal.js";
import { validateRenalReadiness } from "./readiness/renal.js";
import { buildRenalArgs } from "./argBuilders/renal.js";
import { renderRenalResult } from "./renderers/renalResult.js";
import { extractGastro } from "./extractors/gastro.js";
import { validateGastroReadiness } from "./readiness/gastro.js";
import { buildGastroArgs } from "./argBuilders/gastro.js";
import { renderGastroResult } from "./renderers/gastroResult.js";
import { extractHearing } from "./extractors/hearing.js";
import { validateHearingReadiness, validateHearingInstanceReadiness } from "./readiness/hearing.js";
import { buildHearingArgs } from "./argBuilders/hearing.js";
import { renderHearingResult } from "./renderers/hearingResult.js";

export type SystemMigrationMode = "legacy" | "structured_shadow" | "structured_live";

/**
 * Deterministic extractor for one GATIOD system.
 *
 * The optional fourth parameter `extractionContext` carries accepted semantic
 * interpretation context (REQ-MS-EXTRACT-001). It is read-only and ephemeral;
 * it must NEVER be persisted into V2SystemState or treated as calculation-grade
 * fact. Extractors that don't need semantic hints can simply ignore it —
 * TypeScript permits a 3-parameter function to satisfy this 4-parameter type
 * because the extra parameter is optional.
 */
export type StructuredExtractor = (
  utterance: NormalizedUtterance,
  systemState: V2SystemState,
  ontologyMatches?: OntologyMatch[],
  extractionContext?: ExtractionContext,
) => StructuredExtractionResult;

export type ReadinessValidator = (systemState: V2SystemState) => ReadinessResult;

/** Instance-aware readiness validator. Validates a single assessment instance
 *  rather than the flat per-system state. Preferred when instances are present. */
export type InstanceAwareReadinessValidator = (instance: V2AssessmentInstance) => ReadinessResult;

export type ToolArgBuilder = (facts: V2SystemFacts) => BuildResult<unknown>;

export type ResultRenderer = (toolResult: unknown, systemState: V2SystemState) => AssessmentRenderResult;

export interface V2SystemCapability {
  system: GatiodSystemKey;
  mode: SystemMigrationMode;
  extractor?: StructuredExtractor;
  readinessValidator?: ReadinessValidator;
  /** Instance-aware readiness validator. Takes precedence over readinessValidator
   *  when instances exist for the system. */
  instanceReadinessValidator?: InstanceAwareReadinessValidator;
  argBuilder?: ToolArgBuilder;
  resultRenderer?: ResultRenderer;
}

export const V2_SYSTEM_REGISTRY: Record<GatiodSystemKey, V2SystemCapability> = {
  upper_limb: {
    system: "upper_limb",
    // ADR-0001 provisional live (slice 18 trial): the loose DIRECTION_RE
    // fallback added in slice-18 lets the extractor parse workbook ROM
    // phrasings like "active flexion from neutral / arc ... 140°".
    // Promoting trials whether the structured V2 path now produces
    // calculable facts in the calibration runner. Will be demoted if rate
    // doesn't improve.
    mode: "structured_live",
    extractor: extractUpperLimb as StructuredExtractor,
    readinessValidator: validateUpperLimbReadiness as ReadinessValidator,
    argBuilder: buildUpperLimbArgs as ToolArgBuilder,
    resultRenderer: renderUpperLimbResult as ResultRenderer,
  },
  lower_limb: {
    system: "lower_limb",
    // ADR-0001 provisional live (slice 18 trial): same justification as
    // upper_limb. Lower-limb extractor is broader and may benefit from
    // the same loose pattern in a follow-up slice.
    mode: "structured_live",
    extractor: extractLowerLimb as StructuredExtractor,
    readinessValidator: validateLowerLimbReadiness as ReadinessValidator,
    argBuilder: buildLowerLimbArgs as ToolArgBuilder,
    resultRenderer: renderLowerLimbResult as ResultRenderer,
  },
  spine: {
    system: "spine",
    // ADR-0001 provisional live (slice 16 evidence upgrade):
    // 96.7% safe-outcome AND 96.7% exact-calculation on 30-row sample
    // (29 of 30 exact rows produce the workbook PI%). Above the 95%/90%
    // gate. Remaining mismatch is the multi-region guard correctly
    // surfacing a side-less catalogue row.
    mode: "structured_live",
    extractor: extractSpine as StructuredExtractor,
    readinessValidator: validateSpineReadiness as ReadinessValidator,
    argBuilder: buildSpineArgs as ToolArgBuilder,
    resultRenderer: renderSpineResult as ResultRenderer,
  },
  respiratory: {
    system: "respiratory",
    // ADR-0001 provisional live (slice 17): the extractor was updated to
    // recognize the workbook's natural-language occupational-asthma
    // phrasings (requiring daily maintenance, transfer from exposure ≥1
    // year). Without promotion, the new extraction work was masked by the
    // legacy slot-evaluator's PFT-only readiness path. Promoted to enable
    // the structured readiness validator that handles asthma prereqs.
    mode: "structured_live",
    extractor: extractRespiratory as StructuredExtractor,
    readinessValidator: validateRespiratoryReadiness as ReadinessValidator,
    argBuilder: buildRespiratoryArgs as ToolArgBuilder,
    resultRenderer: renderRespiratoryResult as ResultRenderer,
  },
  renal: {
    system: "renal",
    // ADR-0001 provisional live (slice 15, evidence upgraded slice 16):
    // 100% safe-outcome AND 100% exact-calculation on 10-row sample (8 of
    // those rows exercise the calculation path through the engine's
    // clinical-severity bracket; the engine's output falls within the
    // workbook's expected range each time). Promoted with real evidence.
    mode: "structured_live",
    extractor: extractRenal as StructuredExtractor,
    readinessValidator: validateRenalReadiness as ReadinessValidator,
    argBuilder: buildRenalArgs as ToolArgBuilder,
    resultRenderer: renderRenalResult as ResultRenderer,
  },
  gastro_digestive: {
    system: "gastro_digestive",
    // ADR-0001 provisional live (slice 15): 100% safe-outcome on 30-row
    // sample after slice-13 router fix added colorectal/abdominal synonyms.
    // Exact-calculation rate is N/A — workbook PI% values are all ranges
    // (0-9%, 10-24%, etc.), which correctly classify as
    // clarification_required since the doctor must pick a value within
    // the bracket. Same caveat as renal applies: open follow-up to add
    // exact-calculation evidence.
    mode: "structured_live",
    extractor: extractGastro as StructuredExtractor,
    readinessValidator: validateGastroReadiness as ReadinessValidator,
    argBuilder: buildGastroArgs as ToolArgBuilder,
    resultRenderer: renderGastroResult as ResultRenderer,
  },
  hearing: {
    system: "hearing",
    // ADR-0001 provisional live: retained to avoid deterministic-flow regression.
    // Must earn full structured_live via curated goldens + Excel shadow thresholds.
    mode: "structured_live",
    extractor: extractHearing as StructuredExtractor,
    readinessValidator: validateHearingReadiness as ReadinessValidator,
    instanceReadinessValidator: validateHearingInstanceReadiness as InstanceAwareReadinessValidator,
    argBuilder: buildHearingArgs as ToolArgBuilder,
    resultRenderer: renderHearingResult as ResultRenderer,
  },
  cns:               { system: "cns",               mode: "legacy" },
  visual:            { system: "visual",            mode: "legacy" },
};

/**
 * Systems currently retained as `structured_live` without full ADR-0001
 * promotion evidence (curated goldens + Excel shadow thresholds). These are
 * provisional and must either earn full promotion or be demoted once the
 * Excel shadow runner is in place.
 *
 * Promotion status (slice 15):
 *   - hearing: full evidence (100% safe-outcome, 100% exact-calculation,
 *     n=8 exact rows). Strongest claim to promotion.
 *   - spine: retained from slice 1; calibration shows 86.7% / 86.7% on
 *     30-row sample — close to the 95%/90% gate but not yet there.
 *     Pending extractor phrasing improvements.
 *   - gastro_digestive: 100% safe-outcome on 30-row sample;
 *     exact-calculation N/A (workbook PI% values are all ranges, all rows
 *     classify as clarification_required). Promoted on the strength of
 *     routing/classification correctness only.
 *   - renal: 100% safe-outcome on 10-row sample; exact-calculation N/A
 *     (workbook descriptions lack lab values). Same caveat as gastro.
 *
 * A system that is `structured_live` and NOT on this allowlist is treated as
 * having earned full promotion under ADR-0001.
 */
export const PROVISIONAL_STRUCTURED_LIVE: readonly GatiodSystemKey[] = [
  "spine",
  "hearing",
  "gastro_digestive",
  "renal",
  "respiratory",
  "upper_limb",
  "lower_limb",
] as const;

export interface PromotionCheckResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

/**
 * Evidence interface for ADR-0001 calibration. Returns the latest stored
 * calibration evidence for a system, or null if no evidence exists yet.
 * The shape mirrors `SystemCalibrationReport` but is duplicated locally to
 * avoid pulling test code into the production registry module.
 */
export interface PromotionEvidence {
  loadCalibration(system: GatiodSystemKey): {
    sampleSize: number;
    componentSafeOutcomeRate: number;
    exactCalculationRate: number;
    exactRowCount: number;
  } | null;
}

/** Per-system ADR-0001 thresholds (safe%, exact%). */
const ADR_0001_REGISTRY_THRESHOLDS: Record<GatiodSystemKey, { safe: number; exact: number } | null> = {
  hearing:           { safe: 95, exact: 90 },
  spine:             { safe: 95, exact: 90 },
  respiratory:       { safe: 90, exact: 80 },
  renal:             { safe: 90, exact: 80 },
  gastro_digestive:  { safe: 85, exact: 70 },
  upper_limb:        { safe: 85, exact: 70 },
  lower_limb:        { safe: 85, exact: 70 },
  cns:               null, // deferred per ADR-0002
  visual:            null,
};

/**
 * CI-time check that enforces ADR-0001's promotion gate. The runtime
 * `validateSystemRegistry()` only checks component wiring; this function
 * checks promotion status.
 *
 * Two-mode operation:
 *
 * 1. **Allowlist mode** (no evidence reader passed): a `structured_live`
 *    system must either be on `PROVISIONAL_STRUCTURED_LIVE` (warns) or
 *    the call fails. This is the original slice-1 stub.
 *
 * 2. **Evidence mode** (slice 32): when an evidence reader is passed, the
 *    function ALSO requires every `structured_live` system to have a
 *    calibration report whose rates meet the per-system threshold from
 *    [ADR-0001](docs/adr/0001-structured-live-promotion-gate.md). A
 *    system whose latest calibration falls below threshold is reported
 *    as a failure even if it's on the allowlist — the allowlist
 *    expressed historical permission to be live, but live status now
 *    requires current evidence.
 */
export function validateStructuredLivePromotion(
  evidence?: PromotionEvidence,
): PromotionCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [system, cap] of Object.entries(V2_SYSTEM_REGISTRY)) {
    if (cap.mode !== "structured_live") continue;
    const sysKey = system as GatiodSystemKey;

    // Allowlist check (original slice-1 behavior).
    const onAllowlist = PROVISIONAL_STRUCTURED_LIVE.includes(sysKey);

    // Evidence check (slice 32). When no reader is provided, fall back to
    // allowlist mode. When a reader is provided, require evidence at or
    // above the per-system threshold.
    if (evidence) {
      const thresholds = ADR_0001_REGISTRY_THRESHOLDS[sysKey];
      if (thresholds === null) {
        warnings.push(`${system} is structured_live but ADR-0001 has marked it deferred.`);
        continue;
      }
      const report = evidence.loadCalibration(sysKey);
      if (!report) {
        failures.push(
          `${system} is structured_live but no ADR-0001 calibration report was found. ` +
            `Run \`npm run test:excel-shadow\` to generate one.`,
        );
        continue;
      }
      const safePct = report.componentSafeOutcomeRate * 100;
      const exactPct = report.exactCalculationRate * 100;
      const reasons: string[] = [];
      if (safePct < thresholds.safe) {
        reasons.push(`safe-outcome ${safePct.toFixed(1)}% < ${thresholds.safe}%`);
      }
      if (report.exactRowCount > 0 && exactPct < thresholds.exact) {
        reasons.push(`exact-calculation ${exactPct.toFixed(1)}% < ${thresholds.exact}% (n=${report.exactRowCount})`);
      }
      if (reasons.length > 0) {
        failures.push(`${system} is structured_live but ADR-0001 evidence is below threshold: ${reasons.join("; ")}.`);
      } else if (onAllowlist) {
        warnings.push(
          `${system}: provisional allowlist entry, evidence at ${safePct.toFixed(1)}%/${report.exactRowCount === 0 ? "N/A" : exactPct.toFixed(1) + "%"} ` +
            `meets thresholds (safe ≥${thresholds.safe}%, exact ≥${thresholds.exact}%).`,
        );
      }
    } else if (!onAllowlist) {
      // Allowlist-only mode: fail when not on allowlist.
      failures.push(
        `${system} is structured_live without ADR-0001 promotion evidence ` +
          `(not on PROVISIONAL_STRUCTURED_LIVE allowlist and no evidence reader supplied).`,
      );
    } else {
      warnings.push(
        `${system} is provisional structured_live pending ADR-0001 Excel evidence.`,
      );
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

export function isStructuredLiveSystem(system: GatiodSystemKey): boolean {
  const cap = V2_SYSTEM_REGISTRY[system];
  return (
    cap.mode === "structured_live" &&
    Boolean(cap.extractor) &&
    Boolean(cap.readinessValidator) &&
    Boolean(cap.argBuilder) &&
    Boolean(cap.resultRenderer)
  );
}

export function isStructuredCapableSystem(system: GatiodSystemKey): boolean {
  const cap = V2_SYSTEM_REGISTRY[system];
  return cap.mode === "structured_shadow" || cap.mode === "structured_live";
}

export function requireStructuredCapability(system: GatiodSystemKey): Required<V2SystemCapability> {
  if (!isStructuredLiveSystem(system)) {
    throw new Error(`${system} is not a fully migrated structured V2 system.`);
  }
  return V2_SYSTEM_REGISTRY[system] as Required<V2SystemCapability>;
}

export function validateSystemRegistry(): void {
  for (const [system, cap] of Object.entries(V2_SYSTEM_REGISTRY)) {
    if (cap.mode !== "structured_live") continue;
    const missing = (
      [
        !cap.extractor && "extractor",
        !cap.readinessValidator && "readinessValidator",
        !cap.argBuilder && "argBuilder",
        !cap.resultRenderer && "resultRenderer",
      ] as (string | false)[]
    ).filter(Boolean) as string[];
    if (missing.length > 0) {
      throw new Error(`${system} is structured_live but missing: ${missing.join(", ")}`);
    }
  }
}
