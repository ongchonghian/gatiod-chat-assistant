import { describe, expect, it } from "vitest";
import {
  buildDisagreementAuditPayload,
  buildSemanticGapObservation,
  detectSemanticDisagreements,
  type SemanticDisagreement,
} from "../../src/v2/semanticAttribution.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type {
  ExtractedFact,
  ExtractionContext,
  GatiodSystemKey,
  PendingObservation,
  SemanticCandidateFinding,
  V2SessionState,
} from "../../src/v2/contracts.js";

// Slice H — semantic-attributed pending observations and disagreement
// detection (REQ-SC-DISAGREE-001).

const NOW = "2026-05-10T00:00:00.000Z";

function lowerLimbFinding(
  overrides: Partial<SemanticCandidateFinding> = {},
): SemanticCandidateFinding {
  return {
    system: "lower_limb",
    sourceSpan: "Left common peroneal nerve lesion with combined sensory and motor deficit",
    findingType: "neurological",
    proposedMapping: "Lower-limb common peroneal nerve, combined sensory/motor deficit",
    systemConfidence: 0.9,
    mappingConfidence: 0.85,
    completeness: "missing_calculation_fields",
    explicitlyStatedFields: ["side: left", "nerve: common peroneal"],
    inferredFields: [],
    missingFields: ["partial vs total loss"],
    calculationReady: false,
    ...overrides,
  };
}

function spineFinding(
  overrides: Partial<SemanticCandidateFinding> = {},
): SemanticCandidateFinding {
  return {
    system: "spine",
    sourceSpan: "Cervical prolapsed disc with sensory deficit",
    findingType: "spine_diagnosis",
    proposedMapping: "Cervical disc prolapse with sensory deficit",
    systemConfidence: 0.9,
    mappingConfidence: 0.9,
    completeness: "missing_calculation_fields",
    explicitlyStatedFields: ["region: cervical"],
    inferredFields: [],
    missingFields: ["disc severity"],
    calculationReady: false,
    ...overrides,
  };
}

function makeContext(
  acceptedFindings: SemanticCandidateFinding[],
): ExtractionContext {
  const acceptedSystems = Array.from(
    new Set(acceptedFindings.map((f) => f.system)),
  ) as GatiodSystemKey[];
  return {
    consensusId: "interp-1",
    sourceText: "Polytrauma scenario",
    sourceHash: "h",
    acceptedSystems,
    acceptedFindings,
  };
}

function withFact(
  state: V2SessionState,
  system: GatiodSystemKey,
  key: string,
): V2SessionState {
  const fact: ExtractedFact<unknown> = {
    value: "x",
    sourceText: "x",
    confidence: 1,
    extractionMethod: "regex",
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...state.systems[system],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extractedFacts: { ...state.systems[system].extractedFacts, [key]: fact as ExtractedFact<any> },
        updatedAt: NOW,
      },
    },
  };
}

function withPendingObservation(
  state: V2SessionState,
  system: GatiodSystemKey,
): V2SessionState {
  const obs: PendingObservation = {
    id: "existing",
    system,
    type: "other",
    sourceText: "x",
    parsed: {},
    missingFields: [],
    clarificationQuestion: "Existing question",
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...state.systems[system],
        pendingObservations: [obs],
      },
    },
  };
}

// ── detectSemanticDisagreements ───────────────────────────────────────────

describe("Slice H — detectSemanticDisagreements", () => {
  it("returns one disagreement per accepted finding the extractor left unhandled", () => {
    const context = makeContext([lowerLimbFinding(), spineFinding()]);
    const stateAfter = defaultV2SessionState(); // empty — no extraction
    const disagreements = detectSemanticDisagreements(context, stateAfter);
    expect(disagreements).toHaveLength(2);
    expect(disagreements.map((d) => d.system).sort()).toEqual(["lower_limb", "spine"]);
  });

  it("excludes systems where the extractor produced facts", () => {
    const context = makeContext([lowerLimbFinding(), spineFinding()]);
    const stateAfter = withFact(defaultV2SessionState(), "spine", "spine_region");
    const disagreements = detectSemanticDisagreements(context, stateAfter);
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0].system).toBe("lower_limb");
  });

  it("excludes systems where the extractor surfaced its own pending observation", () => {
    const context = makeContext([lowerLimbFinding()]);
    const stateAfter = withPendingObservation(defaultV2SessionState(), "lower_limb");
    const disagreements = detectSemanticDisagreements(context, stateAfter);
    expect(disagreements).toHaveLength(0);
  });

  it("returns an empty list when there are no accepted findings", () => {
    const context = makeContext([]);
    const disagreements = detectSemanticDisagreements(context, defaultV2SessionState());
    expect(disagreements).toEqual([]);
  });

  it("classifies failureKind from the finding's completeness", () => {
    const context = makeContext([
      lowerLimbFinding({ completeness: "missing_calculation_fields" }),
      spineFinding({ completeness: "unsupported" }),
    ]);
    const disagreements = detectSemanticDisagreements(context, defaultV2SessionState());
    const lowerLimbD = disagreements.find((d) => d.system === "lower_limb");
    const spineD = disagreements.find((d) => d.system === "spine");
    expect(lowerLimbD?.failureKind).toBe("missing_calculation_field");
    expect(spineD?.failureKind).toBe("unsupported_in_structured_v2");
  });

  it("falls back to extractor_no_match for complete_for_extraction findings", () => {
    const context = makeContext([
      lowerLimbFinding({ completeness: "complete_for_extraction" }),
    ]);
    const disagreements = detectSemanticDisagreements(context, defaultV2SessionState());
    expect(disagreements[0].failureKind).toBe("extractor_no_match");
  });
});

