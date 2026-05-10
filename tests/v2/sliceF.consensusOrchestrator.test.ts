import { describe, expect, it } from "vitest";
import { runConsensusOrchestrator } from "../../src/v2/consensusOrchestrator.js";
import {
  defaultV2SessionState,
  setPendingConsensus,
} from "../../src/v2/stateMachine.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import type { SemanticModelClient } from "../../src/v2/semanticInterpreter.js";
import type {
  GatiodSystemKey,
  PendingConsensus,
  SemanticInterpretation,
  V2SessionState,
} from "../../src/v2/contracts.js";

// Slice F — consensus orchestrator integration tests. The orchestrator
// is the single entry point chatServiceV2 calls; it combines the gate +
// resolver + interpreter + renderer behind two feature flags.

const SOURCE_TEXT =
  "Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.";

const NOW = "2026-05-10T00:00:00.000Z";

function validInterpretation(
  overrides?: Partial<SemanticInterpretation>,
): SemanticInterpretation {
  return {
    id: "interp-1",
    sourceText: SOURCE_TEXT,
    sourceHash: "sh",
    candidateSystems: [
      {
        system: "lower_limb",
        confidence: 0.9,
        status: "structured_supported",
        evidence: ["common peroneal nerve lesion"],
        rationale: "Left common peroneal nerve lesion with combined deficit.",
      },
      {
        system: "cns",
        confidence: 0.85,
        status: "legacy_deferred",
        evidence: ["complete anosmia"],
        rationale: "CNS olfactory finding, currently legacy/deferred.",
      },
    ],
    candidateFindings: [
      {
        system: "lower_limb",
        sourceSpan: "Left common peroneal nerve lesion with combined sensory and motor deficit",
        findingType: "neurological",
        proposedMapping: "Lower-limb common peroneal nerve, combined deficit",
        systemConfidence: 0.9,
        mappingConfidence: 0.85,
        completeness: "missing_calculation_fields",
        explicitlyStatedFields: ["side: left"],
        inferredFields: [],
        missingFields: ["partial vs total loss"],
        calculationReady: false,
      },
      {
        system: "cns",
        sourceSpan: "Complete anosmia due to traumatic olfactory nerve injury",
        findingType: "cns_component",
        proposedMapping: "CNS olfactory component",
        systemConfidence: 0.85,
        mappingConfidence: 0.8,
        completeness: "unsupported",
        explicitlyStatedFields: ["complete anosmia"],
        inferredFields: [],
        missingFields: [],
        calculationReady: false,
      },
    ],
    unsupportedTerms: [],
    assumptions: [],
    requiresUserConsensus: true,
    createdAt: NOW,
    ...overrides,
  };
}

function mockClient(output: string | (() => string)): SemanticModelClient {
  return {
    async generate() {
      return typeof output === "function" ? output() : output;
    },
  };
}

function pendingFixture(
  candidateSystems: GatiodSystemKey[],
  awaiting: "decision" | "edit_instruction" = "decision",
): PendingConsensus {
  return {
    interpretationId: "interp-1",
    interpretationHash: "ihash",
    sourceHash: "shash",
    sourceText: SOURCE_TEXT,
    message: "Detected: " + candidateSystems.join(", "),
    candidateSystems,
    createdAt: NOW,
    awaiting,
  };
}

describe("Slice F — feature flag passthrough", () => {
  it("returns passthrough when SEMANTIC_CONSENSUS_ENABLED is off", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      // forceConsensusEnabled defaults to false
    });
    expect(result.kind).toBe("passthrough");
  });

  it("returns passthrough when consensus flag is on but interpreter flag is off", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: false,
    });
    expect(result.kind).toBe("passthrough");
  });

  it("returns passthrough when no model client is provided", async () => {
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("passthrough");
  });
});

describe("Slice F — initiate consensus (no pendingConsensus)", () => {
  it("invokes the interpreter and returns 'respond' with proposal card", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      expect(result.message).toContain("2 GATIOD assessment areas");
      expect(result.message).toContain("Lower Limb");
      expect(result.message).toContain("Central Nervous System");
      expect(result.chips).toEqual([
        "Proceed",
        "Edit interpretation",
        "Choose system first",
        "Reject",
      ]);
      expect(result.state.pendingConsensus).not.toBeNull();
      expect(result.state.pendingConsensus?.candidateSystems).toEqual(["lower_limb", "cns"]);
      expect(result.state.pendingConsensus?.awaiting).toBe("decision");
      expect(result.policyReason).toBe("semantic_consensus_proposal");
    }
  });

  it("returns passthrough when the gate does not fire", async () => {
    // Single-system simple input — gate skips on short_workflow_reply or doesn't trigger.
    const simple = "Right ear AHL 90 dB.";
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(simple);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: simple,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("passthrough");
  });

  it("returns passthrough when interpreter validation fails (fail-closed to deterministic)", async () => {
    // Model returns valid JSON but with a fabricated source span.
    const bad = validInterpretation({
      candidateFindings: [
        {
          ...validInterpretation().candidateFindings[0],
          sourceSpan: "NOT IN SOURCE",
        },
        validInterpretation().candidateFindings[1],
      ],
    });
    const client = mockClient(JSON.stringify(bad));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    // Interpreter rejected — fall back to deterministic pipeline.
    expect(result.kind).toBe("passthrough");
    // Audit event still recorded for observability.
    expect(
      result.auditEvents.some((e) => e.eventType === "semantic_interpretation_schema_failed"),
    ).toBe(true);
  });
});

