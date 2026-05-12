// Reproduces the user-reported regression: a multi-system utterance
// (spine + hearing) progresses through spine to completion, but the chat
// never pivots to hearing. After this fix, the post-spine response should
// chain into hearing's confirmation automatically.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../src/chat/chatServiceV2.js";

let _savedExtractorFlag: string | undefined;
let _savedComparisonFlag: string | undefined;
beforeAll(() => {
  // Use an in-memory DB so the test doesn't pollute disk state.
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

describe("Multi-system handoff (REQ-B1.5)", () => {
  it("after spine completes, chains into hearing confirmation", async () => {
    const sessionId = `test-handoff-${Date.now()}`;

    // Turn 1 — combined spine + hearing input.
    // The shared severity parser now extracts "compression/burst fracture
    // <25%" up front, so spine reaches confirmation in one turn (no chip
    // round-trip).
    const r1 = await processChatV2(
      sessionId,
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.",
      { shadow: true }
    );
    expect(r1.route.systems).toContain("spine");
    expect(r1.route.systems).toContain("hearing");
    // Confirmation should be presented immediately, not a severity question.
    expect(r1.message.toLowerCase()).not.toContain("which severity row");
    expect(r1.message.toLowerCase()).toContain("spine");
    expect(r1.needsClarification).toBe(true);

    // Turn 2 — confirm spine; expect handoff to hearing in same response
    const r2 = await processChatV2(sessionId, "Confirmed", { shadow: true });

    // Spine result should appear
    expect(r2.message).toMatch(/spine/i);
    expect(r2.message).toMatch(/PI%/);

    // Hearing handoff should appear
    expect(r2.message.toLowerCase()).toContain("continuing with hearing");
    expect(r2.message.toLowerCase()).toMatch(/right ear ahl|injury|accident/i);

    // Response should ask for confirmation/edit on the handoff
    expect(r2.needsClarification).toBe(true);
    expect(r2.suggestedChips).toEqual(
      expect.arrayContaining(["Confirm and calculate"])
    );
  });

  it("does not produce a handoff when only one system was extracted", async () => {
    const sessionId = `test-no-handoff-${Date.now()}`;

    const r1 = await processChatV2(
      sessionId,
      "Lumbar disc prolapse with persistent pain and motor deficit",
      { shadow: true }
    );
    expect(r1.route.systems).toContain("spine");

    // The lumbar utterance should resolve without leaving collected work in
    // any other system, so the post-confirm response should not contain a
    // "Continuing with X" handoff.
    // (We don't run the full confirm flow here — we only assert that no
    // foreign system has facts.)
    const r2 = await processChatV2(sessionId, "Confirmed", { shadow: true });
    expect(r2.message.toLowerCase()).not.toContain("continuing with hearing");
    expect(r2.message.toLowerCase()).not.toContain("continuing with renal");
  });
});
