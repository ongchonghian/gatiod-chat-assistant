import { describe, it, expect } from "vitest";
import {
  calculateLowerLimb,
  defaultLowerLimbValue,
  lookupShortening,
  LowerLimbValueSchema,
  type LowerLimbValue,
} from "../../src/engine/index.js";
import { handleToolCall } from "../../src/tools/toolHandlers.js";

// Audit gold-standard cases — derived directly from GATIOD Chapter 4 tables.
// These lock in the toe-amputation vs shortening distinction the audit flagged.

function lowerLimbValue(overrides: Partial<LowerLimbValue> = {}): LowerLimbValue {
  const base = defaultLowerLimbValue();
  return {
    ...base,
    ...overrides,
    amputations: { ...base.amputations, ...(overrides.amputations ?? {}) },
    rom: { ...base.rom, ...(overrides.rom ?? {}) },
    neurological: { ...base.neurological, ...(overrides.neurological ?? {}) },
    shortening: { ...base.shortening, ...(overrides.shortening ?? {}) },
    dbe: { ...base.dbe, ...(overrides.dbe ?? {}) },
  };
}

describe("Shortening table (Chapter 4 Section IV)", () => {
  it("maps 7.5 cm to 30%", () => {
    expect(lookupShortening(7.5)).toBe(30);
  });

  it("maps 0 cm to 0%", () => {
    expect(lookupShortening(0)).toBe(0);
  });

  it("maps 2 cm to 8%", () => {
    expect(lookupShortening(2)).toBe(8);
  });

  it("caps beyond 7.5 cm at 30%", () => {
    expect(lookupShortening(10)).toBe(30);
  });
});

describe("Toe amputations (Chapter 4 — Amputations of the Lower Limb)", () => {
  it("complete amputation of left 4th toe (through MTP) → 3%", () => {
    const value = lowerLimbValue({
      side: "left",
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.rawPercent).toBe(3);
    expect(result.shortening.rawPercent).toBe(0);
    expect(result.finalPercent).toBe(3);
  });

  it("left 4th toe amputation with 4th metatarsal → 7%", () => {
    const value = lowerLimbValue({
      side: "left",
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "metatarsal", fifth: "none" },
      },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.rawPercent).toBe(7);
    expect(result.finalPercent).toBe(7);
  });
});

describe("Lower limb shortening (Chapter 4 Section IV)", () => {
  it("left lower limb shortening of 7.5 cm with no toe amputation → 30%", () => {
    const value = lowerLimbValue({
      side: "left",
      shortening: { discrepancyCm: 7.5 },
    });
    const result = calculateLowerLimb(value);
    expect(result.shortening.rawPercent).toBe(30);
    expect(result.amputation.rawPercent).toBe(0);
    expect(result.finalPercent).toBe(30);
  });
});

