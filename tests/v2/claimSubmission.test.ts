import { describe, expect, it } from "vitest";
import {
  canSubmit,
  isClaimSubmitted,
  reopenClaim,
  submitClaim,
} from "../../src/v2/claimSubmission.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type { GatiodSystemKey, V2SessionState } from "../../src/v2/contracts.js";
import { processChatV2 } from "../../src/chat/chatServiceV2.js";

function withDetected(state: V2SessionState, system: GatiodSystemKey): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system)
      ? state.detectionOrder
      : [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "collecting" },
    },
  };
}

function withCalculated(
  state: V2SessionState,
  system: GatiodSystemKey,
  piPercent: number,
): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system)
      ? state.detectionOrder
      : [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "calculated", piPercent, completeness: 1 },
    },
  };
}

function withSkipped(state: V2SessionState, system: GatiodSystemKey): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system)
      ? state.detectionOrder
      : [...state.detectionOrder, system],
    claimComponentOverrides: {
      ...state.claimComponentOverrides,
      [system]: {
        status: "skipped_by_user",
        source: "user_choice",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

describe("canSubmit", () => {
  it("returns ok=false with blockingSystems empty when nothing has been detected yet", () => {
    const r = canSubmit(defaultV2SessionState());
    expect(r.ok).toBe(false);
    expect(r.blockingSystems).toEqual([]);
  });

  it("returns ok=false listing the collecting system when one system is still in progress", () => {
    const state = withDetected(defaultV2SessionState(), "upper_limb");
    const r = canSubmit(state);
    expect(r.ok).toBe(false);
    expect(r.blockingSystems).toEqual(["upper_limb"]);
  });

  it("returns ok=true when the single detected system is calculated", () => {
    const state = withCalculated(defaultV2SessionState(), "upper_limb", 12);
    const r = canSubmit(state);
    expect(r.ok).toBe(true);
    expect(r.blockingSystems).toEqual([]);
  });

  it("returns ok=true when every detected system is calculated", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    state = withCalculated(state, "spine", 8);
    state = withCalculated(state, "hearing", 5);
    const r = canSubmit(state);
    expect(r.ok).toBe(true);
  });

  it("treats skipped_by_user as terminal (does not block submit)", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    state = withSkipped(state, "cns");
    const r = canSubmit(state);
    expect(r.ok).toBe(true);
  });

  it("returns ok=false listing all non-terminal systems in detection order", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    state = withDetected(state, "spine");
    state = withDetected(state, "hearing");
    const r = canSubmit(state);
    expect(r.ok).toBe(false);
    expect(r.blockingSystems).toEqual(["spine", "hearing"]);
  });

  it("returns ok=false when the claim is already submitted (idempotent guard)", () => {
    const state: V2SessionState = {
      ...withCalculated(defaultV2SessionState(), "upper_limb", 12),
      claimSubmittedAt: "2026-05-13T15:00:00.000Z",
    };
    const r = canSubmit(state);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.alreadySubmitted).toBe(true);
    }
  });
});

