import { describe, expect, it } from "vitest";
import {
  buildNextClaimStep,
  deriveActiveClaimComponents,
  deriveClaimAssessmentComponents,
} from "../../src/v2/claimPlan.js";
import {
  defaultV2SessionState,
  setClaimComponentOverride,
  setGlobalCvcExclusion,
} from "../../src/v2/stateMachine.js";
import type {
  ExtractedFact,
  GatiodSystemKey,
  PendingObservation,
  V2SessionState,
} from "../../src/v2/contracts.js";

// Slice B — unified claim plan derivation and next-step rendering
// (ADR-0003, REQ-MS-PLAN-001). These tests verify:
//  - derivation priority order
//  - override visibility (legacy_deferred / unsupported / skipped / detected)
//  - calculated-with-exclusion exposes excludedFromGlobalCvc
//  - compact rendering for 1-2 active systems vs structured plan for 3+
//  - Global CVC offer when ≥2 positive subtotals remain after exclusions

const NOW = "2026-05-10T00:00:00.000Z";

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

function withConfirmation(
  state: V2SessionState,
  system: GatiodSystemKey,
  status: "pending" | "confirmed",
): V2SessionState {
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...state.systems[system],
        confirmation: { status, confirmedAt: status === "confirmed" ? NOW : undefined },
        updatedAt: NOW,
      },
    },
  };
}

function withPendingObservation(
  state: V2SessionState,
  system: GatiodSystemKey,
  obs: PendingObservation,
): V2SessionState {
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...state.systems[system],
        pendingObservations: [obs],
        updatedAt: NOW,
      },
    },
  };
}

