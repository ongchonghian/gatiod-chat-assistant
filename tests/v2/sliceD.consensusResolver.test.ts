import { describe, expect, it } from "vitest";
import { tryResolvePendingConsensus } from "../../src/v2/consensusResolver.js";
import {
  defaultV2SessionState,
  setClaimComponentOverride,
  setPendingConsensus,
} from "../../src/v2/stateMachine.js";
import type {
  GatiodSystemKey,
  PendingConsensus,
  V2SessionState,
} from "../../src/v2/contracts.js";

// Slice D — deterministic consensus resolver (REQ-SC-RESOLVE-001/002).
// All branches exercised with mocked pendingConsensus fixtures; no LLM.

const NOW = "2026-05-10T00:00:00.000Z";

function pendingFixture(
  candidateSystems: GatiodSystemKey[],
  awaiting: "decision" | "edit_instruction" = "decision",
): PendingConsensus {
  return {
    interpretationId: "interp-1",
    interpretationHash: "ihash",
    sourceHash: "shash",
    sourceText: "Polytrauma claim spanning multiple systems.",
    message: "I detected the following systems: " + candidateSystems.join(", "),
    candidateSystems,
    createdAt: NOW,
    awaiting,
  };
}

function withConsensus(
  systems: GatiodSystemKey[],
  awaiting: "decision" | "edit_instruction" = "decision",
): V2SessionState {
  return setPendingConsensus(defaultV2SessionState(), pendingFixture(systems, awaiting));
}