describe("Slice F — resolve pendingConsensus (decision mode)", () => {
  it("returns 'substitute' on Proceed, with original sourceText", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"]),
    );
    const norm = normalizeClinicalUtterance("Proceed");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Proceed",
      normalized: norm,
      modelClient: mockClient("{}"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("substitute");
    if (result.kind === "substitute") {
      expect(result.sourceText).toBe(SOURCE_TEXT);
      expect(result.state.pendingConsensus).toBeNull();
      expect(result.extractionContext.acceptedSystems).toEqual(["lower_limb", "cns"]);
      expect(result.extractionContext.consensusId).toBe("interp-1");
      expect(result.extractionContext.focusSystem).toBeUndefined();
      // CNS should be auto-marked legacy_deferred on accept.
      expect(result.state.claimComponentOverrides.cns?.status).toBe("legacy_deferred");
    }
  });

  it("returns 'substitute' on 'Hearing first' with focusSystem set", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["spine", "hearing"]),
    );
    const norm = normalizeClinicalUtterance("Hearing first");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Hearing first",
      normalized: norm,
      modelClient: mockClient("{}"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("substitute");
    if (result.kind === "substitute") {
      expect(result.extractionContext.focusSystem).toBe("hearing");
      expect(result.extractionContext.acceptedSystems).toEqual(["spine", "hearing"]);
    }
  });

  it("returns 'respond' on Reject (clears pendingConsensus, no extraction)", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"]),
    );
    const norm = normalizeClinicalUtterance("Reject");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Reject",
      normalized: norm,
      modelClient: mockClient("{}"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      expect(result.state.pendingConsensus).toBeNull();
      expect(result.message).toContain("provide the findings again");
      expect(result.policyReason).toBe("consensus_rejected");
    }
  });

  it("returns 'respond' on Edit (sets awaiting=edit_instruction)", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"]),
    );
    const norm = normalizeClinicalUtterance("Edit");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Edit",
      normalized: norm,
      modelClient: mockClient("{}"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      expect(result.state.pendingConsensus?.awaiting).toBe("edit_instruction");
      expect(result.message).toContain("What should I change");
    }
  });

  it("returns 'respond' on unresolved replies, leaves pendingConsensus intact", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"]),
    );
    const norm = normalizeClinicalUtterance("Maybe later");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Maybe later",
      normalized: norm,
      modelClient: mockClient("{}"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      expect(result.state.pendingConsensus).not.toBeNull();
      expect(result.policyReason).toBe("consensus_unresolved");
    }
  });
});

describe("Slice F — edit-instruction mode (re-interpretation)", () => {
  it("re-runs the interpreter with edit context and replaces pendingConsensus", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"], "edit_instruction"),
    );
    // The model returns a revised interpretation with only lower_limb.
    const revised = validInterpretation({
      id: "interp-2",
      candidateSystems: [validInterpretation().candidateSystems[0]],
      candidateFindings: [validInterpretation().candidateFindings[0]],
    });
    const client = mockClient(JSON.stringify(revised));
    const norm = normalizeClinicalUtterance("Actually ignore CNS");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Actually ignore CNS",
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      // New interpretation persisted as a fresh pendingConsensus
      expect(result.state.pendingConsensus?.interpretationId).toBe("interp-2");
      expect(result.state.pendingConsensus?.candidateSystems).toEqual(["lower_limb"]);
      expect(result.state.pendingConsensus?.awaiting).toBe("decision");
      expect(result.message).toContain("1 GATIOD assessment area");
      expect(result.policyReason).toBe("semantic_reinterpretation_rendered");
    }
  });

  it("returns 'respond' fail-closed when re-interpretation fails", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"], "edit_instruction"),
    );
    const client = mockClient("garbage non-json");
    const norm = normalizeClinicalUtterance("Try again");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Try again",
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      expect(result.policyReason).toBe("semantic_reinterpretation_failed");
      expect(result.message).toContain("could not produce a revised interpretation");
    }
  });

  it("fails closed without a model client in edit mode", async () => {
    const state = setPendingConsensus(
      defaultV2SessionState(),
      pendingFixture(["lower_limb", "cns"], "edit_instruction"),
    );
    const norm = normalizeClinicalUtterance("Some edit");
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Some edit",
      normalized: norm,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
      // no modelClient
    });
    expect(result.kind).toBe("respond");
    if (result.kind === "respond") {
      expect(result.policyReason).toBe("consensus_edit_unavailable");
    }
  });
});

describe("Slice F — pendingConsensus survives across turns", () => {
  it("first turn creates pendingConsensus; second turn (Proceed) substitutes source", async () => {
    const client = mockClient(() => JSON.stringify(validInterpretation()));
    const norm1 = normalizeClinicalUtterance(SOURCE_TEXT);
    const turn1 = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm1,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(turn1.kind).toBe("respond");
    const stateAfterTurn1: V2SessionState =
      turn1.kind === "respond" ? turn1.state : defaultV2SessionState();
    expect(stateAfterTurn1.pendingConsensus).not.toBeNull();

    const norm2 = normalizeClinicalUtterance("Proceed");
    const turn2 = await runConsensusOrchestrator({
      state: stateAfterTurn1,
      replyText: "Proceed",
      normalized: norm2,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(turn2.kind).toBe("substitute");
    if (turn2.kind === "substitute") {
      expect(turn2.sourceText).toBe(SOURCE_TEXT);
      expect(turn2.state.pendingConsensus).toBeNull();
    }
  });
});
