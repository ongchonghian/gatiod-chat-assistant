// Phase A — wire post-calc handoff to the unified claim plan.
//
// Issue #12 / RC-1: the legacy `buildNextSystemHandoff` only sees systems
// that already have `extractedFacts` or `pendingObservations`. A second
// system that was semantically detected (recorded as a
// `claimComponentOverrides[X].status === "detected"`), or marked
// legacy_deferred / unsupported, used to disappear from the post-calc
// chain. After this slice, post-calc handoff is derived from
// `buildNextClaimStep`, which honours the full priority order.

import { describe, expect, it } from "vitest";
import { buildNextSystemHandoff } from "../../src/chat/chatServiceV2.js";
import {
  defaultV2SessionState,
  setClaimComponentOverride,
} from "../../src/v2/stateMachine.js";
import type { GatiodSystemKey, V2SessionState } from "../../src/v2/contracts.js";

const NOW = "2026-05-11T00:00:00.000Z";

function withCalculated(
  state: V2SessionState,
  system: GatiodSystemKey,
  pi: number,
): V2SessionState {
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...state.systems[system],
        status: "calculated",
        piPercent: pi,
        updatedAt: NOW,
      },
    },
  };
}

describe("Post-calc handoff via unified claim plan (issue #12, RC-1)", () => {
  it("picks up a system flagged as `detected` via claimComponentOverrides only", () => {
    // Spine just calculated; respiratory was semantically detected by the
    // consensus orchestrator but has no extracted facts and no pending
    // observations yet. The legacy handoff would skip respiratory; the
    // unified claim plan must surface it.
    let state = defaultV2SessionState();
    state = withCalculated(state, "spine", 30);
    state = setClaimComponentOverride(state, "respiratory", {
      status: "detected",
      reason: "semantically detected from utterance",
      source: "semantic_consensus",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const handoff = buildNextSystemHandoff(state, "spine");
    expect(handoff).toBeDefined();
    expect(handoff?.system).toBe("respiratory");
    expect(handoff?.appendMessage.toLowerCase()).toContain("respiratory");
  });

  it("does not auto-surface a sole legacy_deferred override (informational only)", () => {
    // Slice B contract (sliceB.claimPlan.test.ts:386): a sole legacy/deferred
    // component should not block the conversation; the doctor must take an
    // explicit action. Verifying the new wiring honours that.
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 22);
    state = setClaimComponentOverride(state, "cns", {
      status: "legacy_deferred",
      reason: "CNS structured V2 deferred",
      source: "system_registry",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const handoff = buildNextSystemHandoff(state, "upper_limb");
    expect(handoff).toBeUndefined();
  });

  it("returns undefined when no other system has any actionable signal", () => {
    const state = withCalculated(defaultV2SessionState(), "spine", 30);
    const handoff = buildNextSystemHandoff(state, "spine");
    expect(handoff).toBeUndefined();
  });

  it("does NOT pivot to a system that already calculated", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "spine", 30);
    state = withCalculated(state, "hearing", 18);
    const handoff = buildNextSystemHandoff(state, "spine");
    // Hearing is already calculated, so it should not be re-offered.
    expect(handoff?.system).not.toBe("hearing");
    // No other actionable system exists.
    expect(handoff).toBeUndefined();
  });
});
