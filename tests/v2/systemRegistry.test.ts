import { describe, expect, it } from "vitest";
import {
  validateSystemRegistry,
  isStructuredLiveSystem,
  isStructuredCapableSystem,
  V2_SYSTEM_REGISTRY,
} from "../../src/v2/systemRegistry.js";

describe("validateSystemRegistry", () => {
  it("passes — all structured_live systems have all 4 required components", () => {
    expect(() => validateSystemRegistry()).not.toThrow();
  });
});

describe("system migration modes", () => {
  it("7 systems are structured_live", () => {
    const live = ["upper_limb", "lower_limb", "spine", "respiratory", "renal", "gastro_digestive", "hearing"];
    for (const system of live) {
      expect(V2_SYSTEM_REGISTRY[system as keyof typeof V2_SYSTEM_REGISTRY].mode, system).toBe("structured_live");
    }
  });

  it("cns and visual remain legacy", () => {
    expect(V2_SYSTEM_REGISTRY.cns.mode).toBe("legacy");
    expect(V2_SYSTEM_REGISTRY.visual.mode).toBe("legacy");
  });

  it("isStructuredLiveSystem returns true for all 7 live systems", () => {
    const live = ["upper_limb", "lower_limb", "spine", "respiratory", "renal", "gastro_digestive", "hearing"] as const;
    for (const system of live) {
      expect(isStructuredLiveSystem(system), system).toBe(true);
    }
  });

  it("isStructuredLiveSystem returns false for legacy systems", () => {
    expect(isStructuredLiveSystem("cns")).toBe(false);
    expect(isStructuredLiveSystem("visual")).toBe(false);
  });

  it("isStructuredCapableSystem returns true for all structured_live systems", () => {
    const live = ["upper_limb", "lower_limb", "spine", "respiratory", "renal", "gastro_digestive", "hearing"] as const;
    for (const system of live) {
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
