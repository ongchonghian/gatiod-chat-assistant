import { describe, expect, it } from "vitest";
import {
  NARRATOR_ONLY_CONSTRAINTS,
  renderNarratorConstraintsBlock,
} from "../../src/chat/promptConstraints.js";
import { SYSTEM_PROMPT } from "../../src/chat/systemPrompt.js";

describe("NARRATOR_ONLY_CONSTRAINTS (ADR-0007 slice #14)", () => {
  it("declares a non-empty rule set", () => {
    expect(NARRATOR_ONLY_CONSTRAINTS.length).toBeGreaterThan(0);
    for (const rule of NARRATOR_ONLY_CONSTRAINTS) {
      expect(rule).toMatch(/\S/);
    }
  });

  it("covers all explicitly prohibited fields", () => {
    const combined = NARRATOR_ONLY_CONSTRAINTS.join(" ").toLowerCase();
    // The constraints must address each of these prohibitions by name.
    expect(combined).toMatch(/final pi/);
    expect(combined).toMatch(/severity/);
    expect(combined).toMatch(/asia/);
    expect(combined).toMatch(/diplopia/);
    expect(combined).toMatch(/rom direction|flexion/);
    expect(combined).toMatch(/nerve deficit|sensory|motor/);
  });
});

describe("renderNarratorConstraintsBlock", () => {
  it("produces a markdown block that includes every constraint verbatim", () => {
    const block = renderNarratorConstraintsBlock();
    for (const rule of NARRATOR_ONLY_CONSTRAINTS) {
      expect(block).toContain(rule);
    }
  });
});

describe("SYSTEM_PROMPT integration", () => {
  it("contains every narrator-only constraint verbatim", () => {
    for (const rule of NARRATOR_ONLY_CONSTRAINTS) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it("keeps the original prompt body intact (does not replace it)", () => {
    expect(SYSTEM_PROMPT).toMatch(/Core Rules/);
    expect(SYSTEM_PROMPT).toMatch(/Upper Limb Assessment Protocol/);
  });
});
