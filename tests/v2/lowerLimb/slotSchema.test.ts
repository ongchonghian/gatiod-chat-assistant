/**
 * Lower limb slot schema tests — ADR-0004.
 *
 * Covers:
 *   1. Schema shape — all required SlotDefinition fields present on each slot.
 *   2. deriveLowerLimbSignals — maps facts to correct SlotSignals booleans.
 *   3. validateLowerLimbReadinessFromSchema — per-slot and cross-slot conditions.
 */

import { describe, expect, it } from "vitest";
import { lowerLimbSlotSchema, type LowerLimbFactKey } from "../../../src/v2/slotSchemas/lowerLimb.js";
import {
  deriveLowerLimbSignals,
  validateLowerLimbReadinessFromSchema,
} from "../../../src/v2/slotSchemas/lowerLimbExtractor.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { ExtractedFact, V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFact<T>(value: T): ExtractedFact<T> {
  const now = new Date().toISOString();
  return {
    value,
    sourceText: "test",
    confidence: 0.9,
    extractionMethod: "regex",
    createdAt: now,
    updatedAt: now,
  };
}

function stateWithFacts(facts: V2SystemFacts): V2SystemState {
  const base = defaultV2SessionState().systems.lower_limb;
  return { ...base, extractedFacts: facts };
}

