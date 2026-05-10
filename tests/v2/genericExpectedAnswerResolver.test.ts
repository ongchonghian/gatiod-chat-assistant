// Phase E — generic expectedAnswer resolver (issue #12, RC-5/RC-6).
//
// Many V2 systems emit clarification chips that the resolver never had a
// dedicated branch for: respiratory FVC/FEV1/DLCO numerics, respiratory
// asthma prereq confirmations, renal sex (Male/Female), spine diagnosis
// category. Rather than add four hardcoded branches, the resolver now
// honours a typed `expectedAnswer` declaration on any PendingObservation
// and graduates the doctor's reply into the named fact.

import { describe, expect, it } from "vitest";
import {
  defaultV2SessionState,
  applyStructuredExtraction,
} from "../../src/v2/stateMachine.js";
import { tryResolvePendingObservation } from "../../src/v2/pendingObservationResolver.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import type {
  GatiodSystemKey,
  PendingObservation,
  V2SessionState,
} from "../../src/v2/contracts.js";

const NOW = "2026-05-11T00:00:00.000Z";

function withPendingObs(
  system: GatiodSystemKey,
  obs: PendingObservation,
): V2SessionState {
  return applyStructuredExtraction(defaultV2SessionState(), system, {
    extractedFactsPatch: {},
    pendingObservationsToAdd: [obs],
    pendingObservationsToResolve: [],
    slotSignalsPatch: {},
    displayValuesPatch: {},
    warnings: [],
  });
}

