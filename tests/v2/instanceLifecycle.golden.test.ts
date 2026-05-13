/**
 * Golden tests — full instance lifecycle per system's INSTANCE_RULES
 *
 * Each scenario exercises the complete pipeline:
 *   upsertInstance → applyInstanceFactsPatch → readiness check →
 *   arg build → setInstanceConfirmationPending → applyInstanceToolResult →
 *   trace stored on instance → system subtotal updated
 *
 * Engine calls are real (no mocks). Expected values are derived from actual
 * engine output at the top of each describe block so they stay in sync.
 */

import { describe, expect, it } from "vitest";
import {
  defaultV2SessionState,
  upsertInstance,
  applyInstanceFactsPatch,
  setInstanceConfirmationPending,
  applyInstanceToolResult,
  computeSystemSubtotal,
  getInstances,
  collectCalculatedSubtotals,
  hashExtractedFacts,
} from "../../src/v2/stateMachine.js";
import { buildTraceForSystem } from "../../src/v2/systemTraceAdapters.js";
import { buildHearingArgs } from "../../src/v2/argBuilders/hearing.js";
import { validateHearingInstanceReadiness } from "../../src/v2/readiness/hearing.js";
import { calculateHearing } from "../../src/engine/hearingData.js";
import { combineAdditive, combineMultipleValuesChart } from "../../src/engine/cvcCalculator.js";
import type { V2AssessmentInstance, V2SystemFacts } from "../../src/v2/contracts.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
} from "../../src/v2/extractors/hearing.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function fact<T>(value: T) {
  const now = nowIso();
  return {
    value,
    sourceText: "doctor note",
    confidence: 1,
    extractionMethod: "regex" as const,
    createdAt: now,
    updatedAt: now,
  };
}

