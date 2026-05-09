import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePolicyDecision } from "../../src/v2/policyEngine.js";
import {
  defaultV2SessionState,
  hashExtractedFacts,
  setConfirmationPending,
  setInstanceConfirmationPending,
  upsertInstance,
} from "../../src/v2/stateMachine.js";
import * as SystemRegistry from "../../src/v2/systemRegistry.js";
import {
  HEARING_FK_AGE,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_PATH,
  HEARING_FK_RIGHT_EAR_AHL,
} from "../../src/v2/extractors/hearing.js";
import type {
  GroundingResult,
  NormalizedUtterance,
  V2AssessmentInstance,
  V2SessionState,
  V2SystemFacts,
} from "../../src/v2/contracts.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

const confirmUtterance: NormalizedUtterance = {
  raw: "confirm and calculate",
  normalizedText: "confirm and calculate",
  tokens: ["confirm", "and", "calculate"],
  mappedTokens: [],
  unresolvedTerms: [],
  confidence: 0.95,
};

const assessmentRoute = {
  operation: "assessment" as const,
  systems: ["hearing" as const],
  confidence: 0.9,
  reasons: [],
};

const emptyGrounding: GroundingResult = {
  citations: [],
  ontologyMatches: [],
};

const NID_FACTS: V2SystemFacts = {
  [HEARING_FK_PATH]: fact("nid"),
  [HEARING_FK_LEFT_EAR_AHL]: fact(65),
  [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
  [HEARING_FK_AGE]: fact(55),
};

function makeHearingInstance(
  instanceId: string,
  facts: V2SystemFacts,
  confirmationHash?: string
): V2AssessmentInstance {
  const now = nowIso();
  return {
    instanceId,
    system: "hearing",
    slotPath: instanceId.split("::").slice(1),
    facts,
    pendingObservations: [],
    confirmation: {
      status: confirmationHash ? "pending" : "not_confirmed",
      confirmationSummary: confirmationHash ? "Hearing summary" : undefined,
      factsHash: confirmationHash,
    },
    status: "collecting",
    piPercent: null,
    trace: null,
    updatedAt: now,
  };
}

function stateWithHearingConfirmation(
  instanceFacts: V2SystemFacts,
  instanceConfirmationHash?: string
): V2SessionState {
  let state = defaultV2SessionState();

  // Flat system state (may differ from instance facts to test precedence).
  state = setConfirmationPending(state, "hearing", "System-level summary");

  // Insert the active instance.
  const instance = makeHearingInstance("hearing::global", instanceFacts, instanceConfirmationHash);
  state = upsertInstance(state, instance);

  // Set pendingConfirmation so policyEngine enters the confirmation-handling block.
  state = {
    ...state,
    pendingConfirmation: { system: "hearing", summary: "System-level summary", createdAt: nowIso() },
  };

  return state;
}

// ── Mock setup ─────────────────────────────────────────────────────────────────
// Hearing is now structured_live in the real registry. The spy here narrows
// isStructuredLiveSystem to hearing-only so policyEngine tests for non-hearing
// systems remain unaffected by the promotion of other systems.

beforeEach(() => {
  vi.spyOn(SystemRegistry, "isStructuredLiveSystem").mockImplementation(
    (s) => s === "hearing"
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("policyEngine — instance-aware arg builder path", () => {
  it("uses instance facts (not systemState facts) for hash check and produces execute_tools when hash matches", () => {
    // Instance has fresh NID facts; confirmation hash was snapshotted from those same facts.
    const state = stateWithHearingConfirmation(NID_FACTS);
    // Snapshot the instance confirmation so the hash matches.
    const stateWithSnapshot = setInstanceConfirmationPending(state, "hearing::global", "Hearing summary");

    const decision = makePolicyDecision(assessmentRoute, confirmUtterance, emptyGrounding, stateWithSnapshot);

    expect(decision.action).toBe("execute_tools");
    expect(decision.proposedTools[0]?.name).toBe("assess_hearing");
  });

  it("detects stale confirmation when instance facts changed after snapshot", () => {
    // Snapshot was made with NID_FACTS; now we add occupational years to the instance,
    // making the hash different from the snapshot.
    const staleHash = hashExtractedFacts(NID_FACTS); // hash from before the change
    const updatedFacts: V2SystemFacts = {
      ...NID_FACTS,
      hearing_occupational_years: fact(20), // fact added AFTER snapshot
    };

    const state = stateWithHearingConfirmation(updatedFacts, staleHash);

    const decision = makePolicyDecision(assessmentRoute, confirmUtterance, emptyGrounding, state);

    expect(decision.action).toBe("clarify");
    expect(decision.clarificationQuestion).toBe("__REBUILD_CONFIRMATION__");
  });

  it("falls back to systemState hash when no active instance exists", () => {
    // State with only flat system state, no instances.
    let state = defaultV2SessionState();
    state = setConfirmationPending(state, "hearing", "Summary");
    state = {
      ...state,
      pendingConfirmation: { system: "hearing", summary: "Summary", createdAt: nowIso() },
    };
    // System-state extractedFacts = NID_FACTS (hash should match).
    state = {
      ...state,
      systems: {
        ...state.systems,
        hearing: {
          ...state.systems.hearing,
          extractedFacts: NID_FACTS,
          confirmation: {
            status: "pending",
            confirmationSummary: "Summary",
            factsHash: hashExtractedFacts(NID_FACTS),
          },
        },
      },
    };

    const decision = makePolicyDecision(assessmentRoute, confirmUtterance, emptyGrounding, state);

    // No instance → falls back to systemState facts → hash matches → execute_tools
    expect(decision.action).toBe("execute_tools");
    expect(decision.proposedTools[0]?.name).toBe("assess_hearing");
  });

  it("instance hash beats systemState hash: execute_tools even when systemState hash is stale", () => {
    // Instance hash is fresh; systemState hash is stale.
    // This proves instance facts take precedence over flat system state.
    let state = stateWithHearingConfirmation(NID_FACTS);
    // Snapshot the instance confirmation (correct hash).
    state = setInstanceConfirmationPending(state, "hearing::global", "Hearing summary");
    // Deliberately corrupt the system-state confirmation hash to a stale value.
    state = {
      ...state,
      systems: {
        ...state.systems,
        hearing: {
          ...state.systems.hearing,
          confirmation: {
            status: "pending",
            confirmationSummary: "Summary",
            factsHash: "0000000000000000", // stale garbage
          },
        },
      },
    };

    const decision = makePolicyDecision(assessmentRoute, confirmUtterance, emptyGrounding, state);

    // Instance hash is correct → execute_tools, not a stale-confirmation clarify.
    expect(decision.action).toBe("execute_tools");
  });

  it("systemState hash mismatch triggers rebuild when no active instance", () => {
    // No instance; systemState confirmation hash is stale.
    let state = defaultV2SessionState();
    state = {
      ...state,
      systems: {
        ...state.systems,
        hearing: {
          ...state.systems.hearing,
          extractedFacts: NID_FACTS,
          confirmation: {
            status: "pending",
            confirmationSummary: "Summary",
            factsHash: "0000000000000000", // stale
          },
        },
      },
      pendingConfirmation: { system: "hearing", summary: "Summary", createdAt: nowIso() },
    };

    const decision = makePolicyDecision(assessmentRoute, confirmUtterance, emptyGrounding, state);

    expect(decision.action).toBe("clarify");
    expect(decision.clarificationQuestion).toBe("__REBUILD_CONFIRMATION__");
  });
});
