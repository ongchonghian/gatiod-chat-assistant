// Spine multi-region safe-fail guard (ADR-0001 zero-tolerance: no
// component silently dropped). The spine v1 model only supports one region
// per assessment, so an utterance mentioning two regions, or a follow-up
// utterance that introduces a different region than the active one, must
// surface a clarification instead of silently overwriting state.
import { describe, expect, it } from "vitest";
import { normalizeClinicalUtterance } from "../../../src/v2/normalizer.js";
import {
  extractSpine,
  detectSpineRegions,
  SP_FK_REGION,
  SP_FK_ENTRIES,
  SPINE_MULTI_REGION_AUDIT_EVENT,
} from "../../../src/v2/extractors/spine.js";
import { applyStructuredExtraction, defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SessionState } from "../../../src/v2/contracts.js";

function spineState(state: V2SessionState) {
  return state.systems.spine;
}

describe("detectSpineRegions — mutual exclusion", () => {
  it("returns only thoraco_lumbar for 'thoraco-lumbar compression fracture'", () => {
    expect(detectSpineRegions("thoraco-lumbar compression fracture")).toEqual([
      "thoraco_lumbar",
    ]);
  });

  it("returns only lumbo_sacral for standalone 'lumbar disc prolapse'", () => {
    expect(detectSpineRegions("lumbar disc prolapse with motor deficit")).toEqual([
      "lumbo_sacral",
    ]);
  });

  it("returns both cervical and lumbo_sacral for cross-region utterance", () => {
    expect(
      detectSpineRegions("Cervical fracture and lumbo-sacral disc prolapse"),
    ).toEqual(["cervical", "lumbo_sacral"]);
  });

  it("returns only cervical for 'C5-C6 disc'", () => {
    expect(detectSpineRegions("C5-C6 disc prolapse")).toEqual(["cervical"]);
  });
});

describe("Spine multi-region guard — case 1: multiple regions in same utterance", () => {
  it("blocks: no region or entries written; clarification surfaced; audit event emitted", () => {
    let state = defaultV2SessionState();
    const u = normalizeClinicalUtterance(
      "Cervical fracture and lumbo-sacral disc prolapse with persistent radicular pain",
    );

    const r = extractSpine(u, spineState(state));
    state = applyStructuredExtraction(state, "spine", r);

    // No region or entries written.
    expect(spineState(state).extractedFacts[SP_FK_REGION]).toBeUndefined();
    expect(spineState(state).extractedFacts[SP_FK_ENTRIES]).toBeUndefined();

    // A clarifying pending observation is present, with chips for both regions.
    expect(spineState(state).pendingObservations.length).toBe(1);
    const obs = spineState(state).pendingObservations[0];
    expect(obs.clarificationQuestion).toMatch(/Multi-region spine assessment is not yet supported/);
    expect(obs.clarificationQuestion).toContain("Cervical");
    expect(obs.clarificationQuestion).toContain("Lumbo-Sacral");
    expect(obs.candidateAnswers).toEqual(
      expect.arrayContaining(["Cervical", "Lumbo-Sacral"]),
    );

    // Typed audit event emitted with the right payload.
    expect(r.auditEvents).toBeDefined();
    expect(r.auditEvents).toHaveLength(1);
    const ev = r.auditEvents![0];
    expect(ev.eventType).toBe(SPINE_MULTI_REGION_AUDIT_EVENT);
    expect(ev.payload.action).toBe("blocked_multi_region_utterance");
    expect(ev.payload.detectedRegions).toEqual(["cervical", "lumbo_sacral"]);
    expect(ev.payload.existingRegion).toBeUndefined();
    expect(ev.payload.sourceText).toContain("Cervical fracture");
  });
});

