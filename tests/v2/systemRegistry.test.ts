import { describe, expect, it } from "vitest";
import {
  validateSystemRegistry,
  validateStructuredLivePromotion,
  isStructuredLiveSystem,
  isStructuredCapableSystem,
  PROVISIONAL_STRUCTURED_LIVE,
  V2_SYSTEM_REGISTRY,
} from "../../src/v2/systemRegistry.js";

describe("validateSystemRegistry", () => {
  it("passes — all structured_live systems have all 4 required components", () => {
    expect(() => validateSystemRegistry()).not.toThrow();
  });
});

describe("system migration modes (slice-18 promotions)", () => {
  it("all 7 capable systems are structured_live (provisional under ADR-0001)", () => {
    const live = ["spine", "hearing", "gastro_digestive", "renal", "respiratory", "upper_limb", "lower_limb"];
    for (const system of live) {
      expect(
        V2_SYSTEM_REGISTRY[system as keyof typeof V2_SYSTEM_REGISTRY].mode,
        system,
      ).toBe("structured_live");
    }
  });

  it("cns and visual remain legacy", () => {
    expect(V2_SYSTEM_REGISTRY.cns.mode).toBe("legacy");
    expect(V2_SYSTEM_REGISTRY.visual.mode).toBe("legacy");
  });

  it("isStructuredLiveSystem returns true for all 7 capable systems", () => {
    const live = ["spine", "hearing", "gastro_digestive", "renal", "respiratory", "upper_limb", "lower_limb"] as const;
    for (const system of live) {
      expect(isStructuredLiveSystem(system), system).toBe(true);
    }
  });

  it("isStructuredLiveSystem returns false for legacy systems only", () => {
    expect(isStructuredLiveSystem("cns")).toBe(false);
    expect(isStructuredLiveSystem("visual")).toBe(false);
  });

  it("isStructuredCapableSystem returns true for all structured-capable (live or shadow) systems", () => {
    // Same set as before — all 7 non-CNS/visual systems are capable
    // regardless of which mode they're currently in.
    const capable = ["upper_limb", "lower_limb", "spine", "respiratory", "renal", "gastro_digestive", "hearing"] as const;
    for (const system of capable) {
      expect(isStructuredCapableSystem(system), system).toBe(true);
    }
  });

  it("isStructuredCapableSystem returns false for legacy systems", () => {
    expect(isStructuredCapableSystem("cns")).toBe(false);
    expect(isStructuredCapableSystem("visual")).toBe(false);
  });

  it("hearing is the only system with instanceReadinessValidator", () => {
    const withInstance = Object.entries(V2_SYSTEM_REGISTRY)
      .filter(([, cap]) => Boolean(cap.instanceReadinessValidator))
      .map(([key]) => key);
    expect(withInstance).toEqual(["hearing"]);
  });

  it("every structured_live system has extractor, readinessValidator, argBuilder, resultRenderer", () => {
    for (const [system, cap] of Object.entries(V2_SYSTEM_REGISTRY)) {
      if (cap.mode !== "structured_live") continue;
      expect(cap.extractor, `${system}.extractor`).toBeDefined();
      expect(cap.readinessValidator, `${system}.readinessValidator`).toBeDefined();
      expect(cap.argBuilder, `${system}.argBuilder`).toBeDefined();
      expect(cap.resultRenderer, `${system}.resultRenderer`).toBeDefined();
    }
  });
});

describe("validateStructuredLivePromotion (ADR-0001 CI hook)", () => {
  it("passes today because every structured_live system is on the provisional allowlist", () => {
    const result = validateStructuredLivePromotion();
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("warns once per provisional system", () => {
    const result = validateStructuredLivePromotion();
    const provisionalKeys = Object.keys(PROVISIONAL_STRUCTURED_LIVE);
    expect(result.warnings).toHaveLength(provisionalKeys.length);
    for (const system of provisionalKeys) {
      expect(
        result.warnings.some((w) => w.startsWith(`${system} is provisional`)),
        `expected a provisional warning for ${system}`,
      ).toBe(true);
    }
  });

  it("provisional allowlist contains exactly the currently-live systems", () => {
    const liveSystems = Object.entries(V2_SYSTEM_REGISTRY)
      .filter(([, cap]) => cap.mode === "structured_live")
      .map(([key]) => key)
      .sort();
    expect(Object.keys(PROVISIONAL_STRUCTURED_LIVE).sort()).toEqual(liveSystems);
  });
});

describe("validateStructuredLivePromotion — evidence mode (slice 32)", () => {
  it("fails when a structured_live system has no calibration evidence", async () => {
    const { validateStructuredLivePromotion } = await import("../../src/v2/systemRegistry.js");
    const noEvidence = { loadCalibration: () => null };
    const result = validateStructuredLivePromotion(noEvidence);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("no ADR-0001 calibration report was found"))).toBe(true);
  });

  it("fails when a structured_live system's evidence is below threshold", async () => {
    const { validateStructuredLivePromotion } = await import("../../src/v2/systemRegistry.js");
    const failingEvidence = {
      loadCalibration: () => ({
        sampleSize: 30,
        componentSafeOutcomeRate: 0.5, // 50% — below any threshold
        exactCalculationRate: 0.4,
        exactRowCount: 10,
      }),
    };
    const result = validateStructuredLivePromotion(failingEvidence);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("below threshold"))).toBe(true);
  });

  it("passes when every structured_live system has evidence at or above threshold", async () => {
    const { validateStructuredLivePromotion } = await import("../../src/v2/systemRegistry.js");
    const passingEvidence = {
      loadCalibration: () => ({
        sampleSize: 30,
        componentSafeOutcomeRate: 1.0, // 100%
        exactCalculationRate: 1.0,
        exactRowCount: 10,
      }),
    };
    const result = validateStructuredLivePromotion(passingEvidence);
    expect(result.ok, result.failures.join("; ")).toBe(true);
  });

  it("treats N/A (n=0 exact) as passing exact-calc threshold", async () => {
    const { validateStructuredLivePromotion } = await import("../../src/v2/systemRegistry.js");
    const naEvidence = {
      loadCalibration: () => ({
        sampleSize: 30,
        componentSafeOutcomeRate: 1.0,
        exactCalculationRate: 0.0, // would fail if exactRowCount > 0
        exactRowCount: 0,
      }),
    };
    const result = validateStructuredLivePromotion(naEvidence);
    expect(result.ok, result.failures.join("; ")).toBe(true);
  });
});
