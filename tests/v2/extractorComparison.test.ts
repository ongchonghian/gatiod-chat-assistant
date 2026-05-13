import { describe, expect, it } from "vitest";
import {
  buildComparisonOffer,
} from "../../src/v2/slotSchemas/extractorComparison.js";
import type { StructuredExtractionResult } from "../../src/v2/contracts.js";

// Helpers ─────────────────────────────────────────────────────────────────────

function makeSpineResult(
  overrides: Partial<StructuredExtractionResult> = {},
): StructuredExtractionResult {
  return {
    extractedFactsPatch: {},
    pendingObservationsToAdd: [],
    pendingObservationsToResolve: [],
    slotSignalsPatch: {},
    displayValuesPatch: {},
    warnings: [],
    auditEvents: [],
    ...overrides,
  };
}

const discEntry = {
  diagnosisCategory: "intervertebral_disc",
  severityKey: "disc31_persistent_motor_or_motor_sensory",
  monoparesisHalving: false,
  bladderBowelSeverity: "none",
  discCordInvolvement: false,
  spondylolysisPathway: "acute_traumatic",
};

// ── Issue 02: spine comparison message — no raw identifiers ───────────────────

describe("buildComparisonOffer — spine", () => {
  it("message contains no raw JSON brackets", () => {
    const primary = makeSpineResult({
      extractedFactsPatch: {
        spine_region: { value: "lumbo_sacral", sourceText: "", confidence: 1, extractionMethod: "regex", createdAt: "", updatedAt: "" },
        spine_entries: { value: [discEntry], sourceText: "", confidence: 1, extractionMethod: "regex", createdAt: "", updatedAt: "" },
      },
      displayValuesPatch: { spine_region: "Lumbo-Sacral" },
    });
    const shadow = makeSpineResult({
      extractedFactsPatch: {
        spine_region: { value: "lumbo_sacral", sourceText: "", confidence: 1, extractionMethod: "llm_proposed_validated", createdAt: "", updatedAt: "" },
      },
      displayValuesPatch: { spine_region: "Lumbo-Sacral" },
    });

    const offer = buildComparisonOffer("spine", "disc prolapse L4/5", primary, shadow);
    expect(offer.message).not.toContain("{");
    expect(offer.message).not.toContain("[{");
  });

  it("message contains no raw severity codes", () => {
    const primary = makeSpineResult({
      extractedFactsPatch: {
        spine_entries: { value: [discEntry], sourceText: "", confidence: 1, extractionMethod: "regex", createdAt: "", updatedAt: "" },
      },
      displayValuesPatch: {},
    });
    const shadow = makeSpineResult();

    const offer = buildComparisonOffer("spine", "disc prolapse", primary, shadow);
    expect(offer.message).not.toContain("disc31_persistent");
    expect(offer.message).not.toContain("disc31_");
  });

  it("message uses clinical label 'Diagnosis entries' not raw key 'spine_entries'", () => {
    const primary = makeSpineResult({
      extractedFactsPatch: {
        spine_entries: { value: [discEntry], sourceText: "", confidence: 1, extractionMethod: "regex", createdAt: "", updatedAt: "" },
      },
      displayValuesPatch: {},
    });
    const shadow = makeSpineResult();

    const offer = buildComparisonOffer("spine", "disc prolapse", primary, shadow);
    expect(offer.message).not.toContain("**spine_entries**");
    expect(offer.message).toContain("**Diagnosis entries**");
  });

  it("conflict line uses clinical label 'Region' not raw key 'spine_region'", () => {
    const primary = makeSpineResult({
      extractedFactsPatch: {
        spine_region: { value: "lumbo_sacral", sourceText: "", confidence: 1, extractionMethod: "regex", createdAt: "", updatedAt: "" },
      },
      displayValuesPatch: {},
    });
    const shadow = makeSpineResult({
      extractedFactsPatch: {
        spine_region: { value: "cervical", sourceText: "", confidence: 1, extractionMethod: "llm_proposed_validated", createdAt: "", updatedAt: "" },
      },
      displayValuesPatch: {},
    });

    const offer = buildComparisonOffer("spine", "spine injury", primary, shadow);
    expect(offer.hasConflicts).toBe(true);
    expect(offer.message).not.toContain("spine_region");
    expect(offer.message).toContain("Region");
  });
});