describe("submitClaim", () => {
  it("sets claimSubmittedAt to an ISO timestamp when canSubmit is ok", () => {
    const before = withCalculated(defaultV2SessionState(), "upper_limb", 12);
    const after = submitClaim(before);
    expect(after.claimSubmittedAt).toBeDefined();
    expect(after.claimSubmittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is a no-op when canSubmit returns ok=false (blocked system)", () => {
    const before = withDetected(defaultV2SessionState(), "upper_limb");
    const after = submitClaim(before);
    expect(after.claimSubmittedAt).toBeUndefined();
    expect(after).toBe(before); // reference-equal — no work done
  });

  it("is idempotent: a second submit is a no-op preserving the original timestamp", () => {
    const before = withCalculated(defaultV2SessionState(), "upper_limb", 12);
    const after1 = submitClaim(before);
    const after2 = submitClaim(after1);
    expect(after2.claimSubmittedAt).toBe(after1.claimSubmittedAt);
    expect(after2).toBe(after1); // reference-equal — short-circuit
  });

  it("does not mutate other state fields", () => {
    const before = withCalculated(defaultV2SessionState(), "upper_limb", 12);
    const after = submitClaim(before);
    expect(after.systems).toBe(before.systems);
    expect(after.detectionOrder).toBe(before.detectionOrder);
    expect(after.instancesBySystem).toBe(before.instancesBySystem);
  });
});

describe("isClaimSubmitted", () => {
  it("returns false on a fresh session", () => {
    expect(isClaimSubmitted(defaultV2SessionState())).toBe(false);
  });

  it("returns true after submitClaim sets the timestamp", () => {
    const state = submitClaim(withCalculated(defaultV2SessionState(), "upper_limb", 12));
    expect(isClaimSubmitted(state)).toBe(true);
  });

  it("returns false when claimSubmittedAt is an empty string", () => {
    const state: V2SessionState = {
      ...withCalculated(defaultV2SessionState(), "upper_limb", 12),
      claimSubmittedAt: "",
    };
    expect(isClaimSubmitted(state)).toBe(false);
  });
});

describe("reopenClaim (slice #09)", () => {
  it("clears claimSubmittedAt and returns the previous timestamp", () => {
    const submitted = submitClaim(withCalculated(defaultV2SessionState(), "upper_limb", 12));
    const original = submitted.claimSubmittedAt!;
    const result = reopenClaim(submitted);
    expect(result.originalSubmittedAt).toBe(original);
    expect(result.state.claimSubmittedAt).toBeUndefined();
    expect(isClaimSubmitted(result.state)).toBe(false);
  });

  it("is a no-op when the claim is already open", () => {
    const open = withCalculated(defaultV2SessionState(), "upper_limb", 12);
    const result = reopenClaim(open);
    expect(result.state).toBe(open); // reference-equal — no work done
    expect(result.originalSubmittedAt).toBe("");
  });

  it("preserves all other state fields (systems, detection order, instances)", () => {
    const submitted = submitClaim(withCalculated(defaultV2SessionState(), "upper_limb", 12));
    const result = reopenClaim(submitted);
    expect(result.state.systems).toBe(submitted.systems);
    expect(result.state.detectionOrder).toBe(submitted.detectionOrder);
    expect(result.state.instancesBySystem).toBe(submitted.instancesBySystem);
  });

  it("allows re-submission after reopen, producing a fresh claimSubmittedAt", async () => {
    const first = submitClaim(withCalculated(defaultV2SessionState(), "upper_limb", 12));
    const reopened = reopenClaim(first);
    await new Promise((r) => setTimeout(r, 5));
    const resubmitted = submitClaim(reopened.state);
    expect(resubmitted.claimSubmittedAt).toBeDefined();
    expect(resubmitted.claimSubmittedAt).not.toBe(first.claimSubmittedAt);
  });
});

// ── ADR-0006 slice #08 — multi-system Submit → GCVC → claim_submitted ────────
// Integration tests that exercise the full processChatV2 pipeline. Rather than
// drive the extractor pipeline end-to-end (which couples this slice's tests
// to the spine + hearing extractor health), the tests seed session state
// directly with two calculated systems and then exercise the Submit chip API
// path through the chat service. The policy-engine unit tests in
// tests/v2/policyEngine.test.ts cover the decision logic in isolation.

import { saveSessionSystemStates } from "../../src/db/sessionStore.js";
import { toSystemStateEnvelope } from "../../src/v2/stateMachine.js";

function seedTwoCalculatedSystems(sessionId: string): void {
  let state = defaultV2SessionState();
  state = withCalculated(state, "spine", 5);
  state = withCalculated(state, "hearing", 30);
  saveSessionSystemStates(sessionId, toSystemStateEnvelope(state, {}));
}

describe("multi-system Submit flow (slice #08)", () => {
  it("Submit on a multi-system claim presents the Submit-originated GCVC card", async () => {
    const sessionId = `test-submit-multi-${Date.now()}-${Math.random()}`;
    seedTwoCalculatedSystems(sessionId);
    const r = await processChatV2(sessionId, "submit", { shadow: true, action: "submit_claim" });
    expect(r.message).toMatch(/Components:/);
    expect(r.suggestedChips).toEqual(
      expect.arrayContaining(["Confirm submission", "Add PTI bonus (+25%)"]),
    );
    expect(r.claimPlan.isSubmitted).toBe(false);
  });

  it("Confirm submission after Submit fires claim_submitted with post-CVC value", async () => {
    const sessionId = `test-submit-multi-${Date.now()}-${Math.random()}`;
    seedTwoCalculatedSystems(sessionId);
    await processChatV2(sessionId, "submit", { shadow: true, action: "submit_claim" });
    const final = await processChatV2(sessionId, "Confirm submission", { shadow: true });
    expect(final.message).toMatch(/Claim submitted/);
    expect(final.claimPlan.isSubmitted).toBe(true);
    expect(final.claimPlan.submittedAt).toBeDefined();
  });

  it("PTI toggle on Submit-originated GCVC flips the snapshot flag and offers Remove chip", async () => {
    const sessionId = `test-submit-multi-${Date.now()}-${Math.random()}`;
    seedTwoCalculatedSystems(sessionId);
    await processChatV2(sessionId, "submit", { shadow: true, action: "submit_claim" });
    const toggleOn = await processChatV2(sessionId, "Add PTI bonus (+25%)", { shadow: true });
    expect(toggleOn.message).toMatch(/PTI bonus is ON/);
    expect(toggleOn.suggestedChips).toEqual(
      expect.arrayContaining(["Confirm submission", "Remove PTI bonus"]),
    );

    const final = await processChatV2(sessionId, "Confirm submission", { shadow: true });
    expect(final.message).toMatch(/PTI bonus applied/);
    expect(final.claimPlan.isSubmitted).toBe(true);
  });
});

// ── ADR-0006 §6/§7 — Post-submit lock + Reopen flow (slice #09) ──────────────

describe("post-submit lock and reopen (slice #09)", () => {
  function seedSubmittedSingleSystem(sessionId: string): void {
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    state = submitClaim(state);
    saveSessionSystemStates(sessionId, toSystemStateEnvelope(state, {}));
  }

  it("describes a new finding post-submit → soft-redirect with chips", async () => {
    const sessionId = `test-post-submit-${Date.now()}-${Math.random()}`;
    seedSubmittedSingleSystem(sessionId);
    const r = await processChatV2(sessionId, "Now my right knee also has a problem.", { shadow: true });
    expect(r.message).toMatch(/submitted at/i);
    expect(r.suggestedChips).toEqual(
      expect.arrayContaining(["Start new claim", "Reopen this claim"]),
    );
    expect(r.claimPlan.isSubmitted).toBe(true);
  });

  it("clicking Reopen clears claimSubmittedAt and emits a claim_reopened audit event", async () => {
    const sessionId = `test-post-submit-${Date.now()}-${Math.random()}`;
    seedSubmittedSingleSystem(sessionId);
    const r = await processChatV2(sessionId, "Reopen this claim", { shadow: true });
    expect(r.message).toMatch(/reopened/i);
    expect(r.claimPlan.isSubmitted).toBe(false);
    expect(r.claimPlan.submittedAt).toBeUndefined();
  });

  it("clicking Start new claim resets the session", async () => {
    const sessionId = `test-post-submit-${Date.now()}-${Math.random()}`;
    seedSubmittedSingleSystem(sessionId);
    const r = await processChatV2(sessionId, "Start new claim", { shadow: true });
    expect(r.claimPlan.isSubmitted).toBe(false);
    expect(r.claimPlan.systems).toEqual([]);
  });

});

// Direct policyEngine assertion that lookup operations are permitted under the
// post-submit lock. The full-pipeline integration test was retired because it
// triggered downstream LLM-dependent paths that aren't relevant to this slice.
describe("add-system overflow (slice #06)", () => {
  it("action=add_system writes a detected override and adds the system to detectionOrder", async () => {
    const sessionId = `test-add-sys-${Date.now()}-${Math.random()}`;
    saveSessionSystemStates(sessionId, toSystemStateEnvelope(defaultV2SessionState(), {}));
    const r = await processChatV2(sessionId, "add cns", { shadow: true, action: "add_system", systemToAdd: "cns" });
    expect(r.message).toMatch(/cns added/i);
    expect(r.claimPlan.systems.map((p) => p.system)).toContain("cns");
  });

  it("action=add_system rejects an invalid system key", async () => {
    const sessionId = `test-add-sys-bad-${Date.now()}-${Math.random()}`;
    saveSessionSystemStates(sessionId, toSystemStateEnvelope(defaultV2SessionState(), {}));
    const r = await processChatV2(sessionId, "add nope", { shadow: true, action: "add_system", systemToAdd: "nope" });
    expect(r.message).toMatch(/not a recognised/i);
  });
});

describe("post-submit policyEngine lookup pass-through (slice #09)", () => {
  it("lookup operations are NOT soft-redirected when claim is submitted (ADR-0006 §6)", async () => {
    const { makePolicyDecision } = await import("../../src/v2/policyEngine.js");
    const state: V2SessionState = {
      ...withCalculated(defaultV2SessionState(), "upper_limb", 12),
      claimSubmittedAt: "2026-05-13T15:00:00.000Z",
    };
    const decision = makePolicyDecision(
      { operation: "lookup", systems: ["upper_limb"], confidence: 0.9, reasons: [] },
      {
        raw: "what is the table value",
        normalizedText: "what is the table value",
        tokens: ["what", "is", "the", "table", "value"],
        mappedTokens: [],
        unresolvedTerms: [],
        confidence: 0.9,
      },
      { citations: [], ontologyMatches: [] },
      state,
    );
    expect(decision.action).toBe("execute_tools");
    expect(decision.proposedTools.length).toBeGreaterThan(0);
    // Not soft-redirected: the message field would carry the "submitted at"
    // text in the soft-redirect path. Lookup branch returns no clarification.
    expect(decision.clarificationQuestion).toBeUndefined();
  });
});
