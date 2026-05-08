import { describe, expect, it } from "vitest";
import { validateLowerLimbReadiness } from "../../../src/v2/readiness/lowerLimb.js";
import { buildLowerLimbArgs } from "../../../src/v2/argBuilders/lowerLimb.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  LL_FK_SIDE,
  LL_FK_ROM_JOINTS,
  LL_FK_NERVE_SELECTIONS,
  LL_FK_ROM_FROM_NERVE,
  LL_FK_LEG_AMPUTATION,
  LL_FK_TOE_AMPUTATIONS,
  LL_FK_SHORTENING_CM,
  LL_FK_DBE_SELECTIONS,
} from "../../../src/v2/extractors/lowerLimb.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T): import("../../../src/v2/contracts.js").ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.lower_limb, extractedFacts: facts };
}

// ── Readiness validator ───────────────────────────────────────────────────────

describe("validateLowerLimbReadiness", () => {
  it("blocks when pending observations exist", () => {
    const state: V2SystemState = {
      ...defaultV2SessionState().systems.lower_limb,
      extractedFacts: { [LL_FK_SIDE]: fact("left") },
      pendingObservations: [{
        id: "obs1", system: "lower_limb", type: "rom_measurement",
        sourceText: "test", parsed: {}, missingFields: ["direction"],
        clarificationQuestion: "Which direction?", candidateAnswers: ["Flexion"],
        createdAt: nowIso(), updatedAt: nowIso(),
      }],
    };
    const r = validateLowerLimbReadiness(state);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when side is missing", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_ROM_JOINTS]: fact({ knee: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_side");
  });

  it("blocks when no assessable finding", () => {
    const r = validateLowerLimbReadiness(stateWith({ [LL_FK_SIDE]: fact("left") }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_finding");
  });

  it("blocks for rom-from-nerve gate when both ROM and nerve present", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_ROM_JOINTS]: fact({ knee: { isAnkylosed: false, measurements: { flexion: 90 } } }),
      [LL_FK_NERVE_SELECTIONS]: fact([{ nerveKey: "sciatic", deficitType: "motor", lossType: "total" }]),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("rom_from_nerve_gate");
    expect(r.candidateAnswers).toContain("Independent ROM");
  });

  it("is ready with ROM only", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_SIDE]: fact("right"),
      [LL_FK_ROM_JOINTS]: fact({ hip: { isAnkylosed: false, measurements: { flexion: 80 } } }),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with shortening >= 0.5 cm", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_SHORTENING_CM]: fact(1.5),
    }));
    expect(r.ready).toBe(true);
  });

  it("blocks when shortening is 0 and no other findings", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_SHORTENING_CM]: fact(0),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_finding");
  });

  it("is ready with leg amputation", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_SIDE]: fact("right"),
      [LL_FK_LEG_AMPUTATION]: fact("above_knee"),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready with ROM + nerve + gate answered", () => {
    const r = validateLowerLimbReadiness(stateWith({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_ROM_JOINTS]: fact({ ankle: { isAnkylosed: false, measurements: { dorsiflexion: 10 } } }),
      [LL_FK_NERVE_SELECTIONS]: fact([{ nerveKey: "tibial", deficitType: "sensory", lossType: "partial" }]),
      [LL_FK_ROM_FROM_NERVE]: fact(false),
    }));
    expect(r.ready).toBe(true);
  });
});

// ── Arg builder ───────────────────────────────────────────────────────────────

describe("buildLowerLimbArgs", () => {
  it("fails when side is missing", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_ROM_JOINTS]: fact({ knee: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors).toContain("side: required");
  });

  it("builds valid args with ROM only", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_ROM_JOINTS]: fact({ knee: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/lowerLimbData.js").LowerLimbValue;
      expect(args.side).toBe("left");
      expect(args.rom.joints["knee"]?.measurements?.["flexion"]).toBe(90);
      expect(args.amputations.legLevel).toBe("none");
      expect(args.shortening.discrepancyCm).toBe(0);
      expect(r.provenance.builderZeroFilled).toContain("leg_amputation");
      expect(r.provenance.userSupplied).toContain("rom_joints");
    }
  });

  it("builds valid args with shortening", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_SIDE]: fact("right"),
      [LL_FK_SHORTENING_CM]: fact(2.5),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/lowerLimbData.js").LowerLimbValue;
      expect(args.shortening.discrepancyCm).toBe(2.5);
      expect(r.provenance.userSupplied).toContain("shortening_cm");
    }
  });

  it("builds valid args with leg amputation", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_LEG_AMPUTATION]: fact("below_knee"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/lowerLimbData.js").LowerLimbValue;
      expect(args.amputations.legLevel).toBe("below_knee");
    }
  });

  it("fails zod when leg amputation with toe amputations", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_LEG_AMPUTATION]: fact("above_knee"),
      [LL_FK_TOE_AMPUTATIONS]: fact({ great: "mtp", second: "none", third: "none", fourth: "none", fifth: "none" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.zodErrors?.some((e) => /toes/i.test(e))).toBe(true);
    }
  });

  it("includes provenance hash in result", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_SIDE]: fact("right"),
      [LL_FK_SHORTENING_CM]: fact(1.0),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.factsHash).toHaveLength(16);
    }
  });

  it("builds valid args with nerve + rom_from_nerve gate", () => {
    const r = buildLowerLimbArgs({
      [LL_FK_SIDE]: fact("left"),
      [LL_FK_NERVE_SELECTIONS]: fact([{ nerveKey: "sciatic", deficitType: "motor", lossType: "total" }]),
      [LL_FK_ROM_FROM_NERVE]: fact(false),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as import("../../../src/engine/lowerLimbData.js").LowerLimbValue;
      expect(args.neurological.selectedNerves).toHaveLength(1);
      expect(args.neurological.romFromNerve).toBe(false);
    }
  });
});