// ── buildSemanticGapObservation ────────────────────────────────────────────

describe("Slice H — buildSemanticGapObservation", () => {
  it("produces a semantic_mapping_gap observation with attribution", () => {
    const finding = lowerLimbFinding();
    const disagreement: SemanticDisagreement = {
      system: "lower_limb",
      finding,
      failureKind: "missing_calculation_field",
    };
    const obs = buildSemanticGapObservation(disagreement, "interp-1", NOW);
    expect(obs.type).toBe("semantic_mapping_gap");
    expect(obs.system).toBe("lower_limb");
    expect(obs.semanticAttribution).toEqual({
      interpretationId: "interp-1",
      sourceSpan: finding.sourceSpan,
      proposedMapping: finding.proposedMapping,
      findingType: "neurological",
      confidence: 0.9,
      failureKind: "missing_calculation_field",
    });
    expect(obs.missingFields).toEqual(["partial vs total loss"]);
  });

  it("renders an attributable doctor-facing message", () => {
    const finding = lowerLimbFinding();
    const disagreement: SemanticDisagreement = {
      system: "lower_limb",
      finding,
      failureKind: "missing_calculation_field",
    };
    const obs = buildSemanticGapObservation(disagreement, "interp-1", NOW);
    expect(obs.clarificationQuestion).toContain("I understood this as");
    expect(obs.clarificationQuestion).toContain("Lower-limb common peroneal nerve");
    expect(obs.clarificationQuestion).toContain('based on "Left common peroneal');
    expect(obs.clarificationQuestion).toContain("Please provide: partial vs total loss");
  });

  it("uses an unsupported message for unsupported_in_structured_v2 failures", () => {
    const finding = lowerLimbFinding({ missingFields: [], completeness: "unsupported" });
    const disagreement: SemanticDisagreement = {
      system: "lower_limb",
      finding,
      failureKind: "unsupported_in_structured_v2",
    };
    const obs = buildSemanticGapObservation(disagreement, "interp-1", NOW);
    expect(obs.clarificationQuestion).toContain("Structured V2 does not yet support");
  });
});

// ── buildDisagreementAuditPayload ──────────────────────────────────────────

describe("Slice H — buildDisagreementAuditPayload", () => {
  it("captures interpretation id, source span, mapping, failure kind, and missing fields", () => {
    const finding = lowerLimbFinding();
    const disagreement: SemanticDisagreement = {
      system: "lower_limb",
      finding,
      failureKind: "missing_calculation_field",
    };
    const payload = buildDisagreementAuditPayload(
      "interp-1",
      disagreement,
      "obs-id-x",
    );
    expect(payload).toEqual({
      interpretationId: "interp-1",
      system: "lower_limb",
      sourceSpan: finding.sourceSpan,
      proposedMapping: finding.proposedMapping,
      failureKind: "missing_calculation_field",
      missingFields: ["partial vs total loss"],
      pendingObservationId: "obs-id-x",
    });
  });
});

// ── PendingObservation.semanticAttribution shape ──────────────────────────

describe("Slice H — PendingObservation.semanticAttribution", () => {
  it("is optional on regular pending observations", () => {
    const obs: PendingObservation = {
      id: "x",
      system: "lower_limb",
      type: "nerve_deficit",
      sourceText: "x",
      parsed: {},
      missingFields: [],
      clarificationQuestion: "?",
      createdAt: NOW,
      updatedAt: NOW,
    };
    // Compiles + accepted at runtime — semanticAttribution is optional.
    expect(obs.semanticAttribution).toBeUndefined();
  });
});
