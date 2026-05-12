// Global CVC offer-then-combine flow (Q4) — derived soft queue,
// explicit confirmation, vanilla CVC. The scaffold-collapse case finally
// produces a final combined PI%, which was the user-visible win in slice 3.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../src/chat/chatServiceV2.js";
import {
  buildGlobalCvcOffer,
  combineCalculatedSystemPis,
  getCalculatedSystems,
  shouldOfferGlobalCvc,
  verifyGlobalCvcSnapshot,
} from "../../src/v2/globalCvc.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type { V2SessionState } from "../../src/v2/contracts.js";

let _savedExtractorFlag: string | undefined;
let _savedComparisonFlag: string | undefined;
beforeAll(() => {
  process.env.GATIOD_DB_PATH = ":memory:";
  _savedExtractorFlag = process.env.LLM_EXTRACTOR_ENABLED;
  _savedComparisonFlag = process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
  process.env.LLM_EXTRACTOR_ENABLED = "false";
  process.env.LLM_EXTRACTOR_COMPARISON_ENABLED = "false";
});
afterAll(() => {
  if (_savedExtractorFlag !== undefined) {
    process.env.LLM_EXTRACTOR_ENABLED = _savedExtractorFlag;
  } else {
    delete process.env.LLM_EXTRACTOR_ENABLED;
  }
  if (_savedComparisonFlag !== undefined) {
    process.env.LLM_EXTRACTOR_COMPARISON_ENABLED = _savedComparisonFlag;
  } else {
    delete process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
  }
});

function withCalculatedSystems(
  base: V2SessionState,
  rows: Array<{ system: keyof V2SessionState["systems"]; piPercent: number }>,
): V2SessionState {
  const next: V2SessionState = { ...base, systems: { ...base.systems } };
  for (const row of rows) {
    next.systems[row.system] = {
      ...next.systems[row.system],
      status: "calculated",
      piPercent: row.piPercent,
    };
  }
  return next;
}

describe("globalCvc helpers", () => {
  it("getCalculatedSystems returns largest first; ignores systems without a piPercent", () => {
    const state = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 30 },
    ]);

    const calculated = getCalculatedSystems(state);
    expect(calculated.map((c) => c.system)).toEqual(["hearing", "spine"]);
    expect(calculated.map((c) => c.piPercent)).toEqual([30, 5]);
  });

  it("getCalculatedSystems excludes systems with status != 'calculated'", () => {
    const base = defaultV2SessionState();
    base.systems.spine = { ...base.systems.spine, status: "calculated", piPercent: 5 };
    base.systems.hearing = { ...base.systems.hearing, status: "collecting", piPercent: 30 };
    expect(getCalculatedSystems(base).map((c) => c.system)).toEqual(["spine"]);
  });

  it("shouldOfferGlobalCvc returns true with ≥2 calculated systems and no pending offer", () => {
    const state = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 30 },
    ]);
    expect(shouldOfferGlobalCvc(state)).toBe(true);
  });

  it("shouldOfferGlobalCvc returns false with only one calculated system", () => {
    const state = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
    ]);
    expect(shouldOfferGlobalCvc(state)).toBe(false);
  });

  it("shouldOfferGlobalCvc returns false when an offer is already pending", () => {
    let state = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 30 },
    ]);
    state = {
      ...state,
      pendingGlobalCvcConfirmation: {
        status: "pending",
        componentSystems: ["hearing", "spine"],
        componentValues: [30, 5],
        createdAt: new Date().toISOString(),
      },
    };
    expect(shouldOfferGlobalCvc(state)).toBe(false);
  });

  it("buildGlobalCvcOffer produces a snapshot whose hashes verify against unchanged state", () => {
    const state = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 30 },
    ]);
    const offer = buildGlobalCvcOffer(state);
    expect(offer).not.toBeNull();
    expect(offer!.chips).toEqual(["Combine", "Add another system", "Edit a finding"]);
    expect(offer!.appendMessage).toContain("Spine: 5%");
    expect(offer!.appendMessage).toContain("Hearing: 30%");

    const verification = verifyGlobalCvcSnapshot(state, offer!.snapshot);
    expect(verification.ok).toBe(true);
    expect(verification.divergedSystems).toEqual([]);
    expect(verification.missingSystems).toEqual([]);
    expect(verification.addedSystems).toEqual([]);
  });

  it("verifyGlobalCvcSnapshot detects diverged values", () => {
    const initial = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 30 },
    ]);
    const offer = buildGlobalCvcOffer(initial)!;
    // Simulate the doctor editing hearing → piPercent changes.
    const after = withCalculatedSystems(defaultV2SessionState(), [
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 35 },
    ]);
    const v = verifyGlobalCvcSnapshot(after, offer.snapshot);
    expect(v.ok).toBe(false);
    expect(v.divergedSystems).toContain("hearing");
  });

  it("combineCalculatedSystemPis applies vanilla CVC; spine 5 + hearing 30 → 34", () => {
    const result = combineCalculatedSystemPis([
      { system: "spine", piPercent: 5 },
      { system: "hearing", piPercent: 30 },
    ]);
    expect(result).toBeCloseTo(34, 1);
  });
});

