import { describe, it, expect } from "vitest";
import { handleToolCall } from "../../src/tools/toolHandlers.js";

// Validation-at-the-boundary tests for the systems that previously bypassed
// schema validation: spine, gastro. The audit highlighted "Weak schema
// enforcement at the function-call boundary" — these tests lock the gate.

describe("assess_spine — boundary validation", () => {
  it("rejects an unknown spinal region", () => {
    const result = handleToolCall("assess_spine", {
      region: "saddle", // hallucinated
      categoryEntries: [
        { diagnosisCategory: "fractures_dislocations", severityKey: "compression_lt25" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid input for spine/);
    expect(result.error).toMatch(/region/);
  });

  it("rejects an unknown diagnosis category", () => {
    const result = handleToolCall("assess_spine", {
      region: "cervical",
      categoryEntries: [
        { diagnosisCategory: "nerve_pinch", severityKey: "asia_d" }, // hallucinated
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/diagnosisCategory/);
  });

  it("rejects an empty categoryEntries array", () => {
    const result = handleToolCall("assess_spine", {
      region: "cervical",
      categoryEntries: [],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/categoryEntries/);
  });

  it("accepts a well-formed payload using severityKey and monoparesisHalving", () => {
    const result = handleToolCall("assess_spine", {
      region: "cervical",
      categoryEntries: [
        {
          diagnosisCategory: "fractures_dislocations",
          severityKey: "compression_lt25",
          monoparesisHalving: false,
          bladderBowelSeverity: "none",
        },
      ],
    });
    expect(result.success).toBe(true);
    expect((result.data as { systemKey: string }).systemKey).toBe("spine");
  });
});

describe("assess_gastro — boundary validation", () => {
  it("rejects an unknown sub-system", () => {
    const result = handleToolCall("assess_gastro", {
      subSystem: "bladder", // hallucinated
      selectedBracketIndex: 1,
      piPercent: 15,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid input for gastro_digestive/);
    expect(result.error).toMatch(/subSystem/);
  });

  it("rejects a piPercent outside the 0-100 range", () => {
    const result = handleToolCall("assess_gastro", {
      subSystem: "upperDigestive",
      selectedBracketIndex: 1,
      piPercent: 250,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/piPercent/);
  });

  it("rejects a non-numeric selectedBracketIndex", () => {
    const result = handleToolCall("assess_gastro", {
      subSystem: "upperDigestive",
      selectedBracketIndex: "Class II", // LLM emitted the label, not the index
      piPercent: 15,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/selectedBracketIndex/);
  });

  it("accepts a well-formed payload", () => {
    const result = handleToolCall("assess_gastro", {
      subSystem: "upperDigestive",
      selectedBracketIndex: 1,
      piPercent: 15,
    });
    expect(result.success).toBe(true);
  });
});