describe("Generic expectedAnswer resolver — enum (renal sex)", () => {
  it("resolves a `Male` reply against an enum expectedAnswer", () => {
    const obs: PendingObservation = {
      id: "po-renal-sex-1",
      system: "renal",
      type: "renal_value",
      sourceText: "patient sex required",
      parsed: { subtype: "renal_sex" },
      missingFields: ["sex"],
      clarificationQuestion: "What is the patient's sex?",
      candidateAnswers: ["Male", "Female"],
      expectedAnswer: { kind: "enum", choices: ["Male", "Female"], factKey: "renal_sex" },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("renal", obs);
    const result = tryResolvePendingObservation(
      state,
      "renal",
      normalizeClinicalUtterance("Male"),
    );
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      const factValue = result.state.systems.renal.extractedFacts["renal_sex"]?.value;
      expect(factValue).toBe("Male");
    }
  });

  it("rejects an off-list reply", () => {
    const obs: PendingObservation = {
      id: "po-renal-sex-2",
      system: "renal",
      type: "renal_value",
      sourceText: "patient sex required",
      parsed: { subtype: "renal_sex" },
      missingFields: ["sex"],
      clarificationQuestion: "What is the patient's sex?",
      candidateAnswers: ["Male", "Female"],
      expectedAnswer: { kind: "enum", choices: ["Male", "Female"], factKey: "renal_sex" },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("renal", obs);
    const result = tryResolvePendingObservation(
      state,
      "renal",
      normalizeClinicalUtterance("Skip"),
    );
    expect(result.resolved).toBe(false);
    expect(result.blocked).toBe(true);
  });
});

describe("Generic expectedAnswer resolver — number (respiratory FVC)", () => {
  it("resolves `45` (or `45%`) into the named numeric fact", () => {
    const obs: PendingObservation = {
      id: "po-resp-fvc-1",
      system: "respiratory",
      type: "respiratory_value",
      sourceText: "FVC value missing",
      parsed: { subtype: "respiratory_fvc" },
      missingFields: ["fvc"],
      clarificationQuestion: "What is the patient's FVC % predicted?",
      expectedAnswer: { kind: "number", factKey: "respiratory_fvc", unit: "percent", min: 0, max: 100 },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("respiratory", obs);
    const result = tryResolvePendingObservation(
      state,
      "respiratory",
      normalizeClinicalUtterance("45"),
    );
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      const fact = result.state.systems.respiratory.extractedFacts["respiratory_fvc"];
      expect(fact?.value).toBe(45);
    }
  });

  it("rejects a non-numeric reply", () => {
    const obs: PendingObservation = {
      id: "po-resp-fvc-2",
      system: "respiratory",
      type: "respiratory_value",
      sourceText: "FVC value missing",
      parsed: { subtype: "respiratory_fvc" },
      missingFields: ["fvc"],
      clarificationQuestion: "What is the patient's FVC % predicted?",
      expectedAnswer: { kind: "number", factKey: "respiratory_fvc", unit: "percent" },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("respiratory", obs);
    const result = tryResolvePendingObservation(
      state,
      "respiratory",
      normalizeClinicalUtterance("not sure"),
    );
    expect(result.resolved).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("rejects a number outside [min, max] range", () => {
    const obs: PendingObservation = {
      id: "po-resp-fvc-3",
      system: "respiratory",
      type: "respiratory_value",
      sourceText: "FVC value missing",
      parsed: { subtype: "respiratory_fvc" },
      missingFields: ["fvc"],
      clarificationQuestion: "What is the patient's FVC % predicted?",
      expectedAnswer: { kind: "number", factKey: "respiratory_fvc", unit: "percent", min: 0, max: 100 },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("respiratory", obs);
    const result = tryResolvePendingObservation(
      state,
      "respiratory",
      normalizeClinicalUtterance("250"),
    );
    expect(result.resolved).toBe(false);
  });
});

describe("Generic expectedAnswer resolver — enum (spine category)", () => {
  it("resolves an `Intervertebral Disc` chip reply into the spine category fact", () => {
    const obs: PendingObservation = {
      id: "po-spine-cat-1",
      system: "spine",
      type: "spine_category",
      sourceText: "spine diagnosis category required",
      parsed: { subtype: "spine_category" },
      missingFields: ["diagnosis_category"],
      clarificationQuestion: "What spine injury category applies?",
      candidateAnswers: [
        "Fractures / Dislocations",
        "Spinal Cord / Cauda Equina Injury",
        "Intervertebral Disc",
      ],
      expectedAnswer: {
        kind: "enum",
        choices: [
          "Fractures / Dislocations",
          "Spinal Cord / Cauda Equina Injury",
          "Intervertebral Disc",
        ],
        factKey: "spine_diagnosis_category",
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("spine", obs);
    const result = tryResolvePendingObservation(
      state,
      "spine",
      normalizeClinicalUtterance("Intervertebral Disc"),
    );
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      const fact = result.state.systems.spine.extractedFacts["spine_diagnosis_category"];
      expect(fact?.value).toBe("Intervertebral Disc");
    }
  });
});

describe("Generic expectedAnswer resolver — respiratory asthma prereq confirms", () => {
  it("resolves a chip reply matching one of the asthma prereq enum choices", () => {
    const obs: PendingObservation = {
      id: "po-resp-asthma-1",
      system: "respiratory",
      type: "respiratory_value",
      sourceText: "asthma prerequisite confirmation required",
      parsed: { subtype: "asthma_maintenance" },
      missingFields: ["asthma_maintenance_confirmation"],
      clarificationQuestion: "Confirm asthma prerequisites:",
      candidateAnswers: [
        "Confirm daily maintenance required",
        "Confirm transferred from exposure ≥1 year",
        "Confirm unlikely further improvement",
      ],
      expectedAnswer: {
        kind: "enum",
        choices: [
          "Confirm daily maintenance required",
          "Confirm transferred from exposure ≥1 year",
          "Confirm unlikely further improvement",
        ],
        factKey: "asthma_prereq_confirmation",
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObs("respiratory", obs);
    const result = tryResolvePendingObservation(
      state,
      "respiratory",
      normalizeClinicalUtterance("Confirm daily maintenance required"),
    );
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      const fact = result.state.systems.respiratory.extractedFacts["asthma_prereq_confirmation"];
      expect(fact?.value).toBe("Confirm daily maintenance required");
    }
  });
});
