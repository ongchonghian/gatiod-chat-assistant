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
  it("all 9 systems are structured_live (Sprint 6 complete — CNS + Visual migrated 2026-05-14)", () => {
    const live = ["spine", "hearing", "gastro_digestive", "renal", "respiratory", "upper_limb", "lower_limb", "cns", "visual"];
    for (const system of live) {
      expect(
        V2_SYSTEM_REGISTRY[system as keyof typeof V2_SYSTEM_REGISTRY].mode,
        system,
      ).toBe("structured_live");
    }
  });

  it("isStructuredLiveSystem returns true for all 9 systems", () => {
    const live = ["spine", "hearing", "gastro_digestive", "renal", "respiratory", "upper_limb", "lower_limb", "cns", "visual"] as const;
    for (const system of live) {
      expect(isStructuredLiveSystem(system), system).toBe(true);
    }
  });

  it("isStructuredCapableSystem returns true for all 9 systems", () => {
    const capable = ["upper_limb", "lower_limb", "spine", "respiratory", "renal", "gastro_digestive", "hearing", "cns", "visual"] as const;
    for (const system of capable) {
      expect(isStructuredCapableSystem(system), system).toBe(true);
    }
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
  it("allowlist mode fails for promoted systems not on PROVISIONAL_STRUCTURED_LIVE", () => {
    // V2-703/704: 7 systems were promoted and removed from PROVISIONAL. In
    // allowlist mode (no evidence reader), they're now flagged as failures
    // because they're structured_live but not on the allowlist. This is
    // expected — CI must always use evidence mode (FileCalibrationEvidenceReader).
    const result = validateStructuredLivePromotion();
    expect(result.ok).toBe(false);
    const promotedSystems = ["spine", "upper_limb", "lower_limb", "respiratory", "renal", "gastro_digestive", "hearing"];
    for (const sys of promotedSystems) {
      expect(result.failures.some((f) => f.includes(sys)), `expected failure for ${sys}`).toBe(true);
    }
  });

  it("warns once per provisional system (cns and visual)", () => {
    // Only cns and visual remain on the PROVISIONAL allowlist.
    const result = validateStructuredLivePromotion();
    const provisionalKeys = Object.keys(PROVISIONAL_STRUCTURED_LIVE);
    expect(provisionalKeys.sort()).toEqual(["cns", "visual"]);
    expect(result.warnings).toHaveLength(provisionalKeys.length);
    for (const system of provisionalKeys) {
      expect(
        result.warnings.some((w) => w.startsWith(`${system} is provisional`)),
        `expected a provisional warning for ${system}`,
      ).toBe(true);
    }
  });

  it("PROVISIONAL_STRUCTURED_LIVE contains only remaining provisional systems (cns, visual)", () => {
    // V2-703/704 removed 7 systems. Only cns (REQ-A3) and visual (REQ-A6) remain.
    expect(Object.keys(PROVISIONAL_STRUCTURED_LIVE).sort()).toEqual(["cns", "visual"]);
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
