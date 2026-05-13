// Phase E end-to-end — readiness → PendingObservation → generic resolver.
//
// When a readiness validator declares an `expectedAnswer`, the chat
// service writes a PendingObservation carrying the schema. The generic
// resolver then graduates the doctor's reply into the named fact on
// the next turn. (Issue #12, RC-5/RC-6)

import { describe, expect, it } from "vitest";
import {
  defaultV2SessionState,
} from "../../src/v2/stateMachine.js";
import { writeReadinessAsPendingObservation } from "../../src/chat/chatServiceV2.js";
import { tryResolvePendingObservation } from "../../src/v2/pendingObservationResolver.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import type { ReadinessResult } from "../../src/v2/contracts.js";

describe("Readiness with expectedAnswer becomes a resolvable PendingObservation", () => {
  it("renal sex: writes pending obs, then `Male` graduates renal_sex", () => {
    const readiness: ReadinessResult = {
      ready: false,
      reason: "missing_sex",
      clarificationQuestion: "What is the patient's sex?",
      candidateAnswers: ["Male", "Female"],
      missingFields: ["renal_sex"],
      expectedAnswer: { kind: "enum", choices: ["Male", "Female"], factKey: "renal_sex" },
    };

    const after = writeReadinessAsPendingObservation(
      defaultV2SessionState(),
      "renal",
      readiness,
      "59 year old patient with serum creatinine 200",
    );
    expect(after.systems.renal.pendingObservations).toHaveLength(1);
    expect(after.systems.renal.pendingObservations[0].expectedAnswer).toEqual(
      readiness.expectedAnswer,
    );

    const resolved = tryResolvePendingObservation(
      after,
      "renal",
      normalizeClinicalUtterance("Male"),
    );
    expect(resolved.resolved).toBe(true);
    if (resolved.resolved) {
      expect(resolved.state.systems.renal.extractedFacts["renal_sex"]?.value).toBe("Male");
    }
  });

  it("does not duplicate when readiness fires twice for the same factKey", () => {
    const readiness: ReadinessResult = {
      ready: false,
      reason: "missing_sex",
      clarificationQuestion: "What is the patient's sex?",
      candidateAnswers: ["Male", "Female"],
      expectedAnswer: { kind: "enum", choices: ["Male", "Female"], factKey: "renal_sex" },
    };
    let s = defaultV2SessionState();
    s = writeReadinessAsPendingObservation(s, "renal", readiness, "src");
    s = writeReadinessAsPendingObservation(s, "renal", readiness, "src");
    expect(s.systems.renal.pendingObservations).toHaveLength(1);
  });

  it("is a no-op when readiness has no expectedAnswer", () => {
    const readiness: ReadinessResult = {
      ready: false,
      reason: "no_classifying_input",
      clarificationQuestion: "Please provide PFT values.",
      candidateAnswers: ["FVC", "FEV1", "DLCO"],
      // intentionally no expectedAnswer
    };
    const after = writeReadinessAsPendingObservation(
      defaultV2SessionState(),
      "respiratory",
      readiness,
      "src",
    );
    expect(after.systems.respiratory.pendingObservations).toHaveLength(0);
  });
});
