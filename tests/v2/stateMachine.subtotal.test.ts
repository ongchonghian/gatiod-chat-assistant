import { describe, expect, it } from "vitest";
import {
  applyInstanceToolResult,
  collectCalculatedSubtotals,
  computeSystemSubtotal,
  defaultV2SessionState,
  getInstances,
  upsertInstance,
} from "../../src/v2/stateMachine.js";
import type { V2AssessmentInstance } from "../../src/v2/contracts.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function calcInstance(
  instanceId: string,
  piPercent: number
): V2AssessmentInstance {
  const [system, ...slotPath] = instanceId.split("::");
  const now = nowIso();
  return {
    instanceId,
    system: system as V2AssessmentInstance["system"],
    slotPath,
    facts: {},
    pendingObservations: [],
    confirmation: { status: "not_confirmed" },
    status: "calculated",
    piPercent,
    trace: null,
    updatedAt: now,
  };
}

function collectingInstance(instanceId: string): V2AssessmentInstance {
  const [system, ...slotPath] = instanceId.split("::");
  const now = nowIso();
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
    updatedAt: now,
  };
}

// ── computeSystemSubtotal unit tests ─────────────────────────────────────────

describe("computeSystemSubtotal", () => {
  it("returns null when no instances", () => {
    expect(computeSystemSubtotal("hearing", [])).toBeNull();
  });

  it("returns null when no calculated instances", () => {
    const inst = collectingInstance("hearing::global");
    expect(computeSystemSubtotal("hearing", [inst])).toBeNull();
  });

  // ── additive (hearing, visual) ────────────────────────────────────────────

  it("hearing single NID instance passes through unchanged", () => {
    const result = computeSystemSubtotal("hearing", [
      calcInstance("hearing::global", 30),
    ]);
    expect(result).toBe(30);
  });

  it("hearing injury two ears combine additively", () => {
    const result = computeSystemSubtotal("hearing", [
      calcInstance("hearing::left_ear", 20),
      calcInstance("hearing::right_ear", 15),
    ]);
    expect(result).toBe(35); // 20 + 15 = 35
  });

  it("hearing additive is capped at 100", () => {
    const result = computeSystemSubtotal("hearing", [
      calcInstance("hearing::left_ear", 70),
      calcInstance("hearing::right_ear", 60),
    ]);
    expect(result).toBe(100);
  });

  it("visual three slots combine additively", () => {
    const result = computeSystemSubtotal("visual", [
      calcInstance("visual::left_eye", 20),
      calcInstance("visual::right_eye", 15),
      calcInstance("visual::diplopia", 5),
    ]);
    expect(result).toBe(40);
  });

  // ── cvc (spine, upper_limb, lower_limb, gastro) ───────────────────────────

  it("spine single region passes through unchanged", () => {
    const result = computeSystemSubtotal("spine", [
      calcInstance("spine::cervical", 25),
    ]);
    expect(result).toBe(25);
  });

  it("spine two regions combine by CVC", () => {
    // CVC(25, 10): combineMultipleValuesChart rounds 32.5 → 33
    const result = computeSystemSubtotal("spine", [
      calcInstance("spine::cervical", 25),
      calcInstance("spine::thoraco_lumbar", 10),
    ]);
    expect(result).toBe(33);
    expect(result).toBeGreaterThan(25); // CVC always > max component
    expect(result).toBeLessThan(35);   // CVC always < simple sum
  });

  it("upper_limb multiple joint instances combine by CVC", () => {
    const result = computeSystemSubtotal("upper_limb", [
      calcInstance("upper_limb::left::shoulder", 30),
      calcInstance("upper_limb::left::elbow", 20),
    ]);
    // CVC(30, 20): 30 + 20*(1-30/100) = 30 + 14 = 44
    expect(result).toBeCloseTo(44, 0);
  });

  it("gastro_digestive two subsystems combine by CVC", () => {
    const result = computeSystemSubtotal("gastro_digestive", [
      calcInstance("gastro_digestive::colonic_rectal", 15),
      calcInstance("gastro_digestive::liver_biliary", 10),
    ]);
    expect(result).toBeGreaterThan(15);
    expect(result).toBeLessThan(25);
  });

  // ── none (respiratory, renal, cns) ───────────────────────────────────────

  it("respiratory single global instance passes through", () => {
    const result = computeSystemSubtotal("respiratory", [
      calcInstance("respiratory::global", 20),
    ]);
    expect(result).toBe(20);
  });

  it("renal single global instance passes through", () => {
    const result = computeSystemSubtotal("renal", [
      calcInstance("renal::global", 18),
    ]);
    expect(result).toBe(18);
  });

  it("cns single global instance passes through", () => {
    const result = computeSystemSubtotal("cns", [
      calcInstance("cns::global", 40),
    ]);
    expect(result).toBe(40);
  });

  // ── ignores non-calculated instances ─────────────────────────────────────

  it("ignores collecting instances when computing subtotal", () => {
    const result = computeSystemSubtotal("hearing", [
      calcInstance("hearing::left_ear", 20),
      collectingInstance("hearing::right_ear"), // not yet calculated
    ]);
    expect(result).toBe(20); // only the calculated ear counts
  });
});

// ── applyInstanceToolResult integration ──────────────────────────────────────

describe("applyInstanceToolResult — system subtotal sync", () => {
  it("writes system piPercent after single instance is calculated", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::global"));

    state = applyInstanceToolResult(state, "hearing::global", 30);

    expect(state.systems.hearing.piPercent).toBe(30);
    expect(state.systems.hearing.status).toBe("calculated");
  });

  it("recomputes additive subtotal after second hearing ear is calculated", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::left_ear"));
    state = upsertInstance(state, collectingInstance("hearing::right_ear"));

    state = applyInstanceToolResult(state, "hearing::left_ear", 20);
    expect(state.systems.hearing.piPercent).toBe(20);

    state = applyInstanceToolResult(state, "hearing::right_ear", 15);
    expect(state.systems.hearing.piPercent).toBe(35); // 20 + 15
  });

  it("recomputes CVC subtotal after second spine region is calculated", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("spine::cervical"));
    state = upsertInstance(state, collectingInstance("spine::thoraco_lumbar"));

    state = applyInstanceToolResult(state, "spine::cervical", 25);
    state = applyInstanceToolResult(state, "spine::thoraco_lumbar", 10);

    // CVC(25, 10) ≈ 32.5
    expect(state.systems.spine.piPercent).toBeGreaterThan(25);
    expect(state.systems.spine.piPercent).toBeLessThan(35);
  });

  it("subtotal is reflected in collectCalculatedSubtotals for global CVC", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::left_ear"));
    state = upsertInstance(state, collectingInstance("hearing::right_ear"));
    state = applyInstanceToolResult(state, "hearing::left_ear", 20);
    state = applyInstanceToolResult(state, "hearing::right_ear", 15);

    const subtotals = collectCalculatedSubtotals(state);
    const hearingEntry = subtotals.find((s) => s.system === "hearing");

    expect(hearingEntry).toBeDefined();
    expect(hearingEntry!.piPercent).toBe(35);
  });

  it("instance remains in instance list after applyInstanceToolResult", () => {
    let state = defaultV2SessionState();
    state = upsertInstance(state, collectingInstance("hearing::global"));
    state = applyInstanceToolResult(state, "hearing::global", 30);

    const instances = getInstances(state, "hearing");
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("calculated");
    expect(instances[0].piPercent).toBe(30);
  });
});
