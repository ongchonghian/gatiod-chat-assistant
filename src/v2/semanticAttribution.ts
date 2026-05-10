// Semantic-attributed pending observations and disagreement detection
// (REQ-SC-DISAGREE-001, ADR-0003 Slice H).
//
// When the doctor accepts a semantic interpretation but the deterministic
// extractor cannot produce calculation-grade facts for one of the accepted
// findings, two things must happen:
//
//   1. A `PendingObservation` of type `semantic_mapping_gap` is surfaced so
//      the conversation can recover via a targeted clarification.
//   2. A `semantic_to_structured_extraction_failed` audit event is logged so
//      the disagreement is traceable.
//
// This module owns the helpers for both. The actual integration point lives
// in `chatServiceV2.ts` (Slice H wiring): after the extraction loop runs
// with the orchestrator's `ExtractionContext`, we scan accepted findings
// against the post-extraction state and emit disagreements.
//
// Design choice: the chatServiceV2-level detector is conservative. It only
// flags a disagreement when the accepted finding's system produced *neither*
// extracted facts *nor* its own pending observations. Extractors that
// surface their own pending observations (e.g. spine multi-region guard)
// already handle the disagreement via the standard clarification flow;
// double-emission would add noise without information.

import { randomUUID } from "crypto";
import type {
  ExtractionContext,
  GatiodSystemKey,
  PendingObservation,
  PendingObservationSemanticAttribution,
  SemanticCandidateFinding,
  SemanticMappingFailureKind,
  V2SessionState,
} from "./contracts.js";

export interface SemanticDisagreement {
  system: GatiodSystemKey;
  finding: SemanticCandidateFinding;
  failureKind: SemanticMappingFailureKind;
}

/**
 * Detect semantically-accepted findings that the deterministic extractor
 * left unhandled. A finding counts as a disagreement when:
 *   - it appears in `extractionContext.acceptedFindings`, AND
 *   - the post-extraction system state has no extracted facts for that
 *     system, AND
 *   - the post-extraction system state has no pending observations for
 *     that system (those represent normal clarification flow, not
 *     disagreement).
 *
 * Returns one entry per disagreeing finding. Multiple findings for the same
 * system produce multiple entries — each carries its own source span and
 * proposed mapping for audit traceability.
 */
export function detectSemanticDisagreements(
  context: ExtractionContext,
  stateAfterExtraction: V2SessionState,
): SemanticDisagreement[] {
  const out: SemanticDisagreement[] = [];

  for (const finding of context.acceptedFindings) {
    const sysState = stateAfterExtraction.systems[finding.system];
    if (!sysState) continue;

    const hasFacts = Object.keys(sysState.extractedFacts ?? {}).length > 0;
    const hasPending = sysState.pendingObservations.length > 0;

    if (hasFacts || hasPending) continue;

    out.push({
      system: finding.system,
      finding,
      failureKind: classifyFailureKind(finding),
    });
  }

  return out;
}

function classifyFailureKind(
  finding: SemanticCandidateFinding,
): SemanticMappingFailureKind {
  // The semantic completeness label drives the failure kind — this lets
  // the LLM inform downstream messaging without exposing it as the
  // authoritative result.
  if (finding.completeness === "unsupported") return "unsupported_in_structured_v2";
  if (finding.completeness === "missing_calculation_fields") return "missing_calculation_field";
  return "extractor_no_match";
}

const SYSTEM_DISPLAY_NAMES: Record<GatiodSystemKey, string> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro / Digestive",
  hearing: "Hearing",
  cns: "Central Nervous System",
  visual: "Visual",
};

/**
 * Build a `PendingObservation` of type `semantic_mapping_gap` from a
 * detected disagreement. The clarification question is templated:
 *
 *   "I understood this as <proposedMapping>, based on '<sourceSpan>',
 *    but I could not convert it into a calculation-ready fact. <ask>."
 *
 * Where `<ask>` is derived from the finding's `missingFields` when present.
 */
export function buildSemanticGapObservation(
  disagreement: SemanticDisagreement,
  consensusId: string,
  now: string = new Date().toISOString(),
): PendingObservation {
  const { finding, failureKind } = disagreement;
  const systemName = SYSTEM_DISPLAY_NAMES[finding.system];

  const lead =
    `I understood this as **${finding.proposedMapping}**, based on "${finding.sourceSpan}", ` +
    `but I could not convert it into a calculation-ready ${systemName} fact.`;

  let ask: string;
  if (finding.missingFields.length > 0) {
    ask = `Please provide: ${finding.missingFields.join(", ")}.`;
  } else if (failureKind === "unsupported_in_structured_v2") {
    ask = `Structured V2 does not yet support this finding. Please choose how to proceed.`;
  } else {
    ask = `Please provide additional clinical detail.`;
  }

  const attribution: PendingObservationSemanticAttribution = {
    interpretationId: consensusId,
    sourceSpan: finding.sourceSpan,
    proposedMapping: finding.proposedMapping,
    findingType: finding.findingType,
    confidence: Math.max(finding.systemConfidence, finding.mappingConfidence),
    failureKind,
  };

  return {
    id: randomUUID(),
    system: finding.system,
    type: "semantic_mapping_gap",
    sourceText: finding.sourceSpan,
    parsed: {},
    missingFields: finding.missingFields,
    clarificationQuestion: `${lead} ${ask}`,
    candidateAnswers: undefined,
    createdAt: now,
    updatedAt: now,
    semanticAttribution: attribution,
  };
}

/** Audit event payload for `semantic_to_structured_extraction_failed`. */
export interface SemanticDisagreementAuditPayload {
  interpretationId: string;
  system: GatiodSystemKey;
  sourceSpan: string;
  proposedMapping: string;
  failureKind: SemanticMappingFailureKind;
  missingFields: string[];
  pendingObservationId?: string;
}

export function buildDisagreementAuditPayload(
  consensusId: string,
  disagreement: SemanticDisagreement,
  pendingObservationId?: string,
): SemanticDisagreementAuditPayload {
  return {
    interpretationId: consensusId,
    system: disagreement.system,
    sourceSpan: disagreement.finding.sourceSpan,
    proposedMapping: disagreement.finding.proposedMapping,
    failureKind: disagreement.failureKind,
    missingFields: disagreement.finding.missingFields,
    pendingObservationId,
  };
}
