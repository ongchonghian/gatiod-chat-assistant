import { describe, expect, it } from "vitest";
import { makePolicyDecision } from "../../src/v2/policyEngine.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type { GroundingResult, NormalizedUtterance, RouteDecision } from "../../src/v2/contracts.js";

const baseUtterance: NormalizedUtterance = {
  raw: "test",
  normalizedText: "test",
  tokens: ["test"],
  mappedTokens: [],
  unresolvedTerms: [],
  confidence: 0.9,
};

const emptyGrounding: GroundingResult = {
  citations: [],
  ontologyMatches: [],
};

describe("makePolicyDecision", () => {
  it("forces clarification when confidence is low", () => {
    const route: RouteDecision = {
      operation: "assessment",
      systems: ["spine"],
      confidence: 0.42,
      reasons: [],
    };

    const decision = makePolicyDecision(route, baseUtterance, emptyGrounding, defaultV2SessionState());
    expect(decision.action).toBe("clarify");
  });

  it("requires 2+ systems before global CVC", () => {
    const route: RouteDecision = {
      operation: "global_cvc",
      systems: [],
      confidence: 0.9,
      reasons: [],
    };

    const decision = makePolicyDecision(route, baseUtterance, emptyGrounding, defaultV2SessionState());
    expect(decision.action).toBe("clarify");
  });

  it("skips lookup-first for high-confidence DBE match on structured_live systems (slice 24)", () => {
    // Slice-24 — when the primary system is structured_live, the
    // extractor's slice-23 DBE auto-population already wrote the fact;
    // running a lookup-first tool would lose the doctor's "Confirmed"
    // reply because the lookup result doesn't set pendingConfirmation.
    // Now: lookup-first is skipped for structured_live, the structured
    // readiness path runs instead.
    const route: RouteDecision = {
      operation: "assessment",
      systems: ["lower_limb"],
      confidence: 0.88,
      reasons: [],
    };

    const grounding: GroundingResult = {
      citations: [],
      ontologyMatches: [
        {
          system: "lower_limb",
          type: "dbe",
          canonicalId: "femoral_neck_head_avascular_necrosis",
          label: "Hip — Femoral neck/head fracture avascular necrosis",
          score: 0.91,
          aliases: ["femoral neck/head fracture avascular necrosis"],
        },
      ],
    };

    const decision = makePolicyDecision(route, baseUtterance, grounding, defaultV2SessionState());
    // Should NOT propose a lookup tool; structured readiness handles it.
    expect(decision.proposedTools.find((t) => t.name === "lookup_lower_dbe_condition")).toBeUndefined();
  });

  it("does not re-clarify explicit system selection after a clarify prompt", () => {
    const route: RouteDecision = {
      operation: "assessment",
      systems: ["spine"],
      confidence: 0.48,
      reasons: [],
    };

    const state = defaultV2SessionState();
    state.pendingClarification = "Which system first?";

    const utterance: NormalizedUtterance = {
      ...baseUtterance,
      raw: "spine",
      normalizedText: "spine",
      tokens: ["spine"],
    };

    const decision = makePolicyDecision(route, utterance, emptyGrounding, state);
    expect(decision.action).not.toBe("clarify");
  });

  it("treats short follow-up 'no' as continuation of active flow", () => {
    const route: RouteDecision = {
      operation: "clarify",
      systems: [],
      confidence: 0.2,
      reasons: [],
    };

    const state = defaultV2SessionState();
    state.pendingClarification = null;

    const utterance: NormalizedUtterance = {
      ...baseUtterance,
      raw: "no",
      normalizedText: "no",
      tokens: ["no"],
      unresolvedTerms: [],
    };

    const decision = makePolicyDecision(route, utterance, emptyGrounding, state);
    expect(decision.action).toBe("delegate_legacy");
  });
});
