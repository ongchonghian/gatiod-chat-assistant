import { describe, expect, it } from "vitest";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";

describe("normalizeClinicalUtterance", () => {
  it("expands abbreviations and synonyms", () => {
    const result = normalizeClinicalUtterance("CTS with AVN and ROM limitation");
    expect(result.normalizedText.toLowerCase()).toContain("carpal tunnel syndrome");
    expect(result.normalizedText.toLowerCase()).toContain("avascular necrosis");
    expect(result.normalizedText.toLowerCase()).toContain("range of motion");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("flags unresolved terms when language is noisy", () => {
    const result = normalizeClinicalUtterance("xzyq severe lumbo-sacral intervertibral disc");
    expect(result.unresolvedTerms.length).toBeGreaterThan(0);
    expect(result.normalizedText.toLowerCase()).toContain("intervertebral");
  });
});
