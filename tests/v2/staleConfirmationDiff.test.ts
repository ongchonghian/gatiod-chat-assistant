import { describe, expect, it } from "vitest";
import { diffFacts, formatDiffLines } from "../../src/v2/staleConfirmationDiff.js";
import type { ExtractedFact, V2SystemFacts } from "../../src/v2/contracts.js";

function fact<T>(value: T): ExtractedFact<T> {
  return {
    value,
    sourceText: "test",
    confidence: 1,
    extractionMethod: "user_selected",
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
  };
}

describe("diffFacts (slice #12)", () => {
  it("returns [] for identical snapshots", () => {
    const facts: V2SystemFacts = { side: fact("left") };
    expect(diffFacts("upper_limb", facts, facts)).toEqual([]);
  });

  it("detects an added fact", () => {
    const oldF: V2SystemFacts = {};
    const newF: V2SystemFacts = { side: fact("left") };
    const lines = diffFacts("upper_limb", oldF, newF);
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("added");
    expect(lines[0].newValue).toBe("left");
    expect(lines[0].oldValue).toBeUndefined();
  });

  it("detects a removed fact", () => {
    const oldF: V2SystemFacts = { side: fact("left") };
    const newF: V2SystemFacts = {};
    const lines = diffFacts("upper_limb", oldF, newF);
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("removed");
    expect(lines[0].oldValue).toBe("left");
  });

  it("detects a changed fact", () => {
    const oldF: V2SystemFacts = { side: fact("left") };
    const newF: V2SystemFacts = { side: fact("right") };
    const lines = diffFacts("upper_limb", oldF, newF);
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("changed");
    expect(lines[0].oldValue).toBe("left");
    expect(lines[0].newValue).toBe("right");
  });

  it("returns lines in stable alphabetical order", () => {
    const oldF: V2SystemFacts = {};
    const newF: V2SystemFacts = {
      side: fact("left"),
      bilateral_mode: fact("same"),
    };
    const lines = diffFacts("upper_limb", oldF, newF);
    // Sorted by fact key: bilateral_mode comes before side.
    expect(lines.map((l) => l.label.toLowerCase())).toEqual(
      lines.map((l) => l.label.toLowerCase()).slice().sort(),
    );
  });

  it("filters out internal underscore-prefixed fact keys", () => {
    const oldF: V2SystemFacts = { _internal: fact("anything") };
    const newF: V2SystemFacts = { _internal: fact("changed") };
    expect(diffFacts("upper_limb", oldF, newF)).toEqual([]);
  });

  it("uses clinical labels for spine region values (delegates to clinicalLabels)", () => {
    const oldF: V2SystemFacts = {};
    const newF: V2SystemFacts = { spine_region: fact("lumbo_sacral") };
    const lines = diffFacts("spine", oldF, newF);
    // The label and value come from the clinical-display layer — at minimum
    // the raw enum key should NOT appear in the rendered value.
    expect(lines[0].newValue).not.toContain("_");
  });
});

describe("formatDiffLines", () => {
  it("renders added / removed / changed with distinct prefixes", () => {
    const output = formatDiffLines([
      { label: "Region", newValue: "Lumbo-Sacral", kind: "added" },
      { label: "Side",   oldValue: "left",          kind: "removed" },
      { label: "ASIA",   oldValue: "B", newValue: "C", kind: "changed" },
    ]);
    expect(output).toMatch(/^\+ Region: Lumbo-Sacral$/m);
    expect(output).toMatch(/^− Side: left$/m);
    expect(output).toMatch(/^↻ ASIA: B → C$/m);
  });

  it("returns an empty string for an empty diff", () => {
    expect(formatDiffLines([])).toBe("");
  });
});