describe("Spine multi-region guard — case 2: existing region, different new region", () => {
  it("preserves existing cervical state when a lumbo-sacral finding arrives later", () => {
    let state = defaultV2SessionState();

    // Establish a cervical assessment via a normal extraction.
    const turn1 = normalizeClinicalUtterance(
      "Cervical compression fracture greater than 25%",
    );
    const r1 = extractSpine(turn1, spineState(state));
    state = applyStructuredExtraction(state, "spine", r1);

    expect(spineState(state).extractedFacts[SP_FK_REGION]?.value).toBe("cervical");
    const entriesBefore = spineState(state).extractedFacts[SP_FK_ENTRIES]?.value;
    expect(entriesBefore).toBeDefined();

    // Now the doctor mentions a different region.
    const turn2 = normalizeClinicalUtterance(
      "Lumbo-sacral disc prolapse with persistent radicular pain",
    );
    const r2 = extractSpine(turn2, spineState(state));
    state = applyStructuredExtraction(state, "spine", r2);

    // Cervical state preserved — region not overwritten, entries not lost.
    expect(spineState(state).extractedFacts[SP_FK_REGION]?.value).toBe("cervical");
    expect(spineState(state).extractedFacts[SP_FK_ENTRIES]?.value).toEqual(entriesBefore);

    // Clarification surfaced; no chip that loses existing data.
    const obs = spineState(state).pendingObservations.find(
      (o) => (o.parsed as { subtype?: string }).subtype === SPINE_MULTI_REGION_AUDIT_EVENT,
    );
    expect(obs).toBeDefined();
    expect(obs!.clarificationQuestion).toMatch(/active Cervical spine assessment/);
    expect(obs!.clarificationQuestion).toMatch(/Lumbo-Sacral/);
    expect(obs!.candidateAnswers).toEqual(["Continue with Cervical assessment"]);

    // Typed audit event with action = blocked_overwrite.
    expect(r2.auditEvents).toHaveLength(1);
    const ev = r2.auditEvents![0];
    expect(ev.eventType).toBe(SPINE_MULTI_REGION_AUDIT_EVENT);
    expect(ev.payload.action).toBe("blocked_overwrite");
    expect(ev.payload.existingRegion).toBe("cervical");
    expect(ev.payload.detectedRegions).toEqual(["lumbo_sacral"]);
  });
});

describe("Spine multi-region guard — single-region utterances are unaffected", () => {
  it("scaffold-collapse thoraco-lumbar string still extracts cleanly", () => {
    let state = defaultV2SessionState();
    const u = normalizeClinicalUtterance(
      "Thoraco-lumbar compression/burst fracture <25% height loss with residual pain",
    );

    const r = extractSpine(u, spineState(state));
    state = applyStructuredExtraction(state, "spine", r);

    expect(spineState(state).extractedFacts[SP_FK_REGION]?.value).toBe("thoraco_lumbar");
    expect(spineState(state).pendingObservations).toHaveLength(0);
    expect(r.auditEvents ?? []).toEqual([]);
  });

  it("standalone lumbar still extracts as lumbo_sacral", () => {
    let state = defaultV2SessionState();
    const u = normalizeClinicalUtterance(
      "Lumbar compression fracture less than 25% with residual pain",
    );

    const r = extractSpine(u, spineState(state));
    state = applyStructuredExtraction(state, "spine", r);

    expect(spineState(state).extractedFacts[SP_FK_REGION]?.value).toBe("lumbo_sacral");
    expect(r.auditEvents ?? []).toEqual([]);
  });
});

describe("Spine multi-region guard — recovery: doctor picks one region after the block", () => {
  it("after a multi-region block, sending 'Cervical fracture' alone proceeds with cervical only", () => {
    let state = defaultV2SessionState();

    // First turn — multi-region; blocked.
    const turn1 = normalizeClinicalUtterance(
      "Cervical fracture and lumbo-sacral disc prolapse",
    );
    const r1 = extractSpine(turn1, spineState(state));
    state = applyStructuredExtraction(state, "spine", r1);

    expect(spineState(state).extractedFacts[SP_FK_REGION]).toBeUndefined();
    expect(r1.auditEvents).toHaveLength(1);

    // Second turn — doctor picks one region with a clean utterance.
    const turn2 = normalizeClinicalUtterance(
      "Cervical compression fracture greater than 25%",
    );
    const r2 = extractSpine(turn2, spineState(state));
    state = applyStructuredExtraction(state, "spine", r2);

    // Cervical region is now written; no carry-over of lumbo-sacral.
    expect(spineState(state).extractedFacts[SP_FK_REGION]?.value).toBe("cervical");
    expect(r2.auditEvents ?? []).toEqual([]);
  });
});
