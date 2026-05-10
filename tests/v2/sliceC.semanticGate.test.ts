import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shouldRunSemanticConsensus } from "../../src/v2/semanticConsensusGate.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import {
  defaultV2SessionState,
  setPendingConsensus,
} from "../../src/v2/stateMachine.js";
import type {
  GatiodSystemKey,
  PendingObservation,
  V2SessionState,
} from "../../src/v2/contracts.js";

// Slice C — deterministic semantic consensus gate (REQ-SC-GATE-001).
// The gate is feature-flagged off by default; tests pass `forceEnabled: true`
// to exercise the trigger logic. The default-off behaviour is verified
// separately so the existing pipeline is provably unchanged.

const NOW = "2026-05-10T00:00:00.000Z";

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
      },
    },
  };
}

describe("Slice C — feature flag default", () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.SEMANTIC_CONSENSUS_ENABLED; delete process.env.SEMANTIC_CONSENSUS_ENABLED; });
  afterEach(() => { if (saved !== undefined) process.env.SEMANTIC_CONSENSUS_ENABLED = saved; else delete process.env.SEMANTIC_CONSENSUS_ENABLED; });

  it("returns shouldRun: false with skipReason 'feature_flag_disabled' when env var is not set", () => {
    const norm = normalizeClinicalUtterance(
      "Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia after olfactory nerve injury.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
    });
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe("feature_flag_disabled");
  });
});

