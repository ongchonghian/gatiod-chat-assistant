import { describe, expect, it } from "vitest";
import { renderSemanticConsensus } from "../../src/v2/semanticInterpreterRenderer.js";
import { tryResolvePendingConsensus } from "../../src/v2/consensusResolver.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type {
  PendingConsensus,
  SemanticInterpretation,
  V2SessionState,
} from "../../src/v2/contracts.js";

function multiSystemInterpretation(): SemanticInterpretation {
  return {
    interpretationId: "interp-1",
    sourceHash: "hash-1",
    candidateSystems: [
      { system: "upper_limb", status: "structured_live", confidence: 0.9, rationale: "shoulder finding" },
      { system: "spine", status: "structured_live", confidence: 0.9, rationale: "L4 disc finding" },
      { system: "hearing", status: "structured_live", confidence: 0.9, rationale: "right ear AHL" },
    ],
    candidateFindings: [],
    unsupportedTerms: [],
    proceedReady: true,
  } as unknown as SemanticInterpretation;
}

function singleSystemInterpretation(): SemanticInterpretation {
  return {
    interpretationId: "interp-1",
    sourceHash: "hash-1",
    candidateSystems: [
      { system: "upper_limb", status: "structured_live", confidence: 0.9, rationale: "shoulder finding" },
    ],
    candidateFindings: [],
    unsupportedTerms: [],
    proceedReady: true,
  } as unknown as SemanticInterpretation;
}

describe("renderSemanticConsensus plan-of-attack block (slice #13)", () => {
  it("includes a plan-of-attack line + Reorder chip when ≥2 systems", () => {
    const r = renderSemanticConsensus(multiSystemInterpretation());
    expect(r.message).toMatch(/I'll work through these in this order:/);
    expect(r.message).toMatch(/1\) Upper Limb, 2\) Spine, 3\) Hearing/);
    expect(r.chips).toContain("Reorder");
  });

  it("omits the plan-of-attack block + Reorder chip for single-system claims", () => {
    const r = renderSemanticConsensus(singleSystemInterpretation());
    expect(r.message).not.toMatch(/I'll work through these in this order/);
    expect(r.chips).not.toContain("Reorder");
  });
});

describe("consensusResolver reorder branch (slice #13)", () => {
  function pendingFor(state: V2SessionState): V2SessionState {
    const pc: PendingConsensus = {
      interpretationId: "interp-1",
      interpretationHash: "hash-1",
      sourceHash: "src-1",
      sourceText: "multi-system narrative",
      message: "",
      candidateSystems: ["upper_limb", "spine", "hearing"],
      candidateFindings: [],
      awaiting: "decision",
      createdAt: new Date().toISOString(),
      revision: 0,
      editAttemptCount: 0,
    };
    return {
      ...state,
      pendingConsensus: pc,
      detectionOrder: ["upper_limb", "spine", "hearing"],
    };
  }

  it("clicking 'Reorder' switches awaiting to reorder_instruction and prompts", () => {
    const state = pendingFor(defaultV2SessionState());
    const r = tryResolvePendingConsensus({ state, replyText: "Reorder" });
    expect(r.resolved).toBe(true);
    expect(r.state.pendingConsensus?.awaiting).toBe("reorder_instruction");
    expect(r.response?.message).toMatch(/comma-separated/i);
  });

  it("typed reorder reply updates detectionOrder and clears awaiting", () => {
    let state = pendingFor(defaultV2SessionState());
    state = { ...state, pendingConsensus: { ...state.pendingConsensus!, awaiting: "reorder_instruction" } };
    const r = tryResolvePendingConsensus({ state, replyText: "spine, hearing, upper limb" });
    expect(r.resolved).toBe(true);
    expect(r.state.detectionOrder).toEqual(["spine", "hearing", "upper_limb"]);
    expect(r.state.pendingConsensus?.awaiting).toBe("decision");
  });

  it("unparseable reorder reply asks again with the cancel chip", () => {
    let state = pendingFor(defaultV2SessionState());
    state = { ...state, pendingConsensus: { ...state.pendingConsensus!, awaiting: "reorder_instruction" } };
    const r = tryResolvePendingConsensus({ state, replyText: "I don't know" });
    expect(r.resolved).toBe(false);
    expect(r.response?.chips).toContain("Cancel reorder");
  });

  it("'Cancel reorder' restores awaiting=decision without changing detectionOrder", () => {
    let state = pendingFor(defaultV2SessionState());
    state = { ...state, pendingConsensus: { ...state.pendingConsensus!, awaiting: "reorder_instruction" } };
    const r = tryResolvePendingConsensus({ state, replyText: "Cancel reorder" });
    expect(r.resolved).toBe(true);
    expect(r.state.pendingConsensus?.awaiting).toBe("decision");
    expect(r.state.detectionOrder).toEqual(["upper_limb", "spine", "hearing"]);
  });

  it("rejects a reorder that omits a candidate system (must cover the full set)", () => {
    let state = pendingFor(defaultV2SessionState());
    state = { ...state, pendingConsensus: { ...state.pendingConsensus!, awaiting: "reorder_instruction" } };
    const r = tryResolvePendingConsensus({ state, replyText: "spine, hearing" });
    expect(r.resolved).toBe(false);
  });
});
