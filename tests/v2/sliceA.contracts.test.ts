import { describe, expect, it } from "vitest";
import {
  coerceV2State,
  defaultV2SessionState,
  setClaimComponentOverride,
  setGlobalCvcExclusion,
  setPendingConsensus,
} from "../../src/v2/stateMachine.js";
import { getCalculatedSystems } from "../../src/v2/globalCvc.js";
import type {
  ClaimComponentOverride,
  GlobalCvcExclusion,
  PendingConsensus,
  V2SessionState,
} from "../../src/v2/contracts.js";

// Slice A — semantic consensus contracts and additive state hydration
// (ADR-0003). These tests lock in REQ-SC-STATE-001 and REQ-GC-EXCLUSION-001:
// new fields hydrate to safe defaults from old persisted state, and
// getCalculatedSystems() filters globalCvcExclusions.

describe("Slice A — defaultV2SessionState", () => {
  it("includes the three new ADR-0003 fields with safe defaults", () => {
    const state = defaultV2SessionState();
    expect(state.pendingConsensus).toBeNull();
    expect(state.claimComponentOverrides).toEqual({});
    expect(state.globalCvcExclusions).toEqual({});
  });
});

describe("Slice A — coerceV2State hydration of additive fields", () => {
  it("hydrates a pre-Slice-A persisted state to null/empty for new fields", () => {
    // Simulate a persisted envelope from before the new fields existed.
    const oldPersisted = {
      v2: {
        version: 1 as const,
        systems: defaultV2SessionState().systems,
        instancesBySystem: {},
        pendingClarification: null,
        pendingConfirmation: null,
        pendingGlobalCvcConfirmation: null,
        // pendingConsensus, claimComponentOverrides, globalCvcExclusions absent
      },
    };
    const hydrated = coerceV2State(oldPersisted);
    expect(hydrated.pendingConsensus).toBeNull();
    expect(hydrated.claimComponentOverrides).toEqual({});
    expect(hydrated.globalCvcExclusions).toEqual({});
  });

  it("preserves a valid pendingConsensus across hydration", () => {
    const consensus: PendingConsensus = {
      interpretationId: "interp-1",
      interpretationHash: "hash-i",
      sourceHash: "hash-s",
      sourceText: "left common peroneal nerve lesion; complete anosmia",
      message: "Detected lower_limb + cns",
      candidateSystems: ["lower_limb", "cns"],
      createdAt: "2026-05-10T00:00:00.000Z",
      awaiting: "decision",
    };
    const persisted = {
      v2: { ...defaultV2SessionState(), pendingConsensus: consensus },
    };
    const hydrated = coerceV2State(persisted);
    expect(hydrated.pendingConsensus).toEqual(consensus);
  });

  it("coerces a malformed pendingConsensus to null rather than throwing", () => {
    const persisted = {
      v2: {
        ...defaultV2SessionState(),
        pendingConsensus: { not: "valid" } as unknown,
      },
    };
    const hydrated = coerceV2State(persisted);
    expect(hydrated.pendingConsensus).toBeNull();
  });

  it("filters claimComponentOverrides for unknown systems and invalid statuses", () => {
    const persisted = {
      v2: {
        ...defaultV2SessionState(),
        claimComponentOverrides: {
          cns: {
            status: "legacy_deferred",
            reason: "CNS structured V2 deferred",
            source: "semantic_consensus",
            createdAt: "2026-05-10T00:00:00.000Z",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
          unknown_system: { status: "legacy_deferred", createdAt: "x", updatedAt: "x" },
          spine: { status: "not_a_real_status", createdAt: "x", updatedAt: "x" },
        } as unknown,
      },
    };
    const hydrated = coerceV2State(persisted);
    expect(hydrated.claimComponentOverrides.cns).toBeDefined();
    expect(hydrated.claimComponentOverrides.spine).toBeUndefined();
    expect(
      (hydrated.claimComponentOverrides as Record<string, unknown>).unknown_system,
    ).toBeUndefined();
  });

  it("filters globalCvcExclusions for unknown systems and missing source", () => {
    const persisted = {
      v2: {
        ...defaultV2SessionState(),
        globalCvcExclusions: {
          hearing: {
            excludedAt: "2026-05-10T00:00:00.000Z",
            source: "user_choice",
            reason: "doctor excluded hearing",
          },
          spine: { excludedAt: "x", source: "not_user_choice" },
        } as unknown,
      },
    };
    const hydrated = coerceV2State(persisted);
    expect(hydrated.globalCvcExclusions.hearing).toBeDefined();
    expect(hydrated.globalCvcExclusions.spine).toBeUndefined();
  });
});

describe("Slice A — setter helpers", () => {
  it("setPendingConsensus sets and clears pendingConsensus", () => {
    const consensus: PendingConsensus = {
      interpretationId: "i1",
      interpretationHash: "h1",
      sourceHash: "h2",
      sourceText: "x",
      message: "m",
      candidateSystems: ["spine"],
      createdAt: "2026-05-10T00:00:00.000Z",
      awaiting: "decision",
    };
    const set = setPendingConsensus(defaultV2SessionState(), consensus);
    expect(set.pendingConsensus).toEqual(consensus);
    const cleared = setPendingConsensus(set, null);
    expect(cleared.pendingConsensus).toBeNull();
  });

  it("setClaimComponentOverride sets, replaces, and removes per-system overrides", () => {
    const override: ClaimComponentOverride = {
      status: "legacy_deferred",
      source: "semantic_consensus",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    let state = setClaimComponentOverride(defaultV2SessionState(), "cns", override);
    expect(state.claimComponentOverrides.cns).toEqual(override);
    state = setClaimComponentOverride(state, "cns", null);
    expect(state.claimComponentOverrides.cns).toBeUndefined();
  });

  it("setGlobalCvcExclusion sets and removes per-system exclusions", () => {
    const exclusion: GlobalCvcExclusion = {
      excludedAt: "2026-05-10T00:00:00.000Z",
      source: "user_choice",
      reason: "doctor choice",
    };
    let state = setGlobalCvcExclusion(defaultV2SessionState(), "hearing", exclusion);
    expect(state.globalCvcExclusions.hearing).toEqual(exclusion);
    state = setGlobalCvcExclusion(state, "hearing", null);
    expect(state.globalCvcExclusions.hearing).toBeUndefined();
  });
});

describe("Slice A — getCalculatedSystems honours globalCvcExclusions", () => {
  function withCalculated(
    state: V2SessionState,
    entries: Array<{ system: keyof V2SessionState["systems"]; pi: number }>,
  ): V2SessionState {
    const next = { ...state, systems: { ...state.systems } };
    for (const { system, pi } of entries) {
      next.systems[system] = {
        ...next.systems[system],
        status: "calculated",
        piPercent: pi,
        updatedAt: "2026-05-10T00:00:00.000Z",
      };
    }
    return next;
  }

  it("includes calculated systems when no exclusions are set", () => {
    const state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    const calc = getCalculatedSystems(state);
    expect(calc.map((c) => c.system)).toEqual(["hearing", "spine"]);
  });

  it("excludes a system listed in globalCvcExclusions even though it is calculated", () => {
    let state = withCalculated(defaultV2SessionState(), [
      { system: "spine", pi: 5 },
      { system: "hearing", pi: 30 },
    ]);
    state = setGlobalCvcExclusion(state, "hearing", {
      excludedAt: "2026-05-10T00:00:00.000Z",
      source: "user_choice",
    });
    const calc = getCalculatedSystems(state);
    expect(calc.map((c) => c.system)).toEqual(["spine"]);
    // PI% remains in V2SystemState — only CVC eligibility is removed.
    expect(state.systems.hearing.piPercent).toBe(30);
  });
});