function withExtractedFact(
  state: V2SessionState,
  system: GatiodSystemKey,
  key: string,
  value: unknown,
): V2SessionState {
  const fact: ExtractedFact<unknown> = {
    value,
    sourceText: "test",
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

describe("Slice B — deriveClaimAssessmentComponents priority order", () => {
  it("returns idle for an empty state", () => {
    const components = deriveClaimAssessmentComponents(defaultV2SessionState());
    expect(components).toHaveLength(9);
    for (const c of components) {
      expect(c.status).toBe("idle");
    }
  });

  it("legacy_deferred override beats raw V2SystemState", () => {
    let state = defaultV2SessionState();
    state = setClaimComponentOverride(state, "cns", {
      status: "legacy_deferred",
      reason: "CNS structured V2 deferred",
      source: "semantic_consensus",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const components = deriveClaimAssessmentComponents(state);
    const cns = components.find((c) => c.system === "cns");
    expect(cns?.status).toBe("legacy_deferred");
    expect(cns?.reason).toBe("CNS structured V2 deferred");
    expect(cns?.source).toBe("semantic_consensus");
  });

  it("skipped_by_user override beats anything (even calculated)", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "visual", 10);
    state = setClaimComponentOverride(state, "visual", {
      status: "skipped_by_user",
      reason: "doctor declined",
      source: "user_choice",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const components = deriveClaimAssessmentComponents(state);
    const visual = components.find((c) => c.system === "visual");
    expect(visual?.status).toBe("skipped_by_user");
  });

  it("calculated wins when no override is set", () => {
    const state = withCalculated(defaultV2SessionState(), "hearing", 30);
    const components = deriveClaimAssessmentComponents(state);
    const hearing = components.find((c) => c.system === "hearing");
    expect(hearing?.status).toBe("calculated");
    expect(hearing?.piPercent).toBe(30);
    expect(hearing?.excludedFromGlobalCvc).toBeUndefined();
  });

  it("calculated + globalCvcExclusion exposes excludedFromGlobalCvc badge", () => {
    let state = withCalculated(defaultV2SessionState(), "hearing", 30);
    state = setGlobalCvcExclusion(state, "hearing", {
      excludedAt: NOW,
      source: "user_choice",
      reason: "doctor excluded",
    });
    const components = deriveClaimAssessmentComponents(state);
    const hearing = components.find((c) => c.system === "hearing");
    expect(hearing?.status).toBe("calculated");
    expect(hearing?.excludedFromGlobalCvc).toBe(true);
    expect(hearing?.exclusionReason).toBe("doctor excluded");
  });

  it("confirmation_pending derives from V2SystemConfirmation.status === pending", () => {
    const state = withConfirmation(defaultV2SessionState(), "spine", "pending");
    const components = deriveClaimAssessmentComponents(state);
    const spine = components.find((c) => c.system === "spine");
    expect(spine?.status).toBe("confirmation_pending");
  });

  it("needs_clarification derives from a pending observation", () => {
    const obs: PendingObservation = {
      id: "obs-1",
      system: "lower_limb",
      type: "nerve_deficit",
      sourceText: "common peroneal nerve lesion",
      parsed: {},
      missingFields: ["lossType"],
      clarificationQuestion: "Is the loss partial or total?",
      candidateAnswers: ["Partial", "Total"],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObservation(defaultV2SessionState(), "lower_limb", obs);
    const components = deriveClaimAssessmentComponents(state);
    const lower = components.find((c) => c.system === "lower_limb");
    expect(lower?.status).toBe("needs_clarification");
    expect(lower?.pendingQuestion).toBe("Is the loss partial or total?");
    expect(lower?.missingFields).toEqual(["lossType"]);
  });

  it("detected derives from a 'detected' override even with no facts", () => {
    let state = defaultV2SessionState();
    state = setClaimComponentOverride(state, "renal", {
      status: "detected",
      reason: "Doctor accepted but not yet extracted",
      source: "semantic_consensus",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const components = deriveClaimAssessmentComponents(state);
    const renal = components.find((c) => c.system === "renal");
    expect(renal?.status).toBe("detected");
  });
});

describe("Slice B — deriveActiveClaimComponents", () => {
  it("filters out idle systems", () => {
    let state = withCalculated(defaultV2SessionState(), "hearing", 30);
    state = setClaimComponentOverride(state, "cns", {
      status: "legacy_deferred",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const active = deriveActiveClaimComponents(state);
    const systems = active.map((c) => c.system).sort();
    expect(systems).toEqual(["cns", "hearing"]);
  });
});

describe("Slice B — buildNextClaimStep — compact rendering for ≤2 active systems", () => {
  it("returns a confirm_system step when one system is ready", () => {
    const state = withExtractedFact(defaultV2SessionState(), "hearing", "x", 1);
    // hearing readiness validator may or may not pass with a synthetic fact;
    // we exercise the step-builder rather than the real readiness function here
    // by also setting a confirmation pending status, which has higher priority.
    const stateWithConfirmPending = withConfirmation(state, "hearing", "pending");
    const step = buildNextClaimStep(stateWithConfirmPending);
    expect(step?.kind).toBe("confirm_system");
    if (step?.kind === "confirm_system") {
      expect(step.system).toBe("hearing");
      expect(step.chips).toContain("Confirm and calculate");
    }
  });

  it("returns a clarify_system step when one system has a pending observation", () => {
    const obs: PendingObservation = {
      id: "obs-x",
      system: "spine",
      type: "other",
      sourceText: "x",
      parsed: {},
      missingFields: [],
      clarificationQuestion: "Which spinal region?",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObservation(defaultV2SessionState(), "spine", obs);
    const step = buildNextClaimStep(state);
    expect(step?.kind).toBe("clarify_system");
    if (step?.kind === "clarify_system") {
      expect(step.system).toBe("spine");
      expect(step.message).toContain("Which spinal region?");
    }
  });

  it("returns undefined when no actionable systems remain and no Global CVC offer is due", () => {
    const state = withCalculated(defaultV2SessionState(), "hearing", 30);
    const step = buildNextClaimStep(state, { justCompleted: "hearing" });
    expect(step).toBeUndefined();
  });
});

describe("Slice B — buildNextClaimStep — structured plan for 3+ active systems", () => {
  it("renders a claim_plan step listing all active systems", () => {
    let state = defaultV2SessionState();
    state = withConfirmation(state, "hearing", "pending");
    const obs: PendingObservation = {
      id: "obs-spine",
      system: "spine",
      type: "other",
      sourceText: "x",
      parsed: {},
      missingFields: [],
      clarificationQuestion: "Which region?",
      createdAt: NOW,
      updatedAt: NOW,
    };
    state = withPendingObservation(state, "spine", obs);
    state = setClaimComponentOverride(state, "cns", {
      status: "legacy_deferred",
      reason: "CNS deferred",
      source: "semantic_consensus",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const step = buildNextClaimStep(state);
    expect(step?.kind).toBe("claim_plan");
    if (step?.kind === "claim_plan") {
      expect(step.message).toContain("3 GATIOD assessment areas");
      expect(step.message).toContain("Hearing");
      expect(step.message).toContain("Spine");
      expect(step.message).toContain("Central Nervous System");
      expect(step.message).toContain("legacy/deferred");
      // Recommended next step prefers confirmation_pending (highest priority).
      expect(step.message).toContain("Recommended next step:** Hearing");
      expect(step.components.map((c) => c.system).sort()).toEqual(
        ["cns", "hearing", "spine"].sort(),
      );
    }
  });

  it("respects focusSystem when the plan picks the next action", () => {
    let state = defaultV2SessionState();
    state = withConfirmation(state, "hearing", "pending");
    state = withConfirmation(state, "spine", "pending");
    state = setClaimComponentOverride(state, "cns", {
      status: "legacy_deferred",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const step = buildNextClaimStep(state, { focusSystem: "spine" });
    expect(step?.kind).toBe("claim_plan");
    if (step?.kind === "claim_plan") {
      expect(step.message).toContain("Recommended next step:** Spine");
    }
  });
});

describe("Slice B — Global CVC offer step", () => {
  it("offers Global CVC when ≥2 positive calculated subtotals and no actionable system remains", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "spine", 5);
    state = withCalculated(state, "hearing", 30);
    const step = buildNextClaimStep(state);
    expect(step?.kind).toBe("offer_global_cvc");
    if (step?.kind === "offer_global_cvc") {
      expect(step.chips).toContain("Combine");
    }
  });

  it("does not offer Global CVC when one calculated system is excluded leaving < 2", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "spine", 5);
    state = withCalculated(state, "hearing", 30);
    state = setGlobalCvcExclusion(state, "hearing", {
      excludedAt: NOW,
      source: "user_choice",
    });
    const step = buildNextClaimStep(state);
    expect(step).toBeUndefined();
  });

  it("does not offer Global CVC while pendingGlobalCvcConfirmation is set", () => {
    let state = defaultV2SessionState();
    state = withCalculated(state, "spine", 5);
    state = withCalculated(state, "hearing", 30);
    state = {
      ...state,
      pendingGlobalCvcConfirmation: {
        status: "pending",
        componentSystems: ["hearing", "spine"],
        componentValues: [30, 5],
        createdAt: NOW,
      },
    };
    const step = buildNextClaimStep(state);
    expect(step).toBeUndefined();
  });
});

describe("Slice B — legacy/deferred and unsupported steps", () => {
  it("renders legacy_deferred as a single-system step when it is the only active component", () => {
    let state = defaultV2SessionState();
    state = setClaimComponentOverride(state, "cns", {
      status: "legacy_deferred",
      reason: "structured V2 deferred",
      source: "legacy_policy",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Only 1 active component → compact step.
    // Legacy is not "actionable" in the picker, so the step is undefined.
    // This is intentional: a sole legacy/deferred component should not block
    // the conversation; the doctor must take an explicit action.
    const step = buildNextClaimStep(state);
    expect(step).toBeUndefined();
  });
});
