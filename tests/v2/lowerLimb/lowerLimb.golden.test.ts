// Golden tests for the V2 lower-limb pipeline (V2-705 / REQ-C1).
//
// Covers the full processChatV2 conversation flow for:
//   - ROM-only extraction (single joint, multiple directions, ankylosis)
//   - ROM clarification (bare angle, direction chip resolution)
//   - Nerve deficit extraction and clarification
//   - ROM + nerve gate (rom_from_nerve disambiguation)
//   - Amputation extraction (AK, BK, generic signal, toe)
//   - Shortening extraction and clarification
//   - Bilateral detection
//   - Side gate (readiness asks for side when missing)
//   - Full pipeline: ROM → Confirmed → PI%
//   - Full pipeline: BK amputation → Confirmed → PI%
//   - Full pipeline: nerve deficit → Confirmed → PI%
//   - Full pipeline: shortening → Confirmed → PI%
//
// Each test uses a unique session ID so runs are fully independent.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { processChatV2 } from "../../../src/chat/chatServiceV2.js";
import { loadSession } from "../../../src/db/sessionStore.js";
import { coerceV2State } from "../../../src/v2/stateMachine.js";
import {
  LL_FK_SIDE,
  LL_FK_ROM_JOINTS,
  LL_FK_ROM_FROM_NERVE,
  LL_FK_NERVE_SELECTIONS,
  LL_FK_LEG_AMPUTATION,
  LL_FK_TOE_AMPUTATIONS,
  LL_FK_SHORTENING_CM,
} from "../../../src/v2/extractors/lowerLimb.js";

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
  return `golden-ll-${tag}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function llFacts(sessionId: string) {
  const session = loadSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return coerceV2State(session.systemStates).systems.lower_limb;
}

// ── ROM extraction ──────────────────────────────────────────────────────────

describe("ROM extraction", () => {
  it("left hip flexion 80° extension 20° → side + rom_joints extracted, no pending", async () => {
    const id = sid("rom-hip-basic");
    await processChatV2(id, "Left hip flexion 80° extension 20°, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("left");
    const joints = ll.extractedFacts[LL_FK_ROM_JOINTS]?.value as Record<string, { isAnkylosed: boolean; measurements: Record<string, number> }>;
    expect(joints?.hip?.measurements?.flexion).toBe(80);
    expect(joints?.hip?.measurements?.extension).toBe(20);
    expect(joints?.hip?.isAnkylosed).toBe(false);
    expect(ll.pendingObservations).toHaveLength(0);
  });

  it("right knee flexion 30° → side=right, knee flexion stored", async () => {
    const id = sid("rom-knee-basic");
    await processChatV2(id, "Right knee flexion 30°, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("right");
    const joints = ll.extractedFacts[LL_FK_ROM_JOINTS]?.value as Record<string, { isAnkylosed: boolean; measurements: Record<string, number> }>;
    expect(joints?.knee?.measurements?.flexion).toBe(30);
    expect(ll.pendingObservations).toHaveLength(0);
  });

  it("right knee ankylosed in flexion 20° → isAnkylosed=true in extracted facts", async () => {
    const id = sid("rom-ankylosis");
    await processChatV2(id, "Right knee ankylosed in flexion 20°, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("right");
    const joints = ll.extractedFacts[LL_FK_ROM_JOINTS]?.value as Record<string, { isAnkylosed: boolean; measurements: Record<string, number> }>;
    expect(joints?.knee?.isAnkylosed).toBe(true);
    expect(joints?.knee?.measurements?.flexion).toBe(20);
  });

  it("ankle dorsiflexion 10° plantarflexion 30° → ankle ROM stored", async () => {
    const id = sid("rom-ankle");
    await processChatV2(id, "Left ankle dorsiflexion 10° plantarflexion 30°, no other findings");
    const ll = llFacts(id);
    const joints = ll.extractedFacts[LL_FK_ROM_JOINTS]?.value as Record<string, { isAnkylosed: boolean; measurements: Record<string, number> }>;
    expect(joints?.ankle?.measurements?.dorsiflexion).toBe(10);
    expect(joints?.ankle?.measurements?.plantarflexion).toBe(30);
  });
});

// ── ROM clarification (bare angle) ──────────────────────────────────────────

describe("ROM clarification", () => {
  it("bare angle 40° with joint but no direction → pending obs asking for direction", async () => {
    const id = sid("rom-bare-angle");
    const r = await processChatV2(id, "Left hip 40°");
    expect(r.route.systems).toContain("lower_limb");
    const ll = llFacts(id);
    expect(ll.pendingObservations.length).toBeGreaterThan(0);
    const pending = ll.pendingObservations[0];
    expect(pending.missingFields).toContain("direction");
  });

  it("bare angle with no joint → pending obs asking for joint and direction", async () => {
    const id = sid("rom-bare-no-joint");
    const r = await processChatV2(id, "Left lower limb 60°");
    expect(r.route.systems).toContain("lower_limb");
    const ll = llFacts(id);
    expect(ll.pendingObservations.length).toBeGreaterThan(0);
    const pending = ll.pendingObservations[0];
    expect(pending.missingFields).toContain("joint");
  });
});

// ── Nerve deficit extraction ─────────────────────────────────────────────────

describe("nerve deficit extraction", () => {
  it("sciatic nerve combined total → nerve_selections stored, no pending", async () => {
    const id = sid("nerve-sciatic");
    await processChatV2(id, "Left leg sciatic nerve combined total loss, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("left");
    const nerves = ll.extractedFacts[LL_FK_NERVE_SELECTIONS]?.value as Array<{ nerveKey: string; deficitType: string; lossType: string }>;
    expect(nerves).toBeDefined();
    expect(nerves.length).toBeGreaterThan(0);
    expect(nerves[0].nerveKey).toBe("sciatic");
    expect(nerves[0].deficitType).toBe("combined");
    expect(nerves[0].lossType).toBe("total");
    expect(ll.pendingObservations).toHaveLength(0);
  });

  it("tibial nerve sensory partial → nerve_selections stored", async () => {
    const id = sid("nerve-tibial");
    await processChatV2(id, "Right leg tibial nerve sensory partial loss, no other findings");
    const ll = llFacts(id);
    const nerves = ll.extractedFacts[LL_FK_NERVE_SELECTIONS]?.value as Array<{ nerveKey: string; deficitType: string; lossType: string }>;
    expect(nerves?.[0]?.nerveKey).toBe("tibial");
    expect(nerves?.[0]?.deficitType).toBe("sensory");
    expect(nerves?.[0]?.lossType).toBe("partial");
  });

  it("nerve mentioned but no deficit/loss type → pending obs asking for deficit+loss", async () => {
    const id = sid("nerve-missing-type");
    const r = await processChatV2(id, "Left hip sciatic nerve injury");
    expect(r.route.systems).toContain("lower_limb");
    const ll = llFacts(id);
    expect(ll.pendingObservations.length).toBeGreaterThan(0);
    const pending = ll.pendingObservations[0];
    expect(pending.type).toBe("nerve_deficit");
  });
});

// ── ROM + nerve gate (rom_from_nerve) ────────────────────────────────────────

describe("ROM + nerve gate", () => {
  it("ROM + nerve both present without rom_from_nerve → readiness blocks, asks disambiguation", async () => {
    const id = sid("nerve-gate-missing");
    const r = await processChatV2(id, "Left hip flexion 80°, sciatic nerve combined total loss, no amputation, no shortening");
    expect(r.route.systems).toContain("lower_limb");
    const ll = llFacts(id);
    // Both ROM and nerve present — gate should fire (no pending obs, but readiness should block)
    const hasRom = ll.extractedFacts[LL_FK_ROM_JOINTS] !== undefined;
    const hasNerve = Boolean(
      ll.extractedFacts[LL_FK_NERVE_SELECTIONS] &&
      (ll.extractedFacts[LL_FK_NERVE_SELECTIONS].value as unknown[]).length > 0
    );
    expect(hasRom).toBe(true);
    expect(hasNerve).toBe(true);
    expect(ll.extractedFacts[LL_FK_ROM_FROM_NERVE]).toBeUndefined();
    // Readiness gate fires — message should contain disambiguation question
    expect(r.needsClarification).toBe(true);
  });

  it("ROM + nerve + 'independent' → rom_from_nerve=false, gate satisfied", async () => {
    const id = sid("nerve-gate-independent");
    await processChatV2(id, "Left hip flexion 80°, sciatic nerve combined total, independent ROM, no amputation");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_ROM_FROM_NERVE]?.value).toBe(false);
  });

  it("ROM + nerve + 'due to nerve' → rom_from_nerve=true", async () => {
    const id = sid("nerve-gate-due-to");
    await processChatV2(id, "Right hip flexion 60°, tibial nerve sensory partial, ROM from nerve, no amputation");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_ROM_FROM_NERVE]?.value).toBe(true);
  });
});

// ── Amputation extraction ───────────────────────────────────────────────────

describe("amputation extraction", () => {
  it("right above knee amputation → leg_amputation=above_knee", async () => {
    const id = sid("amp-ak");
    // No hyphen so "knee" is a standalone token and routes to lower_limb
    await processChatV2(id, "Right above knee amputation, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("right");
    expect(ll.extractedFacts[LL_FK_LEG_AMPUTATION]?.value).toBe("above_knee");
    expect(ll.pendingObservations).toHaveLength(0);
  });

  it("left below knee amputation → leg_amputation=below_knee", async () => {
    const id = sid("amp-bk");
    // No hyphen so "knee" is a standalone token and routes to lower_limb
    await processChatV2(id, "Left below knee amputation, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("left");
    expect(ll.extractedFacts[LL_FK_LEG_AMPUTATION]?.value).toBe("below_knee");
    expect(ll.pendingObservations).toHaveLength(0);
  });

  it("generic 'loss of leg' (no level) → slotSignal set, readiness asks for level", async () => {
    const id = sid("amp-generic");
    const r = await processChatV2(id, "Right leg was amputated");
    expect(r.route.systems).toContain("lower_limb");
    // Readiness should ask for amputation level (missing_amp_level)
    expect(r.needsClarification).toBe(true);
    expect(r.message).toMatch(/level|amputation|above|below/i);
  });

  it("great toe amputation (loss of great toe) → toe_amputations.great=mtp", async () => {
    const id = sid("amp-toe-great");
    await processChatV2(id, "Right leg, loss of great toe, no amputation, no other findings");
    const ll = llFacts(id);
    const toes = ll.extractedFacts[LL_FK_TOE_AMPUTATIONS]?.value as Record<string, string>;
    expect(toes?.great).toBe("mtp");
  });

  it("transmetatarsal amputation → leg_amputation=transmetatarsal", async () => {
    const id = sid("amp-transmetatarsal");
    // "lower limb" phrase added to ensure routing; "transmetatarsal" alone is not
    // a standalone synonym token
    await processChatV2(id, "Left lower limb transmetatarsal amputation, no nerve, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_LEG_AMPUTATION]?.value).toBe("transmetatarsal");
  });
});

// ── Shortening ───────────────────────────────────────────────────────────────

describe("shortening", () => {
  it("left leg shortening 2cm → shortening_cm=2, no pending", async () => {
    const id = sid("shortening-2cm");
    await processChatV2(id, "Left leg shortening 2 cm, no other findings");
    const ll = llFacts(id);
    expect(ll.extractedFacts[LL_FK_SIDE]?.value).toBe("left");
    expect(ll.extractedFacts[LL_FK_SHORTENING_CM]?.value).toBe(2);
    expect(ll.pendingObservations).toHaveLength(0);
  });

  it("leg length discrepancy keyword without measurement → pending obs asking for cm", async () => {
    const id = sid("shortening-no-cm");
    const r = await processChatV2(id, "Left leg length discrepancy");
    expect(r.route.systems).toContain("lower_limb");
    const ll = llFacts(id);
    expect(ll.pendingObservations.length).toBeGreaterThan(0);
    expect(ll.pendingObservations[0].missingFields).toContain("discrepancyCm");
  });
});

// ── Bilateral detection ─────────────────────────────────────────────────────

describe("bilateral detection", () => {
  it("bilateral lower limb → pending obs with bilateral_mode_choice type", async () => {
    const id = sid("bilateral");
    const r = await processChatV2(id, "Bilateral lower limb ROM restriction, hip flexion 80°");
    expect(r.route.systems).toContain("lower_limb");
    const ll = llFacts(id);
    expect(ll.pendingObservations.length).toBeGreaterThan(0);
    expect(ll.pendingObservations[0].type).toBe("bilateral_mode_choice");
  });

  it("both legs mentioned → bilateral_mode_choice pending obs", async () => {
    const id = sid("bilateral-both-legs");
    await processChatV2(id, "Both legs have knee flexion restriction 40°");
    const ll = llFacts(id);
    expect(ll.pendingObservations.length).toBeGreaterThan(0);
    expect(ll.pendingObservations[0].type).toBe("bilateral_mode_choice");
  });
});

// ── Side gate (readiness blocks when side missing) ──────────────────────────

describe("side gate", () => {
  it("ROM given but no side mentioned → readiness asks which side", async () => {
    const id = sid("side-gate");
    const r = await processChatV2(id, "hip flexion 80°, no other findings");
    expect(r.route.systems).toContain("lower_limb");
    expect(r.needsClarification).toBe(true);
    expect(r.message).toMatch(/left|right|which.*limb|which.*side/i);
  });
});

// ── Full pipeline: ROM-only → Confirmed → PI% ───────────────────────────────

describe("full pipeline — ROM-only", () => {
  it("left hip flexion 80° → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-rom-hip");
    const r1 = await processChatV2(id, "Left hip flexion 80°, no other findings");
    expect(r1.route.systems).toContain("lower_limb");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });

  it("right knee ankylosed flexion 20° → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-rom-ankylosis");
    await processChatV2(id, "Right knee ankylosed in flexion 20°, no other findings");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

// ── Full pipeline: BK amputation → Confirmed → PI% ──────────────────────────

describe("full pipeline — BK amputation", () => {
  it("left BK amputation → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-bk-amp");
    await processChatV2(id, "Left below knee amputation, no other findings");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
    expect(r2.message).toMatch(/Final PI%/);
  });
});

// ── Full pipeline: nerve deficit → Confirmed → PI% ──────────────────────────

describe("full pipeline — nerve deficit", () => {
  it("sciatic nerve combined total → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-nerve");
    await processChatV2(id, "Left leg sciatic nerve combined total loss, no other findings");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});

// ── Full pipeline: shortening → Confirmed → PI% ─────────────────────────────

describe("full pipeline — shortening", () => {
  it("left leg 2cm shortening → Confirmed → response contains PI%", async () => {
    const id = sid("pipeline-shortening");
    await processChatV2(id, "Left leg shortening 2 cm, no other findings");
    const r2 = await processChatV2(id, "Confirmed");
    expect(r2.message).toMatch(/PI%/);
  });
});
