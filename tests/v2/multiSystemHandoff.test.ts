// Reproduces the user-reported regression: a multi-system utterance
// (spine + hearing) progresses through spine to completion, but the chat
// never pivots to hearing. After this fix, the post-spine response should
// chain into hearing's confirmation automatically.
import { describe, expect, it, beforeAll } from "vitest";
import { processChatV2 } from "../../src/chat/chatServiceV2.js";

beforeAll(() => {
  // Use an in-memory DB so the test doesn't pollute disk state.
  process.env.GATIOD_DB_PATH = ":memory:";
});

describe("Multi-system handoff (REQ-B1.5)", () => {
  it("after spine completes, chains into hearing confirmation", async () => {
    const sessionId = `test-handoff-${Date.now()}`;

    // Turn 1 — combined spine + hearing input
    const r1 = await processChatV2(
      sessionId,
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.",
      { shadow: true }
    );
    expect(r1.route.systems).toContain("spine");
    expect(r1.route.systems).toContain("hearing");

    // Turn 2 — pick severity chip
    const r2 = await processChatV2(
      sessionId,
      "Compression or burst fractures of <25% with residual pain",
      { shadow: true }
    );
    // Expect spine confirmation now
    expect(r2.message.toLowerCase()).toContain("spine");
    expect(r2.needsClarification).toBe(true);

    // Turn 3 — confirm spine; expect handoff to hearing in same response
    const r3 = await processChatV2(sessionId, "Confirmed", { shadow: true });

    // Spine result should appear
    expect(r3.message).toMatch(/spine/i);
    expect(r3.message).toMatch(/PI%/);

    // Hearing handoff should appear
    expect(r3.message.toLowerCase()).toContain("continuing with hearing");
    expect(r3.message.toLowerCase()).toMatch(/right ear ahl|injury|accident/i);

    // Response should ask for confirmation/edit on the handoff
    expect(r3.needsClarification).toBe(true);
    expect(r3.suggestedChips).toEqual(
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