function blankInstance(instanceId: string): V2AssessmentInstance {
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

function patchFacts(
  instanceId: string,
  facts: V2SystemFacts
) {
  return {
    extractedFactsPatch: facts,
    pendingObservationsToAdd: [],
    pendingObservationsToResolve: [],
    slotSignalsPatch: {},
    displayValuesPatch: {},
    warnings: [],
    instanceId,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 1 — Hearing NID: single global instance, additive passthrough
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Fixture values derived from real engine output:
const NID_INPUT = { path: "nid" as const, leftEarAhl: 65, rightEarAhl: 70, age: 55 };
const NID_RESULT = calculateHearing(NID_INPUT); // finalPercent = 17.5

describe("Hearing NID — full instance lifecycle", () => {
  const ID = "hearing::global";

  function buildReadyState() {
    let state = defaultV2SessionState();
    state = upsertInstance(state, blankInstance(ID));
    state = applyInstanceFactsPatch(state, ID, patchFacts(ID, {
      [HEARING_FK_PATH]:         fact("nid"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
      [HEARING_FK_RIGHT_EAR_AHL]:fact(70),
      [HEARING_FK_AGE]:          fact(55),
    }));
    return state;
  }

  it("instance is created with status collecting and no facts initially", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, blankInstance(ID));
    const inst = getInstances(state, "hearing")[0];
    expect(inst.status).toBe("collecting");
    expect(inst.piPercent).toBeNull();
    expect(Object.keys(inst.facts)).toHaveLength(0);
  });

  it("facts patch populates instance facts without touching system-level state", () => {
    const state = buildReadyState();
    const inst = getInstances(state, "hearing")[0];
    expect(inst.facts[HEARING_FK_PATH]?.value).toBe("nid");
    expect(inst.facts[HEARING_FK_LEFT_EAR_AHL]?.value).toBe(65);
    // system-level piPercent remains null until tool execution
    expect(state.systems.hearing.piPercent).toBeNull();
  });

  it("instance readiness passes after all NID facts are applied", () => {
    const state = buildReadyState();
    const inst = getInstances(state, "hearing")[0];
    const r = validateHearingInstanceReadiness(inst);
    expect(r.ready).toBe(true);
  });

  it("arg builder produces valid NID args from instance facts", () => {
    const state = buildReadyState();
    const inst = getInstances(state, "hearing")[0];
    const r = buildHearingArgs(inst.facts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.toolName).toBe("assess_hearing");
      expect((r.args as typeof NID_INPUT).path).toBe("nid");
    }
  });

  it("confirmation pending records factsHash of the current facts", () => {
    let state = buildReadyState();
    state = setInstanceConfirmationPending(state, ID, "Please confirm NID assessment.");
    const inst = getInstances(state, "hearing")[0];
    expect(inst.confirmation.status).toBe("pending");
    const expectedHash = hashExtractedFacts(inst.facts);
    expect(inst.confirmation.factsHash).toBe(expectedHash);
    expect(inst.confirmation.confirmationSummary).toMatch(/NID/i);
  });

  it("applyInstanceToolResult sets instance to calculated with correct piPercent", () => {
    let state = buildReadyState();
    state = setInstanceConfirmationPending(state, ID, "NID confirmed.");
    const inst = getInstances(state, "hearing")[0];
    const builtArgs = buildHearingArgs(inst.facts);
    if (!builtArgs.ok) throw new Error("args not ok");

    const trace = buildTraceForSystem("hearing", builtArgs.args, NID_RESULT, { instanceId: ID });
    state = applyInstanceToolResult(state, ID, NID_RESULT.finalPercent, trace);

    const calculated = getInstances(state, "hearing")[0];
    expect(calculated.status).toBe("calculated");
    expect(calculated.piPercent).toBe(NID_RESULT.finalPercent);
  });

  it("trace is stored on the calculated instance with correct shape", () => {
    let state = buildReadyState();
    const trace = buildTraceForSystem("hearing", NID_INPUT, NID_RESULT, { instanceId: ID });
    state = applyInstanceToolResult(state, ID, NID_RESULT.finalPercent, trace);

    const calculated = getInstances(state, "hearing")[0];
    expect(calculated.trace).not.toBeNull();
    expect(calculated.trace?.systemKey).toBe("hearing");
    expect(calculated.trace?.method).toBe("none");
    expect(calculated.trace?.final).toBe(NID_RESULT.finalPercent);
    expect(calculated.trace?.instanceId).toBe(ID);
  });

  it("system subtotal is written to systems.hearing.piPercent after tool result", () => {
    let state = buildReadyState();
    const trace = buildTraceForSystem("hearing", NID_INPUT, NID_RESULT, { instanceId: ID });
    state = applyInstanceToolResult(state, ID, NID_RESULT.finalPercent, trace);

    // Single instance → additive passthrough = NID_RESULT.finalPercent
    const expected = combineAdditive([NID_RESULT.finalPercent]);
    expect(state.systems.hearing.piPercent).toBe(expected);
    expect(state.systems.hearing.status).toBe("calculated");
  });

  it("collectCalculatedSubtotals includes hearing after lifecycle completes", () => {
    let state = buildReadyState();
    const trace = buildTraceForSystem("hearing", NID_INPUT, NID_RESULT, { instanceId: ID });
    state = applyInstanceToolResult(state, ID, NID_RESULT.finalPercent, trace);

    const subtotals = collectCalculatedSubtotals(state);
    const row = subtotals.find((s) => s.system === "hearing");
    expect(row).toBeDefined();
    expect(row?.piPercent).toBe(NID_RESULT.finalPercent);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 2 — Hearing bilateral injury: two ear instances, additive aggregation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LEFT_INJURY_INPUT  = { path: "injury" as const, affectedEars: "left"  as const, leftEarAhl:  65 };
const RIGHT_INJURY_INPUT = { path: "injury" as const, affectedEars: "right" as const, rightEarAhl: 70 };
const LEFT_INJURY_RESULT  = calculateHearing(LEFT_INJURY_INPUT);  // finalPercent = 10
const RIGHT_INJURY_RESULT = calculateHearing(RIGHT_INJURY_INPUT); // finalPercent = 13

describe("Hearing bilateral injury — additive aggregation lifecycle", () => {
  const LEFT_ID  = "hearing::left_ear";
  const RIGHT_ID = "hearing::right_ear";

  function buildBilateralState() {
    let state = defaultV2SessionState();
    state = upsertInstance(state, blankInstance(LEFT_ID));
    state = upsertInstance(state, blankInstance(RIGHT_ID));

    state = applyInstanceFactsPatch(state, LEFT_ID, patchFacts(LEFT_ID, {
      [HEARING_FK_PATH]:         fact("injury"),
      [HEARING_FK_AFFECTED_EARS]:fact("left"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(65),
    }));
    state = applyInstanceFactsPatch(state, RIGHT_ID, patchFacts(RIGHT_ID, {
      [HEARING_FK_PATH]:         fact("injury"),
      [HEARING_FK_AFFECTED_EARS]:fact("right"),
      [HEARING_FK_RIGHT_EAR_AHL]:fact(70),
    }));
    return state;
  }

  it("both ear instances are created and have correct facts", () => {
    const state = buildBilateralState();
    const instances = getInstances(state, "hearing");
    expect(instances).toHaveLength(2);

    const left  = instances.find((i) => i.instanceId === LEFT_ID);
    const right = instances.find((i) => i.instanceId === RIGHT_ID);
    expect(left?.facts[HEARING_FK_AFFECTED_EARS]?.value).toBe("left");
    expect(right?.facts[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
  });

  it("left ear instance is ready with its scoped facts", () => {
    const state = buildBilateralState();
    const inst  = getInstances(state, "hearing").find((i) => i.instanceId === LEFT_ID)!;
    expect(validateHearingInstanceReadiness(inst).ready).toBe(true);
  });

  it("right ear instance is ready without needing leftEarAhl in its facts", () => {
    const state = buildBilateralState();
    const inst  = getInstances(state, "hearing").find((i) => i.instanceId === RIGHT_ID)!;
    expect(validateHearingInstanceReadiness(inst).ready).toBe(true);
    // Right ear instance must NOT require leftEarAhl (scoped validator bug guard)
    expect(Object.keys(inst.facts)).not.toContain(HEARING_FK_LEFT_EAR_AHL);
  });

  it("after both instances calculated, system subtotal is additive sum", () => {
    let state = buildBilateralState();

    const leftTrace  = buildTraceForSystem("hearing", LEFT_INJURY_INPUT,  LEFT_INJURY_RESULT,  { instanceId: LEFT_ID });
    const rightTrace = buildTraceForSystem("hearing", RIGHT_INJURY_INPUT, RIGHT_INJURY_RESULT, { instanceId: RIGHT_ID });
    state = applyInstanceToolResult(state, LEFT_ID,  LEFT_INJURY_RESULT.finalPercent,  leftTrace);
    state = applyInstanceToolResult(state, RIGHT_ID, RIGHT_INJURY_RESULT.finalPercent, rightTrace);

    const expectedSubtotal = combineAdditive([LEFT_INJURY_RESULT.finalPercent, RIGHT_INJURY_RESULT.finalPercent]);
    expect(state.systems.hearing.piPercent).toBe(expectedSubtotal);
    expect(state.systems.hearing.status).toBe("calculated");
  });

  it("intermediate subtotal after only one ear is finalPercent of that ear alone", () => {
    let state = buildBilateralState();

    const leftTrace = buildTraceForSystem("hearing", LEFT_INJURY_INPUT, LEFT_INJURY_RESULT, { instanceId: LEFT_ID });
    state = applyInstanceToolResult(state, LEFT_ID, LEFT_INJURY_RESULT.finalPercent, leftTrace);

    // Only left calculated → additive([10]) = 10
    expect(state.systems.hearing.piPercent).toBe(LEFT_INJURY_RESULT.finalPercent);

    // Right not yet calculated
    const rightInst = getInstances(state, "hearing").find((i) => i.instanceId === RIGHT_ID);
    expect(rightInst?.status).toBe("collecting");
  });

  it("both instances have per-instance traces with 'additive' method", () => {
    let state = buildBilateralState();
    const leftTrace  = buildTraceForSystem("hearing", LEFT_INJURY_INPUT,  LEFT_INJURY_RESULT,  { instanceId: LEFT_ID });
    const rightTrace = buildTraceForSystem("hearing", RIGHT_INJURY_INPUT, RIGHT_INJURY_RESULT, { instanceId: RIGHT_ID });
    state = applyInstanceToolResult(state, LEFT_ID,  LEFT_INJURY_RESULT.finalPercent,  leftTrace);
    state = applyInstanceToolResult(state, RIGHT_ID, RIGHT_INJURY_RESULT.finalPercent, rightTrace);

    const instances = getInstances(state, "hearing");
    for (const inst of instances) {
      expect(inst.trace?.method).toBe("additive");
      expect(inst.trace?.systemKey).toBe("hearing");
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 3 — Spine two regions: two instances, CVC aggregation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Spine: fixed_slots, combinationMethod: "cvc"
// CVC(15, 20) = 32 (from combineMultipleValuesChart)
const CERVICAL_PI   = 15;
const THORACO_PI    = 20;
const SPINE_CVC     = combineMultipleValuesChart([CERVICAL_PI, THORACO_PI]); // 32

describe("Spine two regions — CVC aggregation lifecycle", () => {
  const CERVICAL_ID = "spine::cervical";
  const THORACO_ID  = "spine::thoraco_lumbar";

  function buildSpineState() {
    let state = defaultV2SessionState();
    state = upsertInstance(state, blankInstance(CERVICAL_ID));
    state = upsertInstance(state, blankInstance(THORACO_ID));
    return state;
  }

  it("two distinct spine instances are created correctly", () => {
    const state = buildSpineState();
    const instances = getInstances(state, "spine");
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.instanceId)).toContain(CERVICAL_ID);
    expect(instances.map((i) => i.instanceId)).toContain(THORACO_ID);
  });

  it("applying results one-by-one recomputes subtotal incrementally", () => {
    let state = buildSpineState();
    state = applyInstanceToolResult(state, CERVICAL_ID, CERVICAL_PI);
    // One calculated instance → CVC of single value = passthrough
    expect(state.systems.spine.piPercent).toBe(CERVICAL_PI);

    state = applyInstanceToolResult(state, THORACO_ID, THORACO_PI);
    // Both calculated → CVC(15, 20)
    expect(state.systems.spine.piPercent).toBe(SPINE_CVC);
  });

  it("system subtotal equals CVC after both regions calculated", () => {
    let state = buildSpineState();
    state = applyInstanceToolResult(state, CERVICAL_ID, CERVICAL_PI);
    state = applyInstanceToolResult(state, THORACO_ID,  THORACO_PI);
    expect(state.systems.spine.piPercent).toBe(SPINE_CVC);
    expect(state.systems.spine.status).toBe("calculated");
  });

  it("computeSystemSubtotal matches applyInstanceToolResult's written subtotal", () => {
    let state = buildSpineState();
    state = applyInstanceToolResult(state, CERVICAL_ID, CERVICAL_PI);
    state = applyInstanceToolResult(state, THORACO_ID,  THORACO_PI);

    const recomputed = computeSystemSubtotal("spine", getInstances(state, "spine"));
    expect(recomputed).toBe(state.systems.spine.piPercent);
  });

  it("collectCalculatedSubtotals includes spine with the CVC subtotal", () => {
    let state = buildSpineState();
    state = applyInstanceToolResult(state, CERVICAL_ID, CERVICAL_PI);
    state = applyInstanceToolResult(state, THORACO_ID,  THORACO_PI);

    const subtotals = collectCalculatedSubtotals(state);
    const row = subtotals.find((s) => s.system === "spine");
    expect(row?.piPercent).toBe(SPINE_CVC);
  });

  it("each instance retains its own piPercent independently of the subtotal", () => {
    let state = buildSpineState();
    state = applyInstanceToolResult(state, CERVICAL_ID, CERVICAL_PI);
    state = applyInstanceToolResult(state, THORACO_ID,  THORACO_PI);

    const instances = getInstances(state, "spine");
    const cervical = instances.find((i) => i.instanceId === CERVICAL_ID);
    const thoraco  = instances.find((i) => i.instanceId === THORACO_ID);
    expect(cervical?.piPercent).toBe(CERVICAL_PI);
    expect(thoraco?.piPercent).toBe(THORACO_PI);
    // Neither instance stores the combined subtotal
    expect(cervical?.piPercent).not.toBe(SPINE_CVC);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 4 — Upper limb bilateral: two side instances, CVC aggregation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Upper limb: hierarchical, combinationMethod: "cvc"
// Instances at the joint level: "upper_limb::left::shoulder" / "upper_limb::right::shoulder"
const LEFT_UL_PI  = 20;
const RIGHT_UL_PI = 15;
const UL_CVC      = combineMultipleValuesChart([LEFT_UL_PI, RIGHT_UL_PI]); // 32

describe("Upper limb bilateral — CVC aggregation lifecycle", () => {
  const LEFT_ID  = "upper_limb::left::shoulder";
  const RIGHT_ID = "upper_limb::right::shoulder";

  function buildUlState() {
    let state = defaultV2SessionState();
    state = upsertInstance(state, blankInstance(LEFT_ID));
    state = upsertInstance(state, blankInstance(RIGHT_ID));
    return state;
  }

  it("both sided joint instances are created", () => {
    const state = buildUlState();
    const instances = getInstances(state, "upper_limb");
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.slotPath)).toContainEqual(["left", "shoulder"]);
    expect(instances.map((i) => i.slotPath)).toContainEqual(["right", "shoulder"]);
  });

  it("system subtotal uses CVC after both sides calculated", () => {
    let state = buildUlState();
    state = applyInstanceToolResult(state, LEFT_ID,  LEFT_UL_PI);
    state = applyInstanceToolResult(state, RIGHT_ID, RIGHT_UL_PI);
    expect(state.systems.upper_limb.piPercent).toBe(UL_CVC);
  });

  it("confirmation pending hash matches instance facts hash", () => {
    let state = buildUlState();
    // Simulate fact patch before confirmation
    state = applyInstanceFactsPatch(state, LEFT_ID, patchFacts(LEFT_ID, {
      side: fact("left"),
      joint: fact("shoulder"),
    }));
    state = setInstanceConfirmationPending(state, LEFT_ID, "Confirm left shoulder.");
    const inst = getInstances(state, "upper_limb").find((i) => i.instanceId === LEFT_ID)!;
    expect(inst.confirmation.status).toBe("pending");
    expect(inst.confirmation.factsHash).toBe(hashExtractedFacts(inst.facts));
  });

  it("adding new facts after confirmation pending marks instance stale", () => {
    let state = buildUlState();
    state = applyInstanceFactsPatch(state, LEFT_ID, patchFacts(LEFT_ID, { side: fact("left") }));
    state = setInstanceConfirmationPending(state, LEFT_ID, "Confirm left.");
    // Apply more facts — should flip to stale
    state = applyInstanceFactsPatch(state, LEFT_ID, patchFacts(LEFT_ID, { joint: fact("shoulder") }));
    const inst = getInstances(state, "upper_limb").find((i) => i.instanceId === LEFT_ID)!;
    expect(inst.confirmation.status).toBe("stale");
  });

  it("collectCalculatedSubtotals includes upper_limb after bilateral lifecycle", () => {
    let state = buildUlState();
    state = applyInstanceToolResult(state, LEFT_ID,  LEFT_UL_PI);
    state = applyInstanceToolResult(state, RIGHT_ID, RIGHT_UL_PI);

    const subtotals = collectCalculatedSubtotals(state);
    const row = subtotals.find((s) => s.system === "upper_limb");
    expect(row?.piPercent).toBe(UL_CVC);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 5 — Single-instance systems (respiratory, renal, CNS): none method
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Single-instance systems — none combination method passthrough", () => {
  it.each([
    ["respiratory", "respiratory::global", 35],
    ["renal",       "renal::global",       20],
    ["cns",         "cns::global",         45],
  ] as const)("%s: system piPercent equals single instance piPercent", (system, id, pi) => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, blankInstance(id));
    state = applyInstanceToolResult(state, id, pi);

    expect(state.systems[system].piPercent).toBe(pi);
    expect(state.systems[system].status).toBe("calculated");

    const subtotals = collectCalculatedSubtotals(state);
    const row = subtotals.find((s) => s.system === system);
    expect(row?.piPercent).toBe(pi);
  });

  it("renal: trace null when not provided", () => {
    let state = defaultV2SessionState();
    const id = "renal::global";
    state = upsertInstance(state, blankInstance(id));
    state = applyInstanceToolResult(state, id, 20);
    const inst = getInstances(state, "renal")[0];
    expect(inst.trace).toBeNull();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario 6 — Multi-system session: independent system subtotals
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Multi-system session — independent system subtotals", () => {
  it("hearing and spine can both be calculated in the same session state without interference", () => {
    let state = defaultV2SessionState();

    // Hearing NID
    state = upsertInstance(state, blankInstance("hearing::global"));
    const nidTrace = buildTraceForSystem("hearing", NID_INPUT, NID_RESULT, { instanceId: "hearing::global" });
    state = applyInstanceToolResult(state, "hearing::global", NID_RESULT.finalPercent, nidTrace);

    // Spine single region
    state = upsertInstance(state, blankInstance("spine::cervical"));
    state = applyInstanceToolResult(state, "spine::cervical", 25);

    const subtotals = collectCalculatedSubtotals(state);
    const hearingRow = subtotals.find((s) => s.system === "hearing");
    const spineRow   = subtotals.find((s) => s.system === "spine");

    expect(hearingRow?.piPercent).toBe(NID_RESULT.finalPercent);
    expect(spineRow?.piPercent).toBe(25);
    // Systems don't bleed into each other
    expect(state.systems.spine.piPercent).not.toBe(NID_RESULT.finalPercent);
    expect(state.systems.hearing.piPercent).not.toBe(25);
  });

  it("three calculated systems all appear in collectCalculatedSubtotals", () => {
    let state = defaultV2SessionState();

    for (const [id, pi] of [
      ["upper_limb::left::shoulder", 20],
      ["hearing::global",            17],
      ["renal::global",              10],
    ] as [string, number][]) {
      state = upsertInstance(state, blankInstance(id));
      state = applyInstanceToolResult(state, id, pi);
    }

    const subtotals = collectCalculatedSubtotals(state);
    expect(subtotals.length).toBeGreaterThanOrEqual(3);
    expect(subtotals.map((s) => s.system)).toContain("upper_limb");
    expect(subtotals.map((s) => s.system)).toContain("hearing");
    expect(subtotals.map((s) => s.system)).toContain("renal");
  });
});