describe("Slice C — pending-state skip signals", () => {
  it("skips when pendingConsensus is set", () => {
    const state = setPendingConsensus(defaultV2SessionState(), {
      interpretationId: "i",
      interpretationHash: "h1",
      sourceHash: "h2",
      sourceText: "x",
      message: "m",
      candidateSystems: ["spine"],
      createdAt: NOW,
      awaiting: "decision",
    });
    const norm = normalizeClinicalUtterance("Multi-system polytrauma with spine and hearing.");
    const result = shouldRunSemanticConsensus({ normalized: norm, state, forceEnabled: true });
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe("pending_consensus");
  });

  it("skips when pendingConfirmation is set", () => {
    const state: V2SessionState = {
      ...defaultV2SessionState(),
      pendingConfirmation: { system: "spine", summary: "x", createdAt: NOW },
    };
    const norm = normalizeClinicalUtterance("Spine; hearing; lower limb finding.");
    const result = shouldRunSemanticConsensus({ normalized: norm, state, forceEnabled: true });
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe("pending_confirmation");
  });

  it("skips when pendingGlobalCvcConfirmation is set", () => {
    const state: V2SessionState = {
      ...defaultV2SessionState(),
      pendingGlobalCvcConfirmation: {
        status: "pending",
        componentSystems: ["hearing", "spine"],
        componentValues: [30, 5],
        createdAt: NOW,
      },
    };
    const norm = normalizeClinicalUtterance("Multi-system polytrauma scenario.");
    const result = shouldRunSemanticConsensus({ normalized: norm, state, forceEnabled: true });
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe("pending_global_cvc");
  });

  it("skips when any system has a pending observation", () => {
    const obs: PendingObservation = {
      id: "o",
      system: "spine",
      type: "other",
      sourceText: "x",
      parsed: {},
      missingFields: [],
      clarificationQuestion: "Which region?",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const state = withPendingObservation(defaultV2SessionState(), "spine", obs);
    const norm = normalizeClinicalUtterance("Cervical, lumbar; hearing AHL 90.");
    const result = shouldRunSemanticConsensus({ normalized: norm, state, forceEnabled: true });
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe("pending_observation");
  });
});

describe("Slice C — short workflow replies are skipped", () => {
  const replies = [
    "yes",
    "Confirm",
    "Proceed",
    "Edit",
    "Skip",
    "left",
    "right",
    "Flexion",
    "Partial",
    "Total",
    "Combine",
  ];
  for (const reply of replies) {
    it(`skips on short workflow reply '${reply}'`, () => {
      const norm = normalizeClinicalUtterance(reply);
      const result = shouldRunSemanticConsensus({
        normalized: norm,
        state: defaultV2SessionState(),
        forceEnabled: true,
      });
      expect(result.shouldRun).toBe(false);
      expect(result.skipReason).toBe("short_workflow_reply");
    });
  }
});

describe("Slice C — multi-system trigger", () => {
  it("triggers when ≥2 distinct systems are detected", () => {
    const norm = normalizeClinicalUtterance(
      "Right ear AHL 90 dB after blast; thoraco-lumbar compression fracture <25% with residual pain.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reasons).toContain("multiple_systems_detected");
    expect(result.detectedSystems.length).toBeGreaterThanOrEqual(2);
    expect(result.detectedSystems).toContain("hearing");
    expect(result.detectedSystems).toContain("spine");
  });

  it("does not trigger multi_system on a clean single-system input", () => {
    const norm = normalizeClinicalUtterance("Right ear AHL 90 dB injury.");
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    // May still trigger via dense narrative or other reasons — but
    // multi_system should NOT be among them.
    expect(result.reasons).not.toContain("multiple_systems_detected");
  });
});

describe("Slice C — legacy/deferred trigger", () => {
  it("triggers when CNS olfactory term is present", () => {
    const norm = normalizeClinicalUtterance(
      "Complete anosmia after traumatic olfactory nerve injury.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reasons).toContain("legacy_deferred_system_detected");
  });

  it("triggers when visual diplopia term is present", () => {
    const norm = normalizeClinicalUtterance(
      "Persistent diplopia with central scotoma after traumatic brain injury.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reasons).toContain("legacy_deferred_system_detected");
  });
});

describe("Slice C — dense-narrative trigger", () => {
  it("triggers on a long mechanism-prefixed multi-clause utterance with semicolons", () => {
    const norm = normalizeClinicalUtterance(
      "Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reasons).toContain("dense_clinical_narrative");
  });

  it("does not trigger dense_narrative on a short single-clause utterance", () => {
    const norm = normalizeClinicalUtterance("Right ear AHL 90 dB.");
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.reasons).not.toContain("dense_clinical_narrative");
  });
});

describe("Slice C — scope-conflict trigger", () => {
  it("triggers when multiple spine regions appear in one utterance", () => {
    const norm = normalizeClinicalUtterance(
      "Cervical prolapsed disc with sensory deficit and lumbo-sacral compression burst fracture.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reasons).toContain("scope_conflict");
    expect(result.triggerKind).toBe("scope_conflict");
  });

  it("triggers when both eyes are mentioned together", () => {
    const norm = normalizeClinicalUtterance(
      "Left eye 6/60 visual acuity and right eye 6/18 visual acuity.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reasons).toContain("scope_conflict");
  });

  it("triggers when both ears are mentioned together", () => {
    const norm = normalizeClinicalUtterance(
      "Left ear AHL 90 and right ear AHL 80 after blast injury.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.reasons).toContain("scope_conflict");
  });
});

describe("Slice C — triggerKind classification priority", () => {
  it("scope_conflict beats multi_system when both fire", () => {
    const norm = normalizeClinicalUtterance(
      "Cervical and lumbo-sacral spine injury plus right ear AHL 90.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.triggerKind).toBe("scope_conflict");
  });

  it("legacy_deferred beats multi_system when both fire", () => {
    const norm = normalizeClinicalUtterance(
      "Right common peroneal nerve lesion with motor deficit and complete anosmia after head injury sustained.",
    );
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.triggerKind).toBe("legacy_deferred");
  });
});

describe("Slice C — empty text is skipped", () => {
  it("returns shouldRun: false for empty input", () => {
    const norm = normalizeClinicalUtterance("");
    const result = shouldRunSemanticConsensus({
      normalized: norm,
      state: defaultV2SessionState(),
      forceEnabled: true,
    });
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe("empty_text");
  });
});
