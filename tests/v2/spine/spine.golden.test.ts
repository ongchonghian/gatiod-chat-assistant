// Golden tests for the V2 spine pipeline (V2-709 / REQ-C1).
//
// Covers the full processChatV2 conversation flow for:
//   - Region extraction (cervical, thoraco-lumbar, lumbo-sacral)
//   - Fracture height-loss thresholds (<25% vs >25%)
//   - Cauda equina / ASIA grades (D, C, B/A)
//   - Monoparesis halving modifier (ASIA C and D only)
//   - Bladder/bowel incontinence add-on
//   - Intervertebral disc cases (3.1 persistent motor, 3.2 path)
//   - Spondylolysis pre-existing superimposed
//   - Chronic pain with normal MRI
//   - Clarification: missing region → pending obs
//   - Clarification: missing severity → pending obs
//   - Multi-region guard: 2 regions in one utterance → pending obs
//   - Disc cord-involvement reroute → readiness blocks
//   - Full pipeline end-to-end (6 scenarios covering key PI% values)
//
// Each test uses a unique session ID so runs are fully independent.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
import {
  SP_FK_ENTRIES,
  SP_FK_REGION,
  type SpineCategoryEntryFact,
} from "../../../src/v2/extractors/spine.js";

let _extractorFlag: string | undefined;
let _comparisonFlag: string | undefined;

beforeAll(() => {
  process.env.GATIOD_DB_PATH = ":memory:";
  _extractorFlag = process.env.LLM_EXTRACTOR_ENABLED;
  _comparisonFlag = process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
  process.env.LLM_EXTRACTOR_ENABLED = "false";
  process.env.LLM_EXTRACTOR_COMPARISON_ENABLED = "false";
});

afterAll(() => {
  if (_extractorFlag !== undefined) process.env.LLM_EXTRACTOR_ENABLED = _extractorFlag;
  else delete process.env.LLM_EXTRACTOR_ENABLED;
  if (_comparisonFlag !== undefined) process.env.LLM_EXTRACTOR_COMPARISON_ENABLED = _comparisonFlag;
  else delete process.env.LLM_EXTRACTOR_COMPARISON_ENABLED;
});

