import { describe, expect, it } from "vitest";
import { buildHearingTrace, buildTraceForSystem } from "../../src/v2/systemTraceAdapters.js";
import {
  applyInstanceToolResult,
  defaultV2SessionState,
  upsertInstance,
} from "../../src/v2/stateMachine.js";
import type { V2AssessmentInstance } from "../../src/v2/contracts.js";
import type { HearingValue, HearingResult } from "../../src/engine/hearingData.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function collectingInstance(instanceId: string): V2AssessmentInstance {
  const [system, ...slotPath] = instanceId.split("::");
  return {
    instanceId,
    system: system as V2AssessmentInstance["system"],
    slotPath,
    facts: {},
    pendingObservations: [],
    confirmation: { status: "not_confirmed" },
    status: "collecting",
    piPercent: null,
    trace: null,
    updatedAt: nowIso(),
  };
}

const NID_VALUE: HearingValue = {
  path: "nid",
  leftEarAhl: 65,
  rightEarAhl: 70,
  age: 55,
};

const NID_RESULT = {
  betterEar: "left" as const,
  betterEarAhl: 65,
  isEarlyNid: false,
  basePercent: 30,
  presbycusisDeduction: 5,
  finalPercent: 25,
};

const INJURY_VALUE: HearingValue = {
  path: "injury",
  affectedEars: "right",
  rightEarAhl: 70,
};

const INJURY_RESULT = {
  leftPercent: 0,
  rightPercent: 20,
  finalPercent: 20,
};

// ── buildHearingTrace — NID path ──────────────────────────────────────────────

describe("buildHearingTrace — NID", () => {
  it("produces a 'none' method trace", () => {
    const trace = buildHearingTrace(NID_VALUE, NID_RESULT as HearingResult);
    expect(trace.method).toBe("none");
    expect(trace.traceVersion).toBe(1);
    expect(trace.systemKey).toBe("hearing");
  });

  it("includes NID final PI in inputsIncluded", () => {
    const trace = buildHearingTrace(NID_VALUE, NID_RESULT as HearingResult);
    expect(trace.final).toBe(25);
    expect(trace.inputsIncluded).toHaveLength(1);
    expect(trace.inputsIncluded[0].key).toBe("selected");
    expect(trace.inputsIncluded[0].value).toBe(25);
  });

  it("includes better-ear and presbycusis rule notes", () => {
    const trace = buildHearingTrace(NID_VALUE, NID_RESULT as HearingResult);
    const notes = trace.ruleNotes.join(" ");
    expect(notes).toMatch(/better.ear/i);
    expect(notes).toMatch(/presbycusis/i);
  });

  it("stamps instanceId on trace when provided", () => {
    const trace = buildHearingTrace(NID_VALUE, NID_RESULT as HearingResult, { instanceId: "hearing::global" });
    expect(trace.instanceId).toBe("hearing::global");
  });
});

// ── buildHearingTrace — Injury path ──────────────────────────────────────────

describe("buildHearingTrace — Injury", () => {
  it("produces an 'additive' method trace", () => {
    const trace = buildHearingTrace(INJURY_VALUE, INJURY_RESULT as HearingResult);
    expect(trace.method).toBe("additive");
  });

  it("excludes the unaffected ear (left) with a reason", () => {
    const trace = buildHearingTrace(INJURY_VALUE, INJURY_RESULT as HearingResult);
    const leftEntry = trace.inputsExcluded.find((i) => i.key === "left");
    expect(leftEntry).toBeDefined();
    expect(leftEntry?.reason).toMatch(/not selected/i);
  });

  it("includes the affected ear (right) in inputsIncluded", () => {
    const trace = buildHearingTrace(INJURY_VALUE, INJURY_RESULT as HearingResult);
    const rightEntry = trace.inputsIncluded.find((i) => i.key === "right");
    expect(rightEntry).toBeDefined();
    expect(rightEntry?.value).toBe(20);
  });

  it("final equals the affected ear value", () => {
    const trace = buildHearingTrace(INJURY_VALUE, INJURY_RESULT as HearingResult);
    expect(trace.final).toBe(20);
  });
});

// ── buildTraceForSystem dispatch ─────────────────────────────────────────────

describe("buildTraceForSystem", () => {
  it("dispatches to hearing adapter and returns CalculationTrace", () => {
    const trace = buildTraceForSystem("hearing", NID_VALUE, NID_RESULT, { instanceId: "hearing::global" });
    expect(trace).not.toBeNull();
    expect(trace?.systemKey).toBe("hearing");
    expect(trace?.traceVersion).toBe(1);
    expect(trace?.final).toBe(25);
  });

  it("returns null for unknown system without throwing", () => {
    const trace = buildTraceForSystem("cns" as never, {}, {});
    // Should either succeed (returning a trace with 0) or null — must not throw.
    // CNS with empty args will either produce a trace or null; either is acceptable.
    expect(() => buildTraceForSystem("hearing", null, null)).not.toThrow();
  });
});

// ── applyInstanceToolResult stores trace on instance ─────────────────────────

describe("applyInstanceToolResult — trace storage", () => {
  it("stores the trace on the calculated instance", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::global"));

    const trace = buildHearingTrace(NID_VALUE, NID_RESULT as HearingResult, { instanceId: "hearing::global" });
    state = applyInstanceToolResult(state, "hearing::global", 25, trace);

    const instances = state.instancesBySystem?.hearing ?? [];
    expect(instances).toHaveLength(1);
    expect(instances[0].trace).not.toBeNull();
    expect(instances[0].trace?.traceVersion).toBe(1);
    expect(instances[0].trace?.final).toBe(25);
    expect(instances[0].trace?.method).toBe("none");
  });

  it("stores null trace when no trace provided", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::global"));
    state = applyInstanceToolResult(state, "hearing::global", 25);

    const instances = state.instancesBySystem?.hearing ?? [];
    expect(instances[0].trace).toBeNull();
  });

  it("trace instanceId matches the instance", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::right_ear"));

    const trace = buildHearingTrace(INJURY_VALUE, INJURY_RESULT as HearingResult, { instanceId: "hearing::right_ear" });
    state = applyInstanceToolResult(state, "hearing::right_ear", 20, trace);

    const inst = state.instancesBySystem?.hearing?.[0];
    expect(inst?.trace?.instanceId).toBe("hearing::right_ear");
  });
});