describe("Slice D — accepted_all branch", () => {
  it("returns accepted_all on 'Proceed'", () => {
    const state = withConsensus(["spine", "hearing", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Proceed" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("accepted_all");
    expect(res.state.pendingConsensus).toBeNull();
  });

  it("auto-applies legacy_deferred for legacy systems and detected for structured systems on accept", () => {
    // ADR-0003 §4 fan-out model: accept_all writes legacy_deferred for legacy
    // candidates and detected for structured candidates so buildNextClaimStep
    // can route to them on subsequent turns.
    const state = withConsensus(["spine", "hearing", "cns", "visual"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Yes, proceed" });
    expect(res.action).toBe("accepted_all");
    expect(res.state.claimComponentOverrides.cns?.status).toBe("legacy_deferred");
    expect(res.state.claimComponentOverrides.visual?.status).toBe("legacy_deferred");
    // Structured systems get detected overrides (fan-out — not legacy_deferred).
    expect(res.state.claimComponentOverrides.spine?.status).toBe("detected");
    expect(res.state.claimComponentOverrides.spine?.source).toBe("semantic_consensus");
    expect(res.state.claimComponentOverrides.hearing?.status).toBe("detected");
    expect(res.state.claimComponentOverrides.hearing?.source).toBe("semantic_consensus");
  });

  it("matches a variety of affirmative phrasings", () => {
    for (const reply of ["Yes", "Looks good", "Continue", "OK", "Go ahead", "Sounds right"]) {
      const state = withConsensus(["spine"]);
      const res = tryResolvePendingConsensus({ state, replyText: reply });
      expect(res.action).toBe("accepted_all");
    }
  });

  it("emits semantic_interpretation_accepted audit event", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Proceed" });
    expect(res.auditEvent?.eventType).toBe("semantic_interpretation_accepted");
    expect(res.auditEvent?.payload.candidateSystems).toEqual(["spine", "hearing"]);
  });
});

describe("Slice D — accepted_system_first branch", () => {
  it("recognizes 'Hearing first' as accepted_system_first", () => {
    const state = withConsensus(["spine", "hearing", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Hearing first" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("accepted_system_first");
    expect(res.state.pendingConsensus).toBeNull();
  });

  it("recognizes 'Start with spine'", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Start with spine" });
    expect(res.action).toBe("accepted_system_first");
  });

  it("recognizes 'Assess lower limb first'", () => {
    const state = withConsensus(["lower_limb", "cns"]);
    const res = tryResolvePendingConsensus({
      state,
      replyText: "Assess lower limb first",
    });
    expect(res.action).toBe("accepted_system_first");
  });

  it("returns unresolved when 'first' is mentioned without a candidate system", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Do that one first" });
    expect(res.resolved).toBe(false);
    expect(res.action).toBe("unresolved");
    expect(res.response?.chips).toContain("Assess spine first");
    expect(res.response?.chips).toContain("Assess hearing first");
  });

  it("rejects a 'first' selection for a system not in candidate list", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Renal first" });
    // Renal not in candidates → no constrained match → unresolved
    expect(res.resolved).toBe(false);
    expect(res.action).toBe("unresolved");
  });

  it("priority: 'Yes, but start with hearing' beats accepted_all", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({
      state,
      replyText: "Yes, but start with hearing",
    });
    expect(res.action).toBe("accepted_system_first");
  });
});

describe("Slice D — edit_requested branch", () => {
  it("returns edit_requested on 'Edit'", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Edit" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("edit_requested");
    expect(res.state.pendingConsensus?.awaiting).toBe("edit_instruction");
    expect(res.response?.message).toContain("What should I change");
  });

  it("returns edit_requested on 'CNS is wrong'", () => {
    const state = withConsensus(["spine", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Actually CNS is wrong" });
    expect(res.action).toBe("edit_requested");
    expect(res.state.pendingConsensus?.awaiting).toBe("edit_instruction");
  });

  it("priority: 'Looks good except CNS is wrong' beats accepted_all", () => {
    const state = withConsensus(["spine", "cns"]);
    const res = tryResolvePendingConsensus({
      state,
      replyText: "Looks good except CNS is wrong",
    });
    expect(res.action).toBe("edit_requested");
  });
});

describe("Slice D — edit_instruction mode", () => {
  it("treats the entire reply as edit text and emits an audit event", () => {
    const state = withConsensus(["spine", "cns"], "edit_instruction");
    const res = tryResolvePendingConsensus({
      state,
      replyText: "It's actually a thoraco-lumbar fracture, not cervical, and ignore CNS",
    });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("edit_requested");
    expect(res.auditEvent?.eventType).toBe("semantic_interpretation_edited");
    expect(res.auditEvent?.payload.editInstruction).toContain("thoraco-lumbar");
    // pendingConsensus retained — the re-interpreter (Slice E) will replace it.
    expect(res.state.pendingConsensus).not.toBeNull();
    expect(res.state.pendingConsensus?.awaiting).toBe("edit_instruction");
  });
});

describe("Slice D — rejected branch", () => {
  it("returns rejected on 'Reject'", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Reject" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("rejected");
    expect(res.state.pendingConsensus).toBeNull();
  });

  it("matches 'Start over', 'Cancel', 'Not correct', 'That's wrong'", () => {
    for (const reply of ["Start over", "Cancel", "Not correct", "That's wrong"]) {
      const state = withConsensus(["spine"]);
      const res = tryResolvePendingConsensus({ state, replyText: reply });
      expect(res.action).toBe("rejected");
    }
  });

  it("does not write claim component overrides", () => {
    const state = withConsensus(["spine", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Reject" });
    expect(res.state.claimComponentOverrides).toEqual({});
  });
});

describe("Slice D — legacy_requested branch", () => {
  it("returns legacy_requested on 'Use legacy for CNS'", () => {
    const state = withConsensus(["spine", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Use legacy for CNS" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("legacy_requested");
    expect(res.state.claimComponentOverrides.cns?.status).toBe("legacy_deferred");
    expect(res.state.claimComponentOverrides.cns?.source).toBe("user_choice");
    expect(res.state.pendingConsensus).toBeNull();
  });

  it("returns unresolved when legacy keyword is present without a system name", () => {
    const state = withConsensus(["spine", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Use legacy mode" });
    expect(res.resolved).toBe(false);
    expect(res.response?.chips).toContain("Use legacy for cns");
  });

  it("priority: 'Proceed with legacy for CNS' beats accepted_all", () => {
    const state = withConsensus(["spine", "cns"]);
    const res = tryResolvePendingConsensus({
      state,
      replyText: "Proceed with legacy for CNS",
    });
    expect(res.action).toBe("legacy_requested");
  });
});

describe("Slice D — skipped_system branch", () => {
  it("returns skipped_system on 'Skip visual'", () => {
    const state = withConsensus(["spine", "visual"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Skip visual" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("skipped_system");
    expect(res.state.claimComponentOverrides.visual?.status).toBe("skipped_by_user");
  });

  it("removes the skipped system from candidateSystems when others remain", () => {
    const state = withConsensus(["spine", "hearing", "cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Skip CNS" });
    expect(res.action).toBe("skipped_system");
    expect(res.state.pendingConsensus).not.toBeNull();
    expect(res.state.pendingConsensus?.candidateSystems).toEqual(["spine", "hearing"]);
  });

  it("clears pendingConsensus when no candidates remain after the skip", () => {
    const state = withConsensus(["cns"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Skip CNS" });
    expect(res.state.pendingConsensus).toBeNull();
    expect(res.state.claimComponentOverrides.cns?.status).toBe("skipped_by_user");
  });

  it("returns unresolved when 'skip' is used without a system name", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Skip that one" });
    expect(res.resolved).toBe(false);
    expect(res.response?.chips).toContain("Skip spine");
  });

  it("redirects to exclusion when the system is already calculated", () => {
    let state = withConsensus(["spine", "hearing"]);
    // Mark hearing as calculated.
    state = {
      ...state,
      systems: {
        ...state.systems,
        hearing: { ...state.systems.hearing, status: "calculated", piPercent: 30 },
      },
    };
    const res = tryResolvePendingConsensus({ state, replyText: "Skip hearing" });
    expect(res.resolved).toBe(false);
    expect(res.response?.message).toContain("already been calculated");
    expect(res.response?.chips).toContain("Exclude hearing from combined PI");
  });
});

describe("Slice D — unresolved branch", () => {
  it("returns unresolved on 'Maybe later'", () => {
    const state = withConsensus(["spine", "hearing"]);
    const res = tryResolvePendingConsensus({ state, replyText: "Maybe later" });
    expect(res.resolved).toBe(false);
    expect(res.action).toBe("unresolved");
    expect(res.response?.chips).toEqual([
      "Proceed",
      "Edit interpretation",
      "Choose system first",
      "Reject",
    ]);
  });

  it("returns unresolved when no pendingConsensus is set", () => {
    const res = tryResolvePendingConsensus({
      state: defaultV2SessionState(),
      replyText: "Proceed",
    });
    expect(res.resolved).toBe(false);
    expect(res.action).toBe("unresolved");
  });
});

describe("Slice D — system constrained to candidates only", () => {
  it("does not allow the doctor to focus on a system outside the interpretation", () => {
    let state = withConsensus(["spine", "hearing"]);
    // Add a pre-existing override for renal (irrelevant here).
    state = setClaimComponentOverride(state, "renal", {
      status: "detected",
      source: "semantic_consensus",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const res = tryResolvePendingConsensus({
      state,
      replyText: "Start with renal",
    });
    expect(res.resolved).toBe(false);
    expect(res.action).toBe("unresolved");
    // Existing override unchanged.
    expect(res.state.claimComponentOverrides.renal?.status).toBe("detected");
  });
});
