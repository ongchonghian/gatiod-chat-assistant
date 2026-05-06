import { describe, it, expect } from "vitest";
import {
  calculateUpperLimb,
  calculateAmputation,
  calculateRom,
  calculateNeurological,
  defaultUpperLimbValue,
  combineMultipleValuesChart,
  lookupRom,
  ROM_JOINTS,
  type UpperLimbValue,
} from "../../src/engine/index.js";

describe("CVC Calculator", () => {
  it("combines two values correctly", () => {
    // CVC(35, 20) should give ~48
    const result = combineMultipleValuesChart([35, 20]);
    expect(result).toBe(48);
  });

  it("returns 0 for empty array", () => {
    expect(combineMultipleValuesChart([])).toBe(0);
  });

  it("returns single value for length-1 array", () => {
    expect(combineMultipleValuesChart([25])).toBe(25);
  });

  it("caps at 100", () => {
    expect(combineMultipleValuesChart([90, 90])).toBeLessThanOrEqual(100);
  });
});

describe("ROM Lookup", () => {
  it("looks up shoulder flexion at 0° correctly", () => {
    const shoulder = ROM_JOINTS.find((j) => j.key === "shoulder")!;
    const flexion = shoulder.directions.find((d) => d.key === "flexion")!;
    expect(lookupRom(flexion.table, 0)).toBe(13);
  });

  it("returns 0% at full normal ROM", () => {
    const shoulder = ROM_JOINTS.find((j) => j.key === "shoulder")!;
    const flexion = shoulder.directions.find((d) => d.key === "flexion")!;
    expect(lookupRom(flexion.table, 150)).toBe(0);
  });

  it("interpolates between table entries", () => {
    const shoulder = ROM_JOINTS.find((j) => j.key === "shoulder")!;
    const flexion = shoulder.directions.find((d) => d.key === "flexion")!;
    const result = lookupRom(flexion.table, 35);
    // Between 30° (10%) and 40° (9%), expect ~9.5
    expect(result).toBeCloseTo(9.5, 1);
  });
});

describe("Amputation Calculation", () => {
  it("returns 75% for above-elbow amputation", () => {
    const result = calculateAmputation({
      armLevel: "above_elbow",
      fingers: { thumb: "none", index: "none", middle: "none", ring: "none", little: "none" },
    });
    expect(result.rawPercent).toBe(75);
  });

  it("sums finger amputations", () => {
    const result = calculateAmputation({
      armLevel: "none",
      fingers: { thumb: "ip", index: "dip", middle: "none", ring: "none", little: "none" },
    });
    // Thumb IP = 20%, Index DIP = 9% → 29%
    expect(result.rawPercent).toBe(29);
  });

  it("caps finger totals at 70% with thumb", () => {
    const result = calculateAmputation({
      armLevel: "none",
      fingers: { thumb: "cmc", index: "mc", middle: "mc", ring: "mc", little: "mc" },
    });
    // 36 + 21 + 15 + 10 + 10 = 92 → capped at 70
    expect(result.rawPercent).toBe(70);
  });
});

describe("Full Upper Limb Calculation", () => {
  it("returns 0% for default empty assessment", () => {
    const value = defaultUpperLimbValue();
    const result = calculateUpperLimb(value);
    expect(result.finalPercent).toBe(0);
  });

  it("calculates ROM-only scenario correctly", () => {
    const value: UpperLimbValue = {
      ...defaultUpperLimbValue(),
      rom: {
        joints: {
          shoulder: {
            isAnkylosed: false,
            measurements: { flexion: 90, abduction: 90 },
          },
        },
      },
    };
    const result = calculateUpperLimb(value);
    // Flexion at 90° = 5%, Abduction at 90° = 5% → ROM total = 10%
    expect(result.rom.rawPercent).toBe(10);
    expect(result.finalPercent).toBe(10);
  });

  it("excludes ROM when romFromNerve is true", () => {
    const value: UpperLimbValue = {
      ...defaultUpperLimbValue(),
      rom: {
        joints: {
          shoulder: {
            isAnkylosed: false,
            measurements: { flexion: 90 },
          },
        },
      },
      neurological: {
        selectedNerves: [
          { nerveKey: "suprascapular", deficitType: "combined", lossType: "total" },
        ],
        romFromNerve: true,
      },
    };
    const result = calculateUpperLimb(value);
    // ROM should be excluded (0%), neuro = suprascapular combined total = 12%
    expect(result.rom.rawPercent).toBe(0);
    expect(result.neurological.rawPercent).toBe(12);
    expect(result.finalPercent).toBe(12);
  });

  it("suppresses distal structures with arm amputation", () => {
    const value: UpperLimbValue = {
      ...defaultUpperLimbValue(),
      amputations: {
        armLevel: "above_elbow",
        fingers: { thumb: "none", index: "none", middle: "none", ring: "none", little: "none" },
      },
      rom: {
        joints: {
          wrist: {
            isAnkylosed: false,
            measurements: { flexion: 0 },
          },
        },
      },
    };
    const result = calculateUpperLimb(value);
    // Amputation = 75%, wrist ROM should be suppressed
    expect(result.amputation.rawPercent).toBe(75);
    expect(result.finalPercent).toBe(75);
  });
});
