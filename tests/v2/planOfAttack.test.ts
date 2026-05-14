import { describe, expect, it } from "vitest";
import { renderSemanticConsensus } from "../../src/v2/semanticInterpreterRenderer.js";
import type { SemanticInterpretation } from "../../src/v2/contracts.js";

function multiSystemInterpretation(): SemanticInterpretation {
  return {
    interpretationId: "interp-1",
    sourceHash: "hash-1",
    candidateSystems: [
      { system: "upper_limb", status: "structured_live", confidence: 0.9, rationale: "shoulder finding" },
      { system: "spine", status: "structured_live", confidence: 0.9, rationale: "L4 disc finding" },
      { system: "hearing", status: "structured_live", confidence: 0.9, rationale: "right ear AHL" },
    ],
    candidateFindings: [],
    unsupportedTerms: [],
    proceedReady: true,
  } as unknown as SemanticInterpretation;
}

function singleSystemInterpretation(): SemanticInterpretation {
  return {
    interpretationId: "interp-1",
    sourceHash: "hash-1",
    candidateSystems: [
      { system: "upper_limb", status: "structured_live", confidence: 0.9, rationale: "shoulder finding" },
    ],
    candidateFindings: [],
    unsupportedTerms: [],
    proceedReady: true,
  } as unknown as SemanticInterpretation;
}

describe("renderSemanticConsensus multi-system rendering", () => {
  it("lists all candidate systems and includes Proceed chip when ≥2 systems", () => {
    const r = renderSemanticConsensus(multiSystemInterpretation());
    expect(r.message).toMatch(/3 GATIOD assessment areas/);
    expect(r.message).toMatch(/Upper Limb/);
    expect(r.message).toMatch(/Spine/);
    expect(r.message).toMatch(/Hearing/);
    expect(r.chips).toContain("Proceed");
    expect(r.candidateSystems).toEqual(["upper_limb", "spine", "hearing"]);
  });

  it("lists the single system and includes Proceed chip for single-system claims", () => {
    const r = renderSemanticConsensus(singleSystemInterpretation());
    expect(r.message).toMatch(/1 GATIOD assessment area/);
    expect(r.chips).toContain("Proceed");
    expect(r.candidateSystems).toEqual(["upper_limb"]);
  });
});