describe("Global CVC offer-then-combine — scaffold-collapse end-to-end", () => {
  it("offers global CVC after handoff; on Combine produces final 34%", async () => {
    const sessionId = `test-globalcvc-${Date.now()}`;

    // Turn 1 — combined spine + hearing input (proven by slice 2 to extract both).
    const r1 = await processChatV2(
      sessionId,
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.",
      { shadow: true },
    );
    expect(r1.route.systems).toContain("spine");
    expect(r1.route.systems).toContain("hearing");

    // Turn 2 — confirm spine; handoff to hearing kicks in.
    const r2 = await processChatV2(sessionId, "Confirmed", { shadow: true });
    expect(r2.message.toLowerCase()).toContain("continuing with hearing");

    // Turn 3 — confirm hearing. With both systems calculated and no further
    // handoff target, the assistant should offer Global CVC.
    const r3 = await processChatV2(sessionId, "Confirmed", { shadow: true });
    expect(r3.message).toMatch(/calculate combined gatiod pi/i);
    expect(r3.message).toContain("Spine: 5%");
    expect(r3.message).toContain("Hearing: 30%");
    expect(r3.suggestedChips).toEqual(
      expect.arrayContaining(["Combine", "Add another system", "Edit a finding"]),
    );

    // Turn 4 — doctor combines. Final 34% lands in one turn.
    const r4 = await processChatV2(sessionId, "Combine", { shadow: true });
    expect(r4.message).toMatch(/combined gatiod pi%:\s*34%/i);
    expect(r4.message).toMatch(/system-generated gatiod pi%:\s*34%/i);
    expect(r4.message).toMatch(/30% combined with 5% → 34%/);
  });

  it("does not offer global CVC when only one system has calculated", async () => {
    const sessionId = `test-no-globalcvc-${Date.now()}`;

    // Single-system input — only spine is in play.
    const r1 = await processChatV2(
      sessionId,
      "Lumbar compression fracture less than 25% with residual pain",
      { shadow: true },
    );
    expect(r1.route.systems).toContain("spine");

    const r2 = await processChatV2(sessionId, "Confirmed", { shadow: true });
    expect(r2.message.toLowerCase()).not.toContain("calculate combined gatiod pi");
    expect(r2.message.toLowerCase()).not.toContain("combined values chart");
  });
});

describe("Global CVC offer — chip handling", () => {
  it("'Add another system' clears the pending offer and asks which system", async () => {
    const sessionId = `test-add-system-${Date.now()}`;

    await processChatV2(
      sessionId,
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.",
      { shadow: true },
    );
    await processChatV2(sessionId, "Confirmed", { shadow: true });
    await processChatV2(sessionId, "Confirmed", { shadow: true });

    const r = await processChatV2(sessionId, "Add another system", { shadow: true });
    expect(r.message).toMatch(/which system would you like to assess next/i);
    expect(r.suggestedChips).toEqual(
      expect.arrayContaining(["Upper Limb", "Lower Limb", "Spine", "Hearing"]),
    );
  });

  it("'Edit a finding' clears the pending offer and asks what to change", async () => {
    const sessionId = `test-edit-${Date.now()}`;

    await processChatV2(
      sessionId,
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.",
      { shadow: true },
    );
    await processChatV2(sessionId, "Confirmed", { shadow: true });
    await processChatV2(sessionId, "Confirmed", { shadow: true });

    const r = await processChatV2(sessionId, "Edit a finding", { shadow: true });
    expect(r.message).toMatch(/which finding would you like to edit/i);
  });
});
