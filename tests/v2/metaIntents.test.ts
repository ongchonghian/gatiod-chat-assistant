import { describe, expect, it } from "vitest";
import { classifyMetaIntent, META_INTENT_PATTERNS } from "../../src/v2/metaIntents.js";
import { processChatV2 } from "../../src/chat/chatServiceV2.js";
import { saveSessionSystemStates } from "../../src/db/sessionStore.js";
import { defaultV2SessionState, toSystemStateEnvelope } from "../../src/v2/stateMachine.js";
import type { GatiodSystemKey, V2SessionState } from "../../src/v2/contracts.js";

function withCalculated(state: V2SessionState, system: GatiodSystemKey, piPercent: number): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system)
      ? state.detectionOrder
      : [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "calculated", piPercent, completeness: 1 },
    },
  };
}

function withCollecting(state: V2SessionState, system: GatiodSystemKey): V2SessionState {
  return {
    ...state,
    detectionOrder: state.detectionOrder.includes(system)
      ? state.detectionOrder
      : [...state.detectionOrder, system],
    systems: {
      ...state.systems,
      [system]: { ...state.systems[system], status: "collecting" },
    },
  };
}

describe("META_INTENT_PATTERNS", () => {
  it("exposes one entry per MetaIntent.kind", () => {
    const kinds = META_INTENT_PATTERNS.map((p) => p.kind).sort();
    expect(kinds).toEqual(["finalise_claim", "jump_to_system", "skip_system", "status"]);
  });
});

describe("classifyMetaIntent — status", () => {
  it.each([
    ["where are we"],
    ["where are we?"],
    ["what's left"],
    ["whats left"],
    ["status"],
    ["summary"],
    ["show me the plan"],
    ["Where Are We"],
  ])("matches %s", (utterance) => {
    expect(classifyMetaIntent(utterance)).toEqual({ kind: "status" });
  });

  it.each([
    ["where did I leave my keys"],
    ["the status of the patient"],
    ["please summarise the spine finding"],
  ])("does not match %s (returns null)", (utterance) => {
    expect(classifyMetaIntent(utterance)).toBeNull();
  });
});

describe("classifyMetaIntent — finalise_claim", () => {
  it.each([
    ["submit"],
    ["Submit"],
    ["submit claim"],
    ["finalise"],
    ["finalize"],
    ["we're done"],
    ["were done"],
    ["that's everything"],
    ["i'm done"],
  ])("matches %s", (utterance) => {
    expect(classifyMetaIntent(utterance)).toEqual({ kind: "finalise_claim" });
  });

  it.each([
    ["submitting a complaint"],
    ["finalising the spine assessment first"],
    ["the patient said we're done with rehab"],
  ])("does not match %s (returns null)", (utterance) => {
    expect(classifyMetaIntent(utterance)).toBeNull();
  });
});

describe("classifyMetaIntent — skip_system", () => {
  it.each([
    ["skip CNS", "cns"],
    ["skip cns", "cns"],
    ["drop hearing", "hearing"],
    ["we don't need spine", "spine"],
    ["dont need spine", "spine"],
    ["exclude renal", "renal"],
    ["skip upper limb", "upper_limb"],
    ["skip shoulder", "upper_limb"], // via synonym table
  ])("matches %s → %s", (utterance, system) => {
    expect(classifyMetaIntent(utterance)).toEqual({ kind: "skip_system", system });
  });

  it("returns null when the system token is unrecognised", () => {
    expect(classifyMetaIntent("skip thingy")).toBeNull();
  });

  it("returns null when there is no token after the verb", () => {
    expect(classifyMetaIntent("skip")).toBeNull();
  });
});

describe("classifyMetaIntent — jump_to_system", () => {
  it.each([
    ["go back to upper limb", "upper_limb"],
    ["go back to spine", "spine"],
    ["edit shoulder", "upper_limb"], // via synonym
    ["revisit hearing", "hearing"],
  ])("matches %s → %s", (utterance, system) => {
    expect(classifyMetaIntent(utterance)).toEqual({ kind: "jump_to_system", system });
  });

  it("returns null for unrelated phrasings", () => {
    expect(classifyMetaIntent("go to the shop")).toBeNull();
    expect(classifyMetaIntent("edit the patient's age")).toBeNull(); // 'age' is not a system synonym
  });
});

describe("classifyMetaIntent — fallthrough", () => {
  it("returns null for empty input", () => {
    expect(classifyMetaIntent("")).toBeNull();
    expect(classifyMetaIntent("   ")).toBeNull();
  });

  it("returns null for clinical content (does not false-positive on real assessments)", () => {
    expect(classifyMetaIntent("Left shoulder flexion 90 degrees")).toBeNull();
    expect(classifyMetaIntent("Right ear AHL 75 dB")).toBeNull();
    expect(classifyMetaIntent("Lumbar disc prolapse with persistent radicular pain")).toBeNull();
  });
});

// ── End-to-end integration of meta-intents through processChatV2 ─────────────

describe("meta-intent integration (slice #10)", () => {
  function seedSession(sessionId: string, state: V2SessionState): void {
    saveSessionSystemStates(sessionId, toSystemStateEnvelope(state, {}));
  }

  it("'where are we' returns the claim plan as a deterministic clarify message", async () => {
    const sessionId = `meta-status-${Date.now()}-${Math.random()}`;
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    state = withCollecting(state, "spine");
    seedSession(sessionId, state);

    const r = await processChatV2(sessionId, "where are we", { shadow: true });
    expect(r.message).toMatch(/Claim plan:/);
    expect(r.message).toMatch(/Upper Limb: ✓ 12%/);
    expect(r.message).toMatch(/Spine: collecting/);
    // No tool calls — the response is rendered deterministically.
    expect(r.toolPlan.actual).toEqual([]);
  });

  it("'skip CNS' writes a skipped_by_user override and acknowledges", async () => {
    const sessionId = `meta-skip-${Date.now()}-${Math.random()}`;
    let state = defaultV2SessionState();
    state = withCalculated(state, "upper_limb", 12);
    state = withCollecting(state, "cns");
    seedSession(sessionId, state);

    const r = await processChatV2(sessionId, "skip CNS", { shadow: true });
    expect(r.message).toMatch(/(Central Nervous System|CNS) skipped/i);
    const cnsPill = r.claimPlan.systems.find((p) => p.system === "cns");
    expect(cnsPill?.status).toBe("skipped_by_user");
  });

  it("'submit' routes through meta and triggers the finalise_claim path", async () => {
    const sessionId = `meta-submit-${Date.now()}-${Math.random()}`;
    const state = withCalculated(defaultV2SessionState(), "upper_limb", 12);
    seedSession(sessionId, state);

    const r = await processChatV2(sessionId, "submit", { shadow: true });
    // Single-system submit produces the Final PI% line and marks the claim as submitted.
    expect(r.message).toMatch(/Final PI%:\s*12%/);
    expect(r.claimPlan.isSubmitted).toBe(true);
  });

  it("clinical content with no meta-intent match continues through normal routing", async () => {
    const sessionId = `meta-falls-through-${Date.now()}-${Math.random()}`;
    seedSession(sessionId, defaultV2SessionState());

    const r = await processChatV2(sessionId, "Left shoulder flexion 90 degrees", { shadow: true });
    // The router still produced a non-meta operation.
    expect(r.route.operation).not.toBe("meta");
    expect(r.route.operation).not.toBe("finalise_claim");
  });
});
