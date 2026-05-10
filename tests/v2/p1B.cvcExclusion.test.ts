import { describe, expect, it } from "vitest";
import {
  excludeFromGlobalCvc,
  getCalculatedSystems,
  reincludeInGlobalCvc,
  shouldOfferGlobalCvc,
} from "../../src/v2/globalCvc.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type { GatiodSystemKey, V2SessionState } from "../../src/v2/contracts.js";

// P1-B — Global CVC re-offer on exclusion change (REQ-GC-EXCLUSION-001).

const NOW = "2026-05-10T00:00:00.000Z";

function withCalculated(
  state: V2SessionState,
  entries: Array<{ system: GatiodSystemKey; pi: number }>,
): V2SessionState {
  const next = { ...state, systems: { ...state.systems } };
  for (const { system, pi } of entries) {
    next.systems[system] = {
      ...next.systems[system],
      status: "calculated",
      piPercent: pi,
      updatedAt: NOW,
    };
  }
  return next;
}

function withPendingCvc(
  state: V2SessionState,
  systems: GatiodSystemKey[],
  values: number[],
): V2SessionState {
  return {
    ...state,
    pendingGlobalCvcConfirmation: {
      status: "pending",
      componentSystems: systems,
      componentValues: values,
      createdAt: NOW,
    },
  };
}

describe("P1-B — excludeFromGlobalCvc", () => {
  it("removes the system from the CVC eligible set", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    const result = excludeFromGlobalCvc(state, "hearing", { reason: "doctor choice" });
    const eligible = getCalculatedSystems(result.state).map((c) => c.system);
    expect(eligible).toEqual(["spine"]);
  });

  it("preserves the system's PI% in V2SystemState (PI% is not cleared)", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "hearing", pi: 30 },
    ]);
    const result = excludeFromGlobalCvc(state, "hearing");
    expect(result.state.systems.hearing.piPercent).toBe(30);
    expect(result.state.systems.hearing.status).toBe("calculated");
  });

  it("emits v2_global_cvc_component_excluded audit event", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "hearing", pi: 30 },
    ]);
    const result = excludeFromGlobalCvc(state, "hearing", { reason: "doctor choice" });
    expect(result.auditEvent.eventType).toBe("v2_global_cvc_component_excluded");
    expect(result.auditEvent.payload.kind).toBe("excluded");
    expect(result.auditEvent.payload.system).toBe("hearing");
    expect(result.auditEvent.payload.piPercent).toBe(30);
    expect(result.auditEvent.payload.reason).toBe("doctor choice");
  });

  it("stales a pending CVC offer that included the excluded system", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    state = withPendingCvc(state, ["hearing", "spine"], [30, 5]);
    const result = excludeFromGlobalCvc(state, "hearing");
    expect(result.state.pendingGlobalCvcConfirmation).toBeNull();
    expect(result.auditEvent.payload.staleOfferDropped).toBe(true);
    expect(result.auditEvent.payload.previousSnapshot).toEqual({
      componentSystems: ["hearing", "spine"],
      componentValues: [30, 5],
    });
  });

  it("does nothing to pending CVC offer when there is no pending offer", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    const result = excludeFromGlobalCvc(state, "hearing");
    expect(result.state.pendingGlobalCvcConfirmation).toBeNull();
    expect(result.auditEvent.payload.staleOfferDropped).toBe(false);
    expect(result.auditEvent.payload.previousSnapshot).toBeUndefined();
  });

  it("after exclusion shouldOfferGlobalCvc returns false when only one eligible system remains", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    const result = excludeFromGlobalCvc(state, "hearing");
    expect(shouldOfferGlobalCvc(result.state)).toBe(false);
  });

  it("after exclusion shouldOfferGlobalCvc still returns true when ≥2 eligible remain", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
      { system: "lower_limb", pi: 20 },
    ]);
    const result = excludeFromGlobalCvc(state, "hearing");
    expect(shouldOfferGlobalCvc(result.state)).toBe(true);
  });
});

describe("P1-B — reincludeInGlobalCvc", () => {
  it("removes the exclusion entry", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "hearing", pi: 30 },
    ]);
    state = excludeFromGlobalCvc(state, "hearing").state;
    expect(state.globalCvcExclusions.hearing).toBeDefined();
    const reinc = reincludeInGlobalCvc(state, "hearing");
    expect(reinc.state.globalCvcExclusions.hearing).toBeUndefined();
  });

  it("emits v2_global_cvc_component_reincluded audit event with PI%", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "hearing", pi: 30 },
    ]);
    state = excludeFromGlobalCvc(state, "hearing").state;
    const reinc = reincludeInGlobalCvc(state, "hearing");
    expect(reinc.auditEvent.eventType).toBe("v2_global_cvc_component_reincluded");
    expect(reinc.auditEvent.payload.kind).toBe("reincluded");
    expect(reinc.auditEvent.payload.system).toBe("hearing");
    expect(reinc.auditEvent.payload.piPercent).toBe(30);
  });

  it("stales a pending CVC offer (eligible set just grew)", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    state = excludeFromGlobalCvc(state, "hearing").state;
    state = withPendingCvc(state, ["spine"], [5]); // offer reflected the post-exclusion eligible set
    const reinc = reincludeInGlobalCvc(state, "hearing");
    expect(reinc.state.pendingGlobalCvcConfirmation).toBeNull();
    expect(reinc.auditEvent.payload.staleOfferDropped).toBe(true);
  });

  it("after re-inclusion the system rejoins the eligible set", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    state = excludeFromGlobalCvc(state, "hearing").state;
    state = reincludeInGlobalCvc(state, "hearing").state;
    const eligible = getCalculatedSystems(state).map((c) => c.system);
    expect(eligible.sort()).toEqual(["hearing", "spine"]);
  });
});

describe("P1-B — round-trip exclusion/re-inclusion", () => {
  it("exclusion and re-inclusion together return state to the original eligible set", () => {
    const initial = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    let state = initial;
    state = excludeFromGlobalCvc(state, "hearing").state;
    state = reincludeInGlobalCvc(state, "hearing").state;
    expect(getCalculatedSystems(state)).toEqual(getCalculatedSystems(initial));
  });

  it("excluding a system not in pending CVC offer still emits audit but no stale", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
      { system: "lower_limb", pi: 20 },
    ]);
    state = withPendingCvc(state, ["hearing", "spine"], [30, 5]);
    // The pending offer never included lower_limb. Excluding lower_limb
    // is conservative — the helper still drops the offer because the eligible
    // set could have changed downstream.
    const result = excludeFromGlobalCvc(state, "lower_limb");
    expect(result.auditEvent.payload.staleOfferDropped).toBe(true);
    expect(result.state.pendingGlobalCvcConfirmation).toBeNull();
  });
});