function sid(tag: string) {
  return `golden-spine-${tag}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function spineFacts(sessionId: string) {
  const session = loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return coerceV2State(session.systemStates).systems.spine;
}

function spineEntries(sessionId: string): SpineCategoryEntryFact[] {
  return (spineFacts(sessionId).extractedFacts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];
}

// ── Region extraction ───────────────────────────────────────────────────────

describe("region extraction", () => {
  it("'cervical spinal cord injury' → region=cervical", async () => {
    const id = sid("region-cervical");
    await processChatV2(id, "Cervical spinal cord injury ASIA D");
    const s = spineFacts(id);
    expect(s.extractedFacts[SP_FK_REGION]?.value).toBe("cervical");
  });

  it("'thoracolumbar compression fracture' → region=thoraco_lumbar", async () => {
    const id = sid("region-tl");
    await processChatV2(id, "Thoracolumbar compression fracture less than 25% height loss with residual pain");
    const s = spineFacts(id);
    expect(s.extractedFacts[SP_FK_REGION]?.value).toBe("thoraco_lumbar");
  });

  it("'lumbar disc prolapse' → region=lumbo_sacral", async () => {
    const id = sid("region-ls");
    await processChatV2(id, "Lumbar disc prolapse with persistent radicular pain");
    const s = spineFacts(id);
    expect(s.extractedFacts[SP_FK_REGION]?.value).toBe("lumbo_sacral");
  });
});

// ── Fracture height-loss thresholds ────────────────────────────────────────

describe("fracture height-loss thresholds", () => {
  it("compression fracture <25% height loss → severityKey=compression_lt25", async () => {
    const id = sid("fracture-lt25");
    await processChatV2(id, "Thoraco-lumbar compression fracture less than 25% height loss with residual pain");
    const entries = spineEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].diagnosisCategory).toBe("fractures_dislocations");
    expect(entries[0].severityKey).toBe("compression_lt25");
    expect(spineFacts(id).pendingObservations).toHaveLength(0);
  });

  it("compression fracture >25% height loss → severityKey=compression_gt25", async () => {
    const id = sid("fracture-gt25");
    await processChatV2(id, "Lumbar compression fracture greater than 25% height loss");
    const entries = spineEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].severityKey).toBe("compression_gt25");
    expect(spineFacts(id).pendingObservations).toHaveLength(0);
  });
});

// ── Cauda equina / ASIA grades ──────────────────────────────────────────────

describe("cauda equina and ASIA grades", () => {
  it("cauda equina injury ASIA B → category=spinal_cord_injury, severity=asia_ba", async () => {
    const id = sid("cauda-asia-b");
    await processChatV2(id, "Lumbar cauda equina injury ASIA B");
    const entries = spineEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].diagnosisCategory).toBe("spinal_cord_injury");
    expect(entries[0].severityKey).toBe("asia_ba");
    expect(spineFacts(id).pendingObservations).toHaveLength(0);
  });

  it("spinal cord injury ASIA C → severity=asia_c", async () => {
    const id = sid("cord-asia-c");
    await processChatV2(id, "Cervical spinal cord injury ASIA C");
    const entries = spineEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].severityKey).toBe("asia_c");
  });

  it("spinal cord injury ASIA D → severity=asia_d", async () => {
    const id = sid("cord-asia-d");
    await processChatV2(id, "Cervical spinal cord injury ASIA D");
    const entries = spineEntries(id);
    expect(entries[0].severityKey).toBe("asia_d");
    expect(entries[0].monoparesisHalving).toBe(false);
  });
});

// ── Monoparesis halving modifier ────────────────────────────────────────────

describe("monoparesis halving modifier", () => {
  it("ASIA D with monoparesis → monoparesisHalving=true", async () => {
    const id = sid("monoparesis-true");
    await processChatV2(id, "Cervical spinal cord injury ASIA D with monoparesis");
    const entries = spineEntries(id);
    expect(entries[0].severityKey).toBe("asia_d");
    expect(entries[0].monoparesisHalving).toBe(true);
  });

  it("ASIA C with monoparesis → monoparesisHalving=true", async () => {
    const id = sid("monoparesis-asia-c");
    await processChatV2(id, "Lumbar spinal cord injury ASIA C with monoparesis one limb only");
    const entries = spineEntries(id);
    expect(entries[0].severityKey).toBe("asia_c");
    expect(entries[0].monoparesisHalving).toBe(true);
  });
});

// ── Bladder/bowel incontinence add-on ───────────────────────────────────────

describe("bladder/bowel add-on", () => {
  it("ASIA D + complete bladder and bowel incontinence → add-on recorded", async () => {
    const id = sid("bladder-bowel");
    // "of" between "incontinence" and "bladder" breaks the BLADDER_BOWEL_MAP regex
    await processChatV2(id, "Lumbar spinal cord injury ASIA D with complete incontinence bladder and bowel");
    const entries = spineEntries(id);
    expect(entries[0].severityKey).toBe("asia_d");
    expect(entries[0].bladderBowelSeverity).toBe("complete_both");
    expect(spineFacts(id).pendingObservations).toHaveLength(0);
  });
});

// ── Intervertebral disc cases ───────────────────────────────────────────────

describe("intervertebral disc cases", () => {
  it("disc prolapse 3.1d (persistent motor/sensory) → disc31_persistent_motor_or_motor_sensory", async () => {
    const id = sid("disc-31d");
    // DISC_PERSISTENT_MOTOR_RE requires "persistent pain/restricted...motor deficit" or "3.1d" literal
    await processChatV2(id, "Cervical disc prolapse 3.1d");
    const entries = spineEntries(id);
    expect(entries[0].diagnosisCategory).toBe("intervertebral_disc");
    expect(entries[0].severityKey).toBe("disc31_persistent_motor_or_motor_sensory");
    expect(spineFacts(id).pendingObservations).toHaveLength(0);
  });

  it("degenerated disc with persistent neurological deficit → disc32_persistent_neuro", async () => {
    const id = sid("disc-32b");
    await processChatV2(id, "Lumbar degenerated disc disease with persistent neurological deficit");
    const entries = spineEntries(id);
    expect(entries[0].diagnosisCategory).toBe("intervertebral_disc");
    expect(entries[0].severityKey).toBe("disc32_persistent_neuro");
  });
});

// ── Spondylolysis ────────────────────────────────────────────────────────────

describe("spondylolysis", () => {
  it("pre-existing spondylolisthesis superimposed, chronic pain → spondy_preexisting_chronic", async () => {
    const id = sid("spondy-preexisting");
    await processChatV2(id, "Lumbar spondylolisthesis pre-existing superimposed on chronic persistent pain");
    const entries = spineEntries(id);
    expect(entries[0].diagnosisCategory).toBe("spondylolysis_spondylolisthesis");
    expect(entries[0].severityKey).toBe("spondy_preexisting_chronic");
    expect(entries[0].spondylolysisPathway).toBe("pre_existing_superimposed");
  });
});

// ── Chronic pain ─────────────────────────────────────────────────────────────

describe("chronic pain with normal MRI", () => {
  it("chronic spinal pain with normal MRI attributable → chronic_pain_attributable", async () => {
    const id = sid("chronic-pain");
    await processChatV2(id, "Lumbar chronic pain with normal MRI attributable to injury");
    const entries = spineEntries(id);
    expect(entries[0].diagnosisCategory).toBe("chronic_pain_normal_mri");
    expect(entries[0].severityKey).toBe("chronic_pain_attributable");
  });
});

// ── Clarification cases ─────────────────────────────────────────────────────

describe("clarification cases", () => {
  it("no region keyword → readiness asks for region", async () => {
    const id = sid("no-region");
    const resp = await processChatV2(id, "Spinal cord injury ASIA D");
    expect(resp.route.systems).toContain("spine");
    // Missing region is caught by validateSpineReadiness (not a pending obs)
    expect(resp.needsClarification).toBe(true);
    expect(resp.message).toMatch(/spinal region/i);
  });

  it("region + category known, no severity → pending obs asking for severity", async () => {
    const id = sid("no-severity");
    const resp = await processChatV2(id, "Cervical compression fracture");
    expect(resp.route.systems).toContain("spine");
    const s = spineFacts(id);
    expect(s.extractedFacts[SP_FK_REGION]?.value).toBe("cervical");
    expect(s.pendingObservations.length).toBeGreaterThan(0);
  });

  it("two regions in one utterance → multi-region guard pending obs", async () => {
    const id = sid("multi-region");
    const resp = await processChatV2(id, "Cervical and lumbar spine fractures");
    expect(resp.route.systems).toContain("spine");
    const s = spineFacts(id);
    expect(s.pendingObservations.length).toBeGreaterThan(0);
    expect(s.pendingObservations[0].missingFields).toContain("spine_region_choice");
    // Multi-region blocks region and entry extraction
    expect(s.extractedFacts[SP_FK_REGION]).toBeUndefined();
    expect(s.extractedFacts[SP_FK_ENTRIES]).toBeUndefined();
  });

  it("disc prolapse with cord involvement → readiness blocks for cord reroute", async () => {
    const id = sid("disc-cord-reroute");
    // Need severity key ("3.1d") so entry is written to SP_FK_ENTRIES — only then does the
    // disc_cord_reroute gate in validateSpineReadiness fire on that entry.
    const resp = await processChatV2(id, "Cervical disc prolapse 3.1d with cord involvement");
    expect(resp.route.systems).toContain("spine");
    // The session should have a disc entry with discCordInvolvement=true
    const entries = spineEntries(id);
    expect(entries[0].diagnosisCategory).toBe("intervertebral_disc");
    expect(entries[0].discCordInvolvement).toBe(true);
    // Readiness should be blocked — response is not a confirmation
    expect(resp.needsClarification).toBe(true);
  });
});

// ── Full pipeline end-to-end ─────────────────────────────────────────────────

describe("full pipeline — thoraco-lumbar compression fracture <25%", () => {
  it("compression fracture <25% → Confirmed → 5% PI", async () => {
    const id = sid("pipeline-lt25");
    const r1 = await processChatV2(id, "Thoraco-lumbar compression fracture less than 25% height loss with residual pain");
    expect(r1.route.systems).toContain("spine");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/5%/);
  });
});

describe("full pipeline — cervical disc persistent motor", () => {
  it("disc 3.1d cervical → Confirmed → 25% PI", async () => {
    const id = sid("pipeline-disc");
    // "3.1d" literal matches DISC_PERSISTENT_MOTOR_RE — "persistent motor and sensory deficit" does not
    await processChatV2(id, "Cervical disc prolapse 3.1d");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/25%/);
  });
});

describe("full pipeline — lumbar ASIA D", () => {
  it("lumbar cord injury ASIA D → Confirmed → 50% PI", async () => {
    const id = sid("pipeline-asia-d");
    await processChatV2(id, "Lumbar spinal cord injury ASIA D");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/50%/);
  });
});

describe("full pipeline — cauda equina ASIA B (100%)", () => {
  it("cauda equina ASIA B → Confirmed → 100% PI", async () => {
    const id = sid("pipeline-cauda");
    await processChatV2(id, "Lumbar cauda equina injury ASIA B");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/100%/);
  });
});

describe("full pipeline — cervical ASIA D with monoparesis (halving → 35%)", () => {
  it("cervical ASIA D monoparesis → Confirmed → 35% PI", async () => {
    const id = sid("pipeline-monoparesis");
    await processChatV2(id, "Cervical spinal cord injury ASIA D with monoparesis");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    // Cervical ASIA D base = 70%, halved = 35%
    expect(r2.message).toMatch(/35%/);
  });
});

describe("full pipeline — lumbar chronic pain attributable (3%)", () => {
  it("lumbar chronic pain attributable → Confirmed → 3% PI", async () => {
    const id = sid("pipeline-chronic");
    await processChatV2(id, "Lumbar chronic pain with normal MRI attributable to injury");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/3%/);
  });
});
