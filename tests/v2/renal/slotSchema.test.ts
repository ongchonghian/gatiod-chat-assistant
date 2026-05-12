/**
 * Renal slot schema tests — ADR-0004.
 *
 * Covers:
 *   1. Schema shape — all required SlotDefinition fields present on each slot.
 *   2. deriveRenalSignals — maps facts to correct SlotSignals booleans.
 *   3. validateRenalReadinessFromSchema — per-slot and cross-slot conditions.
 */

import { describe, expect, it } from "vitest";
import { renalSlotSchema, type RenalFactKey } from "../../../src/v2/slotSchemas/renal.js";
import {
  deriveRenalSignals,
  validateRenalReadinessFromSchema,
} from "../../../src/v2/slotSchemas/renalExtractor.js";
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
  const base = defaultV2SessionState().systems.renal;
  return { ...base, extractedFacts: facts };
}

function stateWithPendingObs(): V2SystemState {
  const base = defaultV2SessionState().systems.renal;
  return {
    ...base,
    pendingObservations: [
      {
        id: "obs-1",
        system: "renal",
        type: "other",
        sourceText: "test",
        parsed: {},
        missingFields: ["renal_sex"],
        clarificationQuestion: "What is the patient's sex?",
        candidateAnswers: ["Male", "Female"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

// ── Schema shape ──────────────────────────────────────────────────────────────

describe("renalSlotSchema shape", () => {
  const EXPECTED_KEYS: RenalFactKey[] = [
    "renal_sex",
    "renal_serum_creatinine",
    "renal_creatinine_clearance",
    "renal_ckd_stage",
    "renal_clinical_severity",
    "renal_solitary_kidney",
    "renal_provisional_award",
  ];

  it("contains all 7 fact keys", () => {
    const keys = renalSlotSchema.map((d) => d.factKey);
    expect(keys).toEqual(expect.arrayContaining(EXPECTED_KEYS));
    expect(keys).toHaveLength(7);
  });

  it("every slot has required fields", () => {
    for (const def of renalSlotSchema) {
      expect(def.factKey, "factKey").toBeTruthy();
      expect(def.label, `${def.factKey}.label`).toBeTruthy();
      expect(def.description, `${def.factKey}.description`).toBeTruthy();
      expect(def.valueType, `${def.factKey}.valueType`).toBeTruthy();
      expect(def.required_when, `${def.factKey}.required_when`).toBeDefined();
      expect(typeof def.clinicalInferenceAllowed, `${def.factKey}.clinicalInferenceAllowed`).toBe("boolean");
    }
  });

  it("renal_sex is required_when always and has clarification", () => {
    const def = renalSlotSchema.find((d) => d.factKey === "renal_sex")!;
    expect(def.required_when).toBe("always");
    expect(def.clinicalInferenceAllowed).toBe(false);
    expect(def.clarification).toBeDefined();
    expect(def.clarification!.candidateAnswers).toContain("Male");
    expect(def.clarification!.candidateAnswers).toContain("Female");
  });

  it("optional slots are required_when never", () => {
    const optionalKeys: RenalFactKey[] = [
      "renal_serum_creatinine",
      "renal_creatinine_clearance",
      "renal_ckd_stage",
      "renal_clinical_severity",
      "renal_solitary_kidney",
      "renal_provisional_award",
    ];
    for (const key of optionalKeys) {
      const def = renalSlotSchema.find((d) => d.factKey === key)!;
      expect(def.required_when, key).toBe("never");
    }
  });

  it("enum slots declare allowedValues", () => {
    const sexDef = renalSlotSchema.find((d) => d.factKey === "renal_sex")!;
    expect(sexDef.allowedValues).toEqual(["male", "female"]);

    const sevDef = renalSlotSchema.find((d) => d.factKey === "renal_clinical_severity")!;
    expect(sevDef.allowedValues).toContain("persisting");
    expect(sevDef.allowedValues).toContain("incompletely_controlled");
    expect(sevDef.allowedValues).toContain("continuous_surveillance");
    expect(sevDef.allowedValues).toContain("none");
  });

  it("number slots declare a unit", () => {
    const scDef = renalSlotSchema.find((d) => d.factKey === "renal_serum_creatinine")!;
    expect(scDef.unit).toBe("µmol/L");
    const ccDef = renalSlotSchema.find((d) => d.factKey === "renal_creatinine_clearance")!;
    expect(ccDef.unit).toBe("mL/min");
  });
});

// ── deriveRenalSignals ────────────────────────────────────────────────────────

describe("deriveRenalSignals", () => {
  it("returns empty object for empty facts", () => {
    expect(deriveRenalSignals({})).toEqual({});
  });

  it("sets sex signal", () => {
    const signals = deriveRenalSignals({ renal_sex: makeFact("male") });
    expect(signals.sex).toBe(true);
    expect(signals.renal_inputs).toBeUndefined();
  });

  it("sets renal_inputs when serum creatinine present", () => {
    const signals = deriveRenalSignals({ renal_serum_creatinine: makeFact(180) });
    expect(signals.renal_inputs).toBe(true);
  });

  it("sets renal_inputs when creatinine clearance present", () => {
    const signals = deriveRenalSignals({ renal_creatinine_clearance: makeFact(45) });
    expect(signals.renal_inputs).toBe(true);
  });

  it("sets renal_inputs when CKD stage present", () => {
    const signals = deriveRenalSignals({ renal_ckd_stage: makeFact(3) });
    expect(signals.renal_inputs).toBe(true);
  });

  it("sets renal_inputs and clinical_severity when severity present", () => {
    const signals = deriveRenalSignals({ renal_clinical_severity: makeFact("persisting") });
    expect(signals.renal_inputs).toBe(true);
    expect(signals.clinical_severity).toBe(true);
  });

  it("sets solitary_kidney signal", () => {
    const signals = deriveRenalSignals({ renal_solitary_kidney: makeFact(true) });
    expect(signals.solitary_kidney).toBe(true);
  });

  it("sets provisional_award signal", () => {
    const signals = deriveRenalSignals({ renal_provisional_award: makeFact(true) });
    expect(signals.provisional_award).toBe(true);
  });

  it("sets all signals for a complete extraction", () => {
    const facts: V2SystemFacts = {
      renal_sex: makeFact("female"),
      renal_serum_creatinine: makeFact(150),
      renal_clinical_severity: makeFact("incompletely_controlled"),
      renal_solitary_kidney: makeFact(false),
    };
    const signals = deriveRenalSignals(facts);
    expect(signals.sex).toBe(true);
    expect(signals.renal_inputs).toBe(true);
    expect(signals.clinical_severity).toBe(true);
    expect(signals.solitary_kidney).toBe(true);
  });
});

// ── validateRenalReadinessFromSchema ──────────────────────────────────────────

describe("validateRenalReadinessFromSchema", () => {
  it("blocks on pending observations (D3)", () => {
    const result = validateRenalReadinessFromSchema(stateWithPendingObs());
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("pending_observations");
  });

  it("requires renal_sex", () => {
    const result = validateRenalReadinessFromSchema(stateWithFacts({}));
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("missing_renal_sex");
    expect(result.missingFields).toContain("renal_sex");
    expect(result.candidateAnswers).toContain("Male");
  });

  it("requires at least one classifying input", () => {
    const result = validateRenalReadinessFromSchema(
      stateWithFacts({ renal_sex: makeFact("male") }),
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no_classifying_input");
  });

  it("is ready with sex + serum creatinine", () => {
    const result = validateRenalReadinessFromSchema(
      stateWithFacts({
        renal_sex: makeFact("female"),
        renal_serum_creatinine: makeFact(180),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with sex + creatinine clearance", () => {
    const result = validateRenalReadinessFromSchema(
      stateWithFacts({
        renal_sex: makeFact("male"),
        renal_creatinine_clearance: makeFact(40),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with sex + CKD stage", () => {
    const result = validateRenalReadinessFromSchema(
      stateWithFacts({
        renal_sex: makeFact("male"),
        renal_ckd_stage: makeFact(4),
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("is ready with sex + clinical severity", () => {
    const result = validateRenalReadinessFromSchema(
      stateWithFacts({
        renal_sex: makeFact("female"),
        renal_clinical_severity: makeFact("persisting"),
      }),
    );
    expect(result.ready).toBe(true);
  });
});
