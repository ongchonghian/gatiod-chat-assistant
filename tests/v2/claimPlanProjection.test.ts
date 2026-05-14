import { describe, expect, it } from "vitest";
import { projectClaimPlan } from "../../src/v2/claimPlanProjection.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type {
  GatiodSystemKey,
  V2AssessmentInstance,
  V2SessionState,
} from "../../src/v2/contracts.js";

function instanceFor(
  system: GatiodSystemKey,
  slotPath: string[],
  piPercent: number,
): V2AssessmentInstance {
  return {
    instanceId: [system, ...slotPath].join("::"),
    system,
    slotPath,
    facts: {},
    pendingObservations: [],
    confirmation: { status: "confirmed", factsHash: "h" },
    status: "calculated",
    piPercent,
    trace: null,
    updatedAt: new Date().toISOString(),
  };
}

function withDetected(state: V2SessionState, system: GatiodSystemKey): V2SessionState {
  return {
    ...state,
    detectionOrder: [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "collecting", updatedAt: new Date().toISOString() },
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
      [system]: {
        ...state.systems[system],
        status: "calculated",
        piPercent,
        completeness: 1,
        updatedAt: new Date().toISOString(),
      },
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

describe("projectClaimPlan", () => {
  describe("empty / pre-detection state", () => {
    it("returns no pills, hidden Submit, not submitted when no system has been detected", () => {
      const view = projectClaimPlan(defaultV2SessionState());
      expect(view.systems).toEqual([]);
      expect(view.submitState.visible).toBe(false);
      expect(view.isSubmitted).toBe(false);
      expect(view.nextSystem).toBeUndefined();
    });
  });

  describe("single-system claim", () => {
    it("renders one collecting pill with no subtotal, Submit hidden", () => {
      const state = withDetected(defaultV2SessionState(), "upper_limb");
      const view = projectClaimPlan(state);

      expect(view.systems).toHaveLength(1);
      expect(view.systems[0].system).toBe("upper_limb");
      expect(view.systems[0].label).toBe("Upper Limb");
      expect(view.systems[0].status).toBe("collecting");
      expect(view.systems[0].subtotalPercent).toBeNull();
      expect(view.submitState.visible).toBe(false);
      expect(view.submitState.blockingSystems).toEqual(["upper_limb"]);
    });

    it("renders one calculated pill with subtotal, Submit visible", () => {
      const state = withCalculated(defaultV2SessionState(), "upper_limb", 12);
      const view = projectClaimPlan(state);

      expect(view.systems).toHaveLength(1);
      expect(view.systems[0].status).toBe("calculated");
      expect(view.systems[0].subtotalPercent).toBe(12);
      expect(view.submitState.visible).toBe(true);
      expect(view.submitState.blockingSystems).toBeUndefined();
    });

    it("treats skipped_by_user as a terminal status for Submit eligibility", () => {
      const state = withSkipped(defaultV2SessionState(), "cns");
      const view = projectClaimPlan(state);

      expect(view.systems).toHaveLength(1);
      expect(view.systems[0].status).toBe("skipped_by_user");
      expect(view.systems[0].subtotalPercent).toBeNull();
      expect(view.submitState.visible).toBe(true);
    });
  });

  describe("submit eligibility — ADR-0006 strict rule", () => {
    it("hides Submit when any detected system is in collecting", () => {
      let state = defaultV2SessionState();
      state = withCalculated(state, "upper_limb", 12);
      state = withDetected(state, "spine");

      const view = projectClaimPlan(state);

      expect(view.submitState.visible).toBe(false);
      expect(view.submitState.blockingSystems).toEqual(["spine"]);
      expect(view.nextSystem).toBe("spine");
    });

    it("shows Submit when every detected system is calculated", () => {
      let state = defaultV2SessionState();
      state = withCalculated(state, "upper_limb", 12);
      state = withCalculated(state, "spine", 8);
      state = withCalculated(state, "hearing", 5);

      const view = projectClaimPlan(state);

      expect(view.systems).toHaveLength(3);
      expect(view.submitState.visible).toBe(true);
      expect(view.submitState.blockingSystems).toBeUndefined();
    });

    it("shows Submit when every detected system is calculated OR skipped_by_user", () => {
      let state = defaultV2SessionState();
      state = withCalculated(state, "upper_limb", 12);
      state = withSkipped(state, "cns");

      const view = projectClaimPlan(state);

      expect(view.submitState.visible).toBe(true);
    });
  });

  describe("detection order preservation", () => {
    it("returns pills in the order systems were detected, regardless of systems[] insertion order", () => {
      let state = defaultV2SessionState();
      state = withDetected(state, "hearing");
      state = withDetected(state, "upper_limb");
      state = withDetected(state, "spine");

      const view = projectClaimPlan(state);

      expect(view.systems.map((p) => p.system)).toEqual(["hearing", "upper_limb", "spine"]);
    });
  });

  describe("multi-system fixtures (slice #03)", () => {
    it("renders 3-system mixed-status fixture in detection order with correct statuses", () => {
      let state = defaultV2SessionState();
      state = withCalculated(state, "upper_limb", 12);
      state = withDetected(state, "spine");
      state = withSkipped(state, "cns");

      const view = projectClaimPlan(state);

      expect(view.systems.map((p) => ({ s: p.system, st: p.status, v: p.subtotalPercent }))).toEqual([
        { s: "upper_limb", st: "calculated", v: 12 },
        { s: "spine",      st: "collecting", v: null },
        { s: "cns",        st: "skipped_by_user", v: null },
      ]);
      expect(view.submitState.visible).toBe(false);
      expect(view.submitState.blockingSystems).toEqual(["spine"]);
      expect(view.nextSystem).toBe("spine");
    });

    it("renders all 9 systems with the right statuses and shows Submit when fully resolved", () => {
      const all: GatiodSystemKey[] = [
        "upper_limb", "lower_limb", "spine", "respiratory", "renal",
        "gastro_digestive", "hearing", "cns", "visual",
      ];
      let state = defaultV2SessionState();
      for (const s of all) state = withCalculated(state, s, 5);

      const view = projectClaimPlan(state);

      expect(view.systems).toHaveLength(9);
      expect(view.systems.map((p) => p.system)).toEqual(all);
      expect(view.systems.every((p) => p.status === "calculated")).toBe(true);
      expect(view.submitState.visible).toBe(true);
    });
  });

  describe("bilateral sideBreakdown (slice #03)", () => {
    function withInstances(
      state: V2SessionState,
      system: GatiodSystemKey,
      instances: V2AssessmentInstance[],
    ): V2SessionState {
      return {
        ...state,
        instancesBySystem: { ...state.instancesBySystem, [system]: instances },
      };
    }

    it("populates sideBreakdown with both sides when instances exist on left and right", () => {
      let state = withCalculated(defaultV2SessionState(), "upper_limb", 18);
      state = withInstances(state, "upper_limb", [
        instanceFor("upper_limb", ["left", "shoulder"], 10),
        instanceFor("upper_limb", ["right", "elbow"], 8),
      ]);

      const view = projectClaimPlan(state);
      const pill = view.systems.find((p) => p.system === "upper_limb")!;
      expect(pill.sideBreakdown).toEqual({ left: 10, right: 8 });
    });

    it("omits sideBreakdown when only one side has instances (unilateral)", () => {
      let state = withCalculated(defaultV2SessionState(), "upper_limb", 10);
      state = withInstances(state, "upper_limb", [
        instanceFor("upper_limb", ["left", "shoulder"], 10),
      ]);

      const view = projectClaimPlan(state);
      const pill = view.systems.find((p) => p.system === "upper_limb")!;
      expect(pill.sideBreakdown).toBeUndefined();
    });

    it("omits sideBreakdown for non-hierarchical systems (e.g. spine has region slots, not sides)", () => {
      let state = withCalculated(defaultV2SessionState(), "spine", 8);
      state = withInstances(state, "spine", [
        instanceFor("spine", ["cervical"], 4),
        instanceFor("spine", ["lumbo_sacral"], 4),
      ]);

      const view = projectClaimPlan(state);
      const pill = view.systems.find((p) => p.system === "spine")!;
      expect(pill.sideBreakdown).toBeUndefined();
    });

    it("only counts CALCULATED instances toward sideBreakdown (skips collecting ones)", () => {
      let state = withCalculated(defaultV2SessionState(), "lower_limb", 8);
      state = withInstances(state, "lower_limb", [
        instanceFor("lower_limb", ["left", "knee"], 8),
        {
          ...instanceFor("lower_limb", ["right", "knee"], 0),
          status: "collecting",
          piPercent: null,
        },
      ]);

      const view = projectClaimPlan(state);
      const pill = view.systems.find((p) => p.system === "lower_limb")!;
      expect(pill.sideBreakdown).toBeUndefined();
    });
  });

  // Note: tests for claimSubmittedAt-driven isSubmitted state land in slice #07
  // (Submit primitive); tests for isLegacyMode pill rendering land in slice #05
  // (transitional CNS/Visual pill class). The fields exist in the projection
  // output from this slice forward so the later slices only need to add tests.
});
