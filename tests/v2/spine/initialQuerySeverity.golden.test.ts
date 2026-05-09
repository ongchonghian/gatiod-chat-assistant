// Golden: the initial multi-system query must yield calculable spine severity
// AND hearing facts in one pass. Previously the spine extractor's regex
// (`COMPRESSION_LT25_RE` with a trailing \b after %) failed on the natural
// "compression/burst fracture <25%" phrasing, forcing an unnecessary chip
// roundtrip. Both extractors share the same parser now, so the fix is verified
// at both the entry point and the resolver.
import { describe, expect, it, beforeAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
import {
  SP_FK_ENTRIES,
  SP_FK_REGION,
  type SpineCategoryEntryFact,
} from "../../../src/v2/extractors/spine.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AFFECTED_EARS,
} from "../../../src/v2/extractors/hearing.js";

beforeAll(() => {
  process.env.GATIOD_DB_PATH = ":memory:";
});

describe("Initial multi-system query — calculable severity in one pass", () => {
  it("extracts thoraco-lumbar compression/burst fracture <25% AND hearing AHL on first turn", async () => {
    const sessionId = `golden-initial-${Date.now()}`;
    const input =
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; " +
      "Right ear sudden hearing loss after accident; AHL 90 dB.";

    const r1 = await processChatV2(sessionId, input, { shadow: true });

    // The router still finds both systems
    expect(r1.route.systems).toContain("spine");
    expect(r1.route.systems).toContain("hearing");

    // Inspect the persisted session state
    const loaded = loadSession(sessionId);
    expect(loaded).toBeDefined();
    const v2 = coerceV2State(loaded!.systemStates);

    // ── Spine: region + complete severity entry must both be present ────
    expect(v2.systems.spine.extractedFacts[SP_FK_REGION]?.value).toBe("thoraco_lumbar");
    const spineEntries = v2.systems.spine.extractedFacts[SP_FK_ENTRIES]?.value as SpineCategoryEntryFact[] | undefined;
    expect(spineEntries, "spine_entries must be populated from initial utterance").toBeDefined();
    expect(spineEntries!.length).toBeGreaterThan(0);
    expect(spineEntries![0]).toMatchObject({
      diagnosisCategory: "fractures_dislocations",
      severityKey: "compression_lt25",
    });

    // No spine pending observations should remain — the severity question
    // must NOT be asked when the doctor already gave a complete description.
    expect(v2.systems.spine.pendingObservations).toHaveLength(0);

    // ── Hearing: path + affected ear + AHL all extracted ────────────────
    expect(v2.systems.hearing.extractedFacts[HEARING_FK_PATH]?.value).toBe("injury");
    expect(v2.systems.hearing.extractedFacts[HEARING_FK_AFFECTED_EARS]?.value).toBe("right");
    expect(v2.systems.hearing.extractedFacts[HEARING_FK_RIGHT_EAR_AHL]?.value).toBe(90);
  });

  it("post-confirm flow yields spine PI 5% and chains into hearing without a severity-question detour", async () => {
    const sessionId = `golden-pi-${Date.now()}`;
    const input =
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; " +
      "Right ear sudden hearing loss after accident; AHL 90 dB.";

    // Turn 1 — should NOT ask for severity row, should jump to confirmation
    const r1 = await processChatV2(sessionId, input, { shadow: true });
    expect(r1.message.toLowerCase()).not.toContain("which severity row");
    expect(r1.message.toLowerCase()).toContain("spine");

    // Turn 2 — confirm spine and expect hearing handoff in same response
    const r2 = await processChatV2(sessionId, "Confirmed", { shadow: true });
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/5%/);
    expect(r2.message.toLowerCase()).toContain("continuing with hearing");
  });
});
