import type {
  AssessmentRenderResult,
  BuildResult,
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

export type StructuredExtractor = (
  utterance: NormalizedUtterance,
  systemState: V2SystemState,
  ontologyMatches?: OntologyMatch[]
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
    mode: "structured_live",
    extractor: extractUpperLimb as StructuredExtractor,
    readinessValidator: validateUpperLimbReadiness as ReadinessValidator,
    argBuilder: buildUpperLimbArgs as ToolArgBuilder,
    resultRenderer: renderUpperLimbResult as ResultRenderer,
  },
  lower_limb: {
    system: "lower_limb",
    mode: "structured_live",
    extractor: extractLowerLimb as StructuredExtractor,
    readinessValidator: validateLowerLimbReadiness as ReadinessValidator,
    argBuilder: buildLowerLimbArgs as ToolArgBuilder,
    resultRenderer: renderLowerLimbResult as ResultRenderer,
  },
  spine: {
    system: "spine",
    mode: "structured_live",
    extractor: extractSpine as StructuredExtractor,
    readinessValidator: validateSpineReadiness as ReadinessValidator,
    argBuilder: buildSpineArgs as ToolArgBuilder,
    resultRenderer: renderSpineResult as ResultRenderer,
  },
  respiratory: {
    system: "respiratory",
    mode: "structured_live",
    extractor: extractRespiratory as StructuredExtractor,
    readinessValidator: validateRespiratoryReadiness as ReadinessValidator,
    argBuilder: buildRespiratoryArgs as ToolArgBuilder,
    resultRenderer: renderRespiratoryResult as ResultRenderer,
  },
  renal: {
    system: "renal",
    mode: "structured_live",
    extractor: extractRenal as StructuredExtractor,
    readinessValidator: validateRenalReadiness as ReadinessValidator,
    argBuilder: buildRenalArgs as ToolArgBuilder,
    resultRenderer: renderRenalResult as ResultRenderer,
  },
  gastro_digestive: {
    system: "gastro_digestive",
    mode: "structured_live",
    extractor: extractGastro as StructuredExtractor,
    readinessValidator: validateGastroReadiness as ReadinessValidator,
    argBuilder: buildGastroArgs as ToolArgBuilder,
    resultRenderer: renderGastroResult as ResultRenderer,
  },
  hearing: {
    system: "hearing",
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
