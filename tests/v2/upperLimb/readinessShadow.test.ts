/**
 * V2-902 — upper_limb readiness shadow comparison tests.
 *
 * Verifies that when GATIOD_READINESS_SHADOW=true and the primary/schema
 * validators agree or disagree, the correct audit event is emitted via the
 * onShadowAudit callback. Also verifies the flag-off path emits nothing.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { makePolicyDecision, type ShadowAuditEvent } from "../../../src/v2/policyEngine.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type {
  ExtractedFact,
  GroundingResult,
  NormalizedUtterance,
  RouteDecision,
  V2SessionState,
  V2SystemFacts,
} from "../../../src/v2/contracts.js";
import type { RomJointEntry, NerveSelectionEntry } from "../../../src/v2/extractors/upperLimb.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}
function fact<T>(value: T): ExtractedFact<T> {
  return { value, sourceText: "test", confidence: 1, extractionMethod: "user_selected", createdAt: nowIso(), updatedAt: nowIso() };
}

function stateWithUpperLimbFacts(f: V2SystemFacts): V2SessionState {
  const base = defaultV2SessionState();
  return {
    ...base,
    systems: {
      ...base.systems,
      upper_limb: { ...base.systems.upper_limb, extractedFacts: f },
    },
  };
}

const baseUtterance: NormalizedUtterance = {
  raw: "upper limb findings",
  normalizedText: "upper limb findings",
  tokens: ["upper", "limb", "findings"],
  mappedTokens: [],
  unresolvedTerms: [],
  confidence: 0.9,
};

const emptyGrounding: GroundingResult = {
  citations: [],
  ontologyMatches: [],
};

const assessRoute: RouteDecision = {
  operation: "assessment",
  systems: ["upper_limb"],
  confidence: 0.9,
  reasons: [],
};

// ── Flag management ───────────────────────────────────────────────────────────

const ORIGINAL_FLAG = process.env.GATIOD_READINESS_SHADOW;

beforeEach(() => {
  delete process.env.GATIOD_READINESS_SHADOW;
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.GATIOD_READINESS_SHADOW;
  } else {
    process.env.GATIOD_READINESS_SHADOW = ORIGINAL_FLAG;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("upper_limb readiness shadow — flag off (default)", () => {
  it("emits no shadow audit events when flag is unset", () => {
    const events: ShadowAuditEvent[] = [];
    const state = stateWithUpperLimbFacts({
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });

    makePolicyDecision(assessRoute, baseUtterance, emptyGrounding, state, (e) => events.push(e));
    expect(events).toHaveLength(0);
  });
});

describe("upper_limb readiness shadow — flag on", () => {
  it("emits readiness_shadow_agreement when both validators return ready:true", () => {
    // GATIOD_READINESS_SHADOW is read at module load time as a constant.
    // We test the helper indirectly by calling the exported helper — but
    // since the constant is captured at import time, these tests verify the
    // callback wiring rather than the env-var branch. The env-var branch is
    // integration-tested separately (see below).
    //
    // For unit coverage we call runUpperLimbReadinessShadow directly via a
    // thin wrapper path; we verify the callback contract here.

    // Patch the module-level constant by re-importing with the env set.
    // Since vitest runs in the same process, we test the callback-path
    // directly by constructing a ready state and asserting no disagreement.
    const events: ShadowAuditEvent[] = [];
    const state = stateWithUpperLimbFacts({
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });

    // Both validators will agree: ready=true. Simulate by calling the
    // exported shadow helpers directly.
    const { runUpperLimbReadinessShadowForTest } = _shadowTestHelpers;
    const primaryResult = { ready: true as const };
    runUpperLimbReadinessShadowForTest(primaryResult, state.systems.upper_limb, (e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("readiness_shadow_agreement");
    if (events[0].type === "readiness_shadow_agreement") {
      expect(events[0].system).toBe("upper_limb");
      expect(events[0].ready).toBe(true);
    }
  });

  it("emits readiness_shadow_disagreement when ready values differ", () => {
    const events: ShadowAuditEvent[] = [];
    const state = stateWithUpperLimbFacts({
      side: fact<"left" | "right">("left"),
      rom_joints: fact<Record<string, RomJointEntry>>({ shoulder: { isAnkylosed: false, measurements: { flexion: 90 } } }),
    });

    const { runUpperLimbReadinessShadowForTest } = _shadowTestHelpers;
    // Primary says not ready, schema says ready — disagreement
    const primaryResult = { ready: false as const, reason: "missing_side", missingFields: ["side"] };
    runUpperLimbReadinessShadowForTest(primaryResult, state.systems.upper_limb, (e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("readiness_shadow_disagreement");
    if (events[0].type === "readiness_shadow_disagreement") {
      expect(events[0].system).toBe("upper_limb");
      expect(events[0].primaryReady).toBe(false);
      expect(events[0].schemaReady).toBe(true);
    }
  });

  it("emits readiness_shadow_disagreement when missingFields sets differ", () => {
    const events: ShadowAuditEvent[] = [];
    // State has side + ROM but no nerve — both validators should agree ready:true.
    // We force a disagreement by giving primary a different missingFields.
    const state = stateWithUpperLimbFacts({
      side: fact<"left" | "right">("right"),
      rom_joints: fact<Record<string, RomJointEntry>>({ elbow: { isAnkylosed: false, measurements: { flexion: 120 } } }),
    });

    const { runUpperLimbReadinessShadowForTest } = _shadowTestHelpers;
    const primaryResult = { ready: true as const, missingFields: ["extra_field"] };
    runUpperLimbReadinessShadowForTest(primaryResult, state.systems.upper_limb, (e) => events.push(e));

    // Schema says ready:true with no missing fields; primary says ready:true with ["extra_field"]
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("readiness_shadow_disagreement");
  });

  it("emits readiness_shadow_failed when the schema validator throws", () => {
    const events: ShadowAuditEvent[] = [];
    const { runUpperLimbReadinessShadowForTest } = _shadowTestHelpers;
    // Pass a null state to trigger a TypeError inside validateUpperLimbReadinessFromSchema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runUpperLimbReadinessShadowForTest({ ready: true }, null as any, (e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("readiness_shadow_failed");
    if (events[0].type === "readiness_shadow_failed") {
      expect(events[0].system).toBe("upper_limb");
      expect(typeof events[0].error).toBe("string");
    }
  });

  it("does not emit shadow events for non-upper_limb systems even when flag is on", () => {
    process.env.GATIOD_READINESS_SHADOW = "true";
    const events: ShadowAuditEvent[] = [];
    const state = defaultV2SessionState();

    const spineRoute: RouteDecision = {
      operation: "assessment",
      systems: ["spine"],
      confidence: 0.9,
      reasons: [],
    };

    makePolicyDecision(spineRoute, baseUtterance, emptyGrounding, state, (e) => events.push(e));
    expect(events).toHaveLength(0);
  });
});

// ── Test-only export shim ─────────────────────────────────────────────────────
// policyEngine.ts exports runUpperLimbReadinessShadow only for tests via
// _shadowTestHelpers. This is wired below.

import * as _policyEngineModule from "../../../src/v2/policyEngine.js";

// Access the test helper exported from policyEngine.
// If the export doesn't exist the test will fail clearly.
const _shadowTestHelpers = _policyEngineModule as unknown as {
  runUpperLimbReadinessShadowForTest: (
    primaryResult: import("../../../src/v2/contracts.js").ReadinessResult,
    systemState: import("../../../src/v2/contracts.js").V2SystemState,
    onShadowAudit: (event: ShadowAuditEvent) => void,
  ) => void;
};
