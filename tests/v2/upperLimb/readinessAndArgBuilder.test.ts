import { describe, expect, it } from "vitest";
import { validateUpperLimbReadiness } from "../../../src/v2/readiness/upperLimb.js";
import { buildUpperLimbArgs } from "../../../src/v2/argBuilders/upperLimb.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemState, ExtractedFact, V2SystemFacts } from "../../../src/v2/contracts.js";
import type { RomJointEntry, NerveSelectionEntry } from "../../../src/v2/extractors/upperLimb.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T): ExtractedFact<T> {
  return { value, sourceText: "test", confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() };
}

function stateWithFacts(f: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.upper_limb, extractedFacts: f };
}

// ── Readiness validator ───────────────────────────────────────────────────────

describe("validateUpperLimbReadiness", () => {
  it("fails when there are pending observations", () => {
    const state: V2SystemState = {
      ...defaultV2SessionState().systems.upper_limb,
      pendingObservations: [{
        id: "obs1",
        system: "upper_limb",
        type: "rom_measurement",
        sourceText: "90 degrees",
        parsed: { joint: "shoulder", angle: 90 },
        missingFields: ["direction"],
        clarificationQuestion: "Which direction?",
        candidateAnswers: ["Flexion"],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }],
    };
    const result = validateUpperLimbReadiness(state);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("pending_observations");
  });

  it("fails when side is missing", () => {
    const state = stateWithFacts({
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    const result = validateUpperLimbReadiness(state);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("missing_side");
  });

  it("fails when no assessable finding", () => {
    const state = stateWithFacts({ side: fact<"left" | "right">("left") });
    const result = validateUpperLimbReadiness(state);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no_assessable_finding");
  });

  it("fails on rom_from_nerve gate when both ROM and nerve present but gate missing", () => {
    const state = stateWithFacts({
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
      nerve_selections: fact<NerveSelectionEntry[]>([{ nerveKey: "median_below", deficitType: "combined", lossType: "partial" }]),
    });
    const result = validateUpperLimbReadiness(state);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("rom_from_nerve_gate");
  });

  it("passes for ROM-only case", () => {
    const state = stateWithFacts({
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    expect(validateUpperLimbReadiness(state).ready).toBe(true);
  });

  it("passes for ROM + nerve when gate answered", () => {
    const state = stateWithFacts({
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
      nerve_selections: fact<NerveSelectionEntry[]>([{ nerveKey: "median_below", deficitType: "combined", lossType: "partial" }]),
      rom_from_nerve: fact<boolean>(false),
    });
    expect(validateUpperLimbReadiness(state).ready).toBe(true);
  });
});

// ── Arg builder ───────────────────────────────────────────────────────────────

describe("buildUpperLimbArgs", () => {
  it("fails when side is missing", () => {
    const result = buildUpperLimbArgs({
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    expect(result.ok).toBe(false);
  });

  it("builds ROM-only args with zero-filled amputation/nerve/dbe", () => {
    const facts: V2SystemFacts = {
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    };
    const result = buildUpperLimbArgs(facts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.side).toBe("left");
    expect(result.args.amputations.armLevel).toBe("none");
    expect(result.args.neurological.selectedNerves).toHaveLength(0);
    expect(result.args.dbe.selectedConditions).toHaveLength(0);
    expect(result.args.rom.joints["shoulder"].measurements["flexion"]).toBe(90);
    expect(result.provenance.userSupplied).toContain("side");
    expect(result.provenance.builderZeroFilled).toContain("arm_amputation");
  });

  it("includes nerve selections when present", () => {
    const facts: V2SystemFacts = {
      side: fact<"left" | "right">("right"),
      nerve_selections: fact<NerveSelectionEntry[]>([{ nerveKey: "ulnar_below", deficitType: "motor", lossType: "total" }]),
    };
    const result = buildUpperLimbArgs(facts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.neurological.selectedNerves).toHaveLength(1);
    expect(result.args.neurological.selectedNerves[0].nerveKey).toBe("ulnar_below");
  });

  it("passes Zod schema validation for above-elbow amputation", () => {
    const facts: V2SystemFacts = {
      side: fact<"left" | "right">("left"),
      arm_amputation: fact<string>("above_elbow"),
    };
    const result = buildUpperLimbArgs(facts);
    expect(result.ok).toBe(true);
  });

  it("includes factsHash in provenance", () => {
    const facts: V2SystemFacts = {
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ elbow: { isAnkylosed: false, measurements: { flexion: 120 } } }),
    };
    const result = buildUpperLimbArgs(facts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance.factsHash).toHaveLength(16);
  });

  it("fails with zodErrors for invalid side", () => {
    // Bypass TypeScript to test schema rejection at runtime
    const facts: V2SystemFacts = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      side: fact<any>("both"),
    };
    const result = buildUpperLimbArgs(facts);
    expect(result.ok).toBe(false);
  });
});