describe("Leg-level amputations", () => {
  it("above-knee amputation → 75% (not 100%)", () => {
    const value = lowerLimbValue({
      side: "right",
      amputations: {
        legLevel: "above_knee",
        toes: { great: "none", second: "none", third: "none", fourth: "none", fifth: "none" },
      },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.rawPercent).toBe(75);
    expect(result.finalPercent).toBe(75);
  });
});

describe("LowerLimbValueSchema — invariants", () => {
  it("rejects toe amputations alongside a leg-level amputation", () => {
    const bad = lowerLimbValue({
      amputations: {
        legLevel: "above_knee",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
    });
    const result = LowerLimbValueSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown toe level", () => {
    const bad = {
      ...defaultLowerLimbValue(),
      amputations: {
        legLevel: "none",
        toes: {
          great: "none",
          second: "none",
          third: "none",
          fourth: "shortened_7_5cm", // hallucinated by LLM
          fifth: "none",
        },
      },
    };
    const result = LowerLimbValueSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed value", () => {
    const ok = lowerLimbValue({
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
    });
    const result = LowerLimbValueSchema.safeParse(ok);
    expect(result.success).toBe(true);
  });
});

describe("Cross-stream invariant — toe amputation + shortening", () => {
  it("warns on both streams when toe amputation and shortening are both present", () => {
    const value = lowerLimbValue({
      side: "left",
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
      shortening: { discrepancyCm: 7.5 },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.notes.some((n) => n.includes("Cross-stream"))).toBe(true);
    expect(result.shortening.notes.some((n) => n.includes("Cross-stream"))).toBe(true);
  });

  it("does not warn when only the toe amputation is present", () => {
    const value = lowerLimbValue({
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.notes.some((n) => n.includes("Cross-stream"))).toBe(false);
    expect(result.shortening.notes.some((n) => n.includes("Cross-stream"))).toBe(false);
  });

  it("does not warn when only shortening is present", () => {
    const value = lowerLimbValue({ shortening: { discrepancyCm: 2 } });
    const result = calculateLowerLimb(value);
    expect(result.shortening.notes.some((n) => n.includes("Cross-stream"))).toBe(false);
  });

  it("does not auto-zero either stream — clinician resolves", () => {
    const value = lowerLimbValue({
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
      shortening: { discrepancyCm: 7.5 },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.rawPercent).toBe(3);
    expect(result.shortening.rawPercent).toBe(30);
  });
});

describe("GATIOD references in CategoryResult", () => {
  it("attaches a chapter/section reference to every populated stream", () => {
    const value = lowerLimbValue({
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
      shortening: { discrepancyCm: 7.5 },
    });
    const result = calculateLowerLimb(value);
    expect(result.amputation.gatiodReference?.chapter).toBe("Chapter 4");
    expect(result.amputation.gatiodReference?.section).toMatch(/Amputations/);
    expect(result.shortening.gatiodReference?.section).toMatch(/Section IV/);
  });

  it("attaches a reference even when the stream value is 0", () => {
    const value = lowerLimbValue();
    const result = calculateLowerLimb(value);
    expect(result.amputation.gatiodReference?.chapter).toBe("Chapter 4");
    expect(result.shortening.gatiodReference?.chapter).toBe("Chapter 4");
  });
});

describe("assess_lower_limb tool boundary — function-call validation", () => {
  it("returns the engine result for a well-formed payload", () => {
    const value = lowerLimbValue({
      side: "left",
      amputations: {
        legLevel: "none",
        toes: { great: "none", second: "none", third: "none", fourth: "mtp", fifth: "none" },
      },
    });
    const result = handleToolCall("assess_lower_limb", value as unknown as Record<string, unknown>);
    expect(result.success).toBe(true);
    expect((result.data as { finalPercent: number }).finalPercent).toBe(3);
  });

  it("rejects a payload where the LLM mis-routes a toe amputation into shortening", () => {
    // The LLM has hallucinated a non-numeric shortening field. The boundary
    // must refuse before the engine sees it.
    const bad = {
      ...defaultLowerLimbValue(),
      shortening: { discrepancyCm: "complete amputation of 4th toe" },
    };
    const result = handleToolCall("assess_lower_limb", bad as unknown as Record<string, unknown>);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid input for lower_limb/);
    expect(result.error).toMatch(/shortening\.discrepancyCm/);
  });

  it("rejects a payload missing required top-level fields", () => {
    const bad = { side: "left" };
    const result = handleToolCall("assess_lower_limb", bad as unknown as Record<string, unknown>);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid input for lower_limb/);
  });

  it("rejects a payload with an unknown toe level", () => {
    const bad = {
      ...defaultLowerLimbValue(),
      amputations: {
        legLevel: "none",
        toes: {
          great: "none",
          second: "none",
          third: "none",
          fourth: "shortened_7_5cm",
          fifth: "none",
        },
      },
    };
    const result = handleToolCall("assess_lower_limb", bad as unknown as Record<string, unknown>);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/amputations\.toes\.fourth/);
  });
});