function stateWithPendingObs(): V2SystemState {
  const base = defaultV2SessionState().systems.lower_limb;
  return {
    ...base,
    pendingObservations: [
      {
        id: "obs-1",
        system: "lower_limb",
        type: "rom_measurement",
        sourceText: "test",
        parsed: {},
        missingFields: ["direction"],
        clarificationQuestion: "Which direction does 90° apply to?",
        candidateAnswers: ["Flexion", "Extension"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

// ── Schema shape ──────────────────────────────────────────────────────────────

describe("lowerLimbSlotSchema shape", () => {
  const EXPECTED_KEYS: LowerLimbFactKey[] = [
    "side",
    "rom_joints",
    "rom_from_nerve",
    "nerve_selections",
    "leg_amputation",
    "toe_amputations",
    "shortening_cm",
    "dbe_selections",
  ];

  it("contains all 8 fact keys", () => {
    const keys = lowerLimbSlotSchema.map((d) => d.factKey);
    expect(keys).toEqual(expect.arrayContaining(EXPECTED_KEYS));
    expect(keys).toHaveLength(8);
  });

  it("every slot has required fields", () => {
    for (const def of lowerLimbSlotSchema) {
      expect(def.factKey, "factKey").toBeTruthy();
      expect(def.label, `${def.factKey}.label`).toBeTruthy();
      expect(def.description, `${def.factKey}.description`).toBeTruthy();
      expect(def.valueType, `${def.factKey}.valueType`).toBeTruthy();
      expect(def.required_when, `${def.factKey}.required_when`).toBeDefined();
      expect(typeof def.clinicalInferenceAllowed, `${def.factKey}.clinicalInferenceAllowed`).toBe("boolean");
    }
  });

  it("side is required_when always with clarification", () => {
    const def = lowerLimbSlotSchema.find((d) => d.factKey === "side")!;
    expect(def.required_when).toBe("always");
    expect(def.clinicalInferenceAllowed).toBe(true);
    expect(def.clarification).toBeDefined();
    expect(def.clarification!.candidateAnswers).toContain("Left");
    expect(def.clarification!.candidateAnswers).toContain("Right");
  });

  it("rom_from_nerve is required when both rom_joints and nerve_selections present", () => {
    const def = lowerLimbSlotSchema.find((d) => d.factKey === "rom_from_nerve")!;
    expect(def.required_when).toEqual({
      and: [
        { fact: "rom_joints", present: true },
        { fact: "nerve_selections", present: true },
      ],
    });
    expect(def.clinicalInferenceAllowed).toBe(false);
    expect(def.clarification).toBeDefined();
  });

  it("nerve_selections has clinicalInferenceAllowed false and clarification", () => {
    const def = lowerLimbSlotSchema.find((d) => d.factKey === "nerve_selections")!;
    expect(def.clinicalInferenceAllowed).toBe(false);
    expect(def.clarification).toBeDefined();
    expect(def.clarification!.question).toContain("[nerve]");
  });

  it("dbe_selections has clinicalInferenceAllowed false and clarification", () => {
    const def = lowerLimbSlotSchema.find((d) => d.factKey === "dbe_selections")!;
    expect(def.clinicalInferenceAllowed).toBe(false);
    expect(def.clarification).toBeDefined();
  });

  it("leg_amputation enum declares expected allowedValues", () => {
    const def = lowerLimbSlotSchema.find((d) => d.factKey === "leg_amputation")!;
    expect(def.allowedValues).toContain("none");
    expect(def.allowedValues).toContain("above_knee");
    expect(def.allowedValues).toContain("below_knee");
    expect(def.allowedValues).toContain("syme");
    expect(def.allowedValues).toContain("midtarsal");
    expect(def.allowedValues).toContain("transmetatarsal");
  });

  it("shortening_cm declares cm unit", () => {
    const def = lowerLimbSlotSchema.find((d) => d.factKey === "shortening_cm")!;
    expect(def.unit).toBe("cm");
  });
});

// ── deriveLowerLimbSignals ────────────────────────────────────────────────────

describe("deriveLowerLimbSignals", () => {
  it("returns empty object for empty facts", () => {
    expect(deriveLowerLimbSignals({})).toEqual({});
  });

  it("sets side signal", () => {
    const signals = deriveLowerLimbSignals({ side: makeFact("left") });
    expect(signals.side).toBe(true);
  });

  it("sets ROM signals for non-empty rom_joints", () => {
    const signals = deriveLowerLimbSignals({
      rom_joints: makeFact({ knee: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });
    expect(signals.rom_present).toBe(true);
    expect(signals.rom_joint).toBe(true);
    expect(signals.rom_measurements).toBe(true);
  });

  it("does not set ROM signals for empty rom_joints", () => {
    const signals = deriveLowerLimbSignals({ rom_joints: makeFact({}) });
    expect(signals.rom_present).toBeUndefined();
  });

  it("sets nerve signals for non-empty nerve_selections", () => {
    const signals = deriveLowerLimbSignals({
      nerve_selections: makeFact([{ nerveKey: "sciatic", deficitType: "motor", lossType: "partial" }]),
    });
    expect(signals.nerve_present).toBe(true);
    expect(signals.nerve_details).toBe(true);
  });

  it("does not set nerve signals for empty nerve_selections", () => {
    const signals = deriveLowerLimbSignals({ nerve_selections: makeFact([]) });
    expect(signals.nerve_present).toBeUndefined();
  });

  it("sets amputation_present for leg_amputation != none", () => {
    const signals = deriveLowerLimbSignals({ leg_amputation: makeFact("below_knee") });
    expect(signals.amputation_present).toBe(true);
  });

  it("does not set amputation_present for leg_amputation=none", () => {
    const signals = deriveLowerLimbSignals({ leg_amputation: makeFact("none") });
    expect(signals.amputation_present).toBeUndefined();
  });

  it("sets amputation_present for non-none toe_amputations", () => {
    const signals = deriveLowerLimbSignals({
      toe_amputations: makeFact({ great: "mtp", second: "none", third: "none", fourth: "none", fifth: "none" }),
    });
    expect(signals.amputation_present).toBe(true);
  });

  it("sets shortening signals for shortening_cm >= 0.5", () => {
    const signals = deriveLowerLimbSignals({ shortening_cm: makeFact(1.5) });
    expect(signals.shortening_present).toBe(true);
    expect(signals.shortening_cm).toBe(true);
  });

  it("does not set shortening signals for shortening_cm < 0.5", () => {
    const signals = deriveLowerLimbSignals({ shortening_cm: makeFact(0.2) });
    expect(signals.shortening_present).toBeUndefined();
  });

  it("sets dbe_present for non-empty dbe_selections", () => {
    const signals = deriveLowerLimbSignals({
      dbe_selections: makeFact([{ conditionId: "some_id", selectedPercent: 10 }]),
    });
    expect(signals.dbe_present).toBe(true);
  });

  it("sets rom_from_nerve signal", () => {
    const signals = deriveLowerLimbSignals({ rom_from_nerve: makeFact(true) });
    expect(signals.rom_from_nerve).toBe(true);
  });

  it("sets rom_from_nerve signal when false", () => {
    const signals = deriveLowerLimbSignals({ rom_from_nerve: makeFact(false) });
    expect(signals.rom_from_nerve).toBe(true);
  });
});

// ── validateLowerLimbReadinessFromSchema ──────────────────────────────────────

describe("validateLowerLimbReadinessFromSchema", () => {
  it("blocks on pending observations (D3)", () => {
    const result = validateLowerLimbReadinessFromSchema(stateWithPendingObs());
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("pending_observations");
  });

  it("requires side", () => {
    const result = validateLowerLimbReadinessFromSchema(stateWithFacts({}));
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("missing_side");
    expect(result.missingFields).toContain("side");
    expect(result.candidateAnswers).toContain("Left");
    expect(result.candidateAnswers).toContain("Right");
  });

  it("requires at least one assessable finding", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({ side: makeFact("left") }),
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no_assessable_finding");
    expect(result.missingFields).toContain("finding_type");
  });

  it("is ready with side + ROM", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("right"),
        rom_joints: makeFact({ knee: { isAnkylosed: false, measurements: { flexion: 90 } } }),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with side + nerve (fully specified)", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("left"),
        nerve_selections: makeFact([{ nerveKey: "tibial", deficitType: "sensory", lossType: "total" }]),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with side + leg amputation", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("left"),
        leg_amputation: makeFact("below_knee"),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with side + shortening >= 0.5 cm", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("right"),
        shortening_cm: makeFact(1.5),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("NOT ready with side + shortening < 0.5 cm", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("right"),
        shortening_cm: makeFact(0.3),
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no_assessable_finding");
  });

  it("requires rom_from_nerve when both ROM and nerve present", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("left"),
        rom_joints: makeFact({ hip: { isAnkylosed: false, measurements: { flexion: 60 } } }),
        nerve_selections: makeFact([{ nerveKey: "femoral", deficitType: "motor", lossType: "partial" }]),
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("missing_rom_from_nerve");
    expect(result.missingFields).toContain("rom_from_nerve");
  });

  it("is ready with side + ROM + nerve + rom_from_nerve", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("left"),
        rom_joints: makeFact({ hip: { isAnkylosed: false, measurements: { flexion: 60 } } }),
        nerve_selections: makeFact([{ nerveKey: "femoral", deficitType: "motor", lossType: "partial" }]),
        rom_from_nerve: makeFact(false),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with side + DBE selections", () => {
    const result = validateLowerLimbReadinessFromSchema(
      stateWithFacts({
        side: makeFact("right"),
        dbe_selections: makeFact([{ conditionId: "knee_oa", selectedPercent: 15 }]),
      }),
    );
    expect(result.ready).toBe(true);
  });
});
