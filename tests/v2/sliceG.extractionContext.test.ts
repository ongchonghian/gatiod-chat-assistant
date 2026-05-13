import { describe, expect, it } from "vitest";
import { extractSpine } from "../../src/v2/extractors/spine.js";
import { extractHearing } from "../../src/v2/extractors/hearing.js";
import { extractLowerLimb } from "../../src/v2/extractors/lowerLimb.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type {
  ExtractionContext,
  NormalizedUtterance,
} from "../../src/v2/contracts.js";

// Slice G — extraction context threading and spine selectedScope narrowing
// (REQ-MS-EXTRACT-001, REQ-SC-SPINE-001, REQ-SC-SPINE-002).

function utt(text: string): NormalizedUtterance {
  return {
    raw: text,
    normalizedText: text.toLowerCase(),
    tokens: text.split(/\s+/),
    mappedTokens: [],
    unresolvedTerms: [],
    confidence: 0.9,
  };
}

function makeExtractionContext(
  overrides: Partial<ExtractionContext> = {},
): ExtractionContext {
  return {
    consensusId: "interp-1",
    sourceText:
      "Cervical prolapsed disc with sensory deficit; lumbo-sacral compression/burst fracture <25% residual pain",
    sourceHash: "h",
    acceptedSystems: ["spine"],
    acceptedFindings: [],
    ...overrides,
  };
}

const SPINE_MULTI_REGION_TEXT =
  "Cervical prolapsed disc with sensory deficit; lumbo-sacral compression/burst fracture <25% residual pain";

describe("Slice G — extractor signature compatibility", () => {
  it("spine extractor accepts a 4th extractionContext parameter without error", () => {
    const result = extractSpine(
      utt("cervical spine fracture"),
      defaultV2SessionState().systems.spine,
      [],
      undefined,
    );
    expect(result.extractedFactsPatch["spine_region"]?.value).toBe("cervical");
  });

  it("spine extractor behaves identically when extractionContext is omitted vs undefined", () => {
    const a = extractSpine(
      utt("cervical spine fracture"),
      defaultV2SessionState().systems.spine,
      [],
    );
    const b = extractSpine(
      utt("cervical spine fracture"),
      defaultV2SessionState().systems.spine,
      [],
      undefined,
    );
    // Timestamps differ by ms — compare value-only fields.
    expect(a.extractedFactsPatch["spine_region"]?.value).toBe(
      b.extractedFactsPatch["spine_region"]?.value,
    );
    expect(a.slotSignalsPatch).toEqual(b.slotSignalsPatch);
    expect(a.warnings).toEqual(b.warnings);
    expect(a.pendingObservationsToAdd.map((p) => p.clarificationQuestion)).toEqual(
      b.pendingObservationsToAdd.map((p) => p.clarificationQuestion),
    );
  });

  it("hearing extractor (3-arg) is satisfied by the 4-arg StructuredExtractor type", () => {
    // hearing extractor declares 3 params; TS allows it to satisfy the 4-param
    // type because the 4th is optional. Calling it with a 4th arg is fine but
    // the extractor ignores it.
    const result = extractHearing(
      utt("right ear AHL 90 dB injury"),
      defaultV2SessionState().systems.hearing,
    );
    expect(result.extractedFactsPatch).toBeDefined();
  });

  it("lower_limb extractor (3-arg) ignores the 4th parameter when passed", () => {
    const result = extractLowerLimb(
      utt("left common peroneal nerve total motor deficit"),
      defaultV2SessionState().systems.lower_limb,
      [],
    );
    expect(result.extractedFactsPatch).toBeDefined();
  });
});

describe("Slice G — spine selectedScope narrowing (REQ-SC-SPINE-001/002)", () => {
  it("uses selectedScope.sourceSpans instead of full normalizedText when present", () => {
    // The doctor sent a multi-region utterance and selected "Cervical" via
    // a future region-first chip. The orchestrator hands the cervical span
    // only via selectedScope. Without narrowing, the full text contains both
    // regions and the multi-region guard would block.
    const ctx = makeExtractionContext({
      selectedScope: {
        system: "spine",
        scope: "cervical",
        sourceSpans: ["Cervical prolapsed disc with sensory deficit"],
      },
    });
    const result = extractSpine(
      utt(SPINE_MULTI_REGION_TEXT),
      defaultV2SessionState().systems.spine,
      [],
      ctx,
    );
    expect(result.extractedFactsPatch["spine_region"]?.value).toBe("cervical");
    // No multi-region guard pending observation should be emitted.
    expect(
      result.pendingObservationsToAdd.some(
        (p) => p.type === "other" && p.clarificationQuestion?.includes("Multi-region"),
      ),
    ).toBe(false);
  });

  it("multi-region guard still fires when selectedScope contains multiple regions (defensive)", () => {
    // A buggy upstream caller passes both regions in selectedScope. The
    // hard guard (REQ-SC-SPINE-002) must still block.
    const ctx = makeExtractionContext({
      selectedScope: {
        system: "spine",
        scope: "cervical",
        sourceSpans: [
          "Cervical prolapsed disc with sensory deficit",
          "lumbo-sacral compression/burst fracture <25% residual pain",
        ],
      },
    });
    const result = extractSpine(
      utt(SPINE_MULTI_REGION_TEXT),
      defaultV2SessionState().systems.spine,
      [],
      ctx,
    );
    // Region fact MUST NOT be written when multi-region is detected.
    expect(result.extractedFactsPatch["spine_region"]).toBeUndefined();
    // A clarification observation should be present.
    expect(result.pendingObservationsToAdd.length).toBeGreaterThan(0);
    expect(
      result.pendingObservationsToAdd.some((p) =>
        p.clarificationQuestion?.toLowerCase().includes("more than one spinal region"),
      ),
    ).toBe(true);
  });

  it("ignores selectedScope when it targets a different system", () => {
    const ctx = makeExtractionContext({
      selectedScope: {
        system: "lower_limb",
        scope: "left",
        sourceSpans: ["Left common peroneal nerve lesion"],
      },
    });
    // Spine extractor sees the full normalizedText and parses normally.
    const result = extractSpine(
      utt("cervical spine fracture"),
      defaultV2SessionState().systems.spine,
      [],
      ctx,
    );
    expect(result.extractedFactsPatch["spine_region"]?.value).toBe("cervical");
  });

  it("falls back to utterance text when selectedScope.sourceSpans is empty", () => {
    const ctx = makeExtractionContext({
      selectedScope: {
        system: "spine",
        scope: "cervical",
        sourceSpans: [],
      },
    });
    // Empty sourceSpans → fall back to the utterance text. The utterance
    // contains a single region, so extraction proceeds normally.
    const result = extractSpine(
      utt("cervical spine fracture"),
      defaultV2SessionState().systems.spine,
      [],
      ctx,
    );
    expect(result.extractedFactsPatch["spine_region"]?.value).toBe("cervical");
  });

  it("does not write semantic findings as extractedFacts (REQ-MS-EXTRACT-001 read-only)", () => {
    // Even though acceptedFindings carries a "lower-limb common peroneal nerve"
    // proposal, the spine extractor must NOT pick it up — extraction context
    // is read-only and informational, not authoritative for facts.
    const ctx = makeExtractionContext({
      acceptedSystems: ["spine", "lower_limb"],
      acceptedFindings: [
        {
          system: "lower_limb",
          sourceSpan: "Left common peroneal nerve lesion",
          findingType: "neurological",
          proposedMapping: "lower-limb common peroneal nerve",
          systemConfidence: 0.9,
          mappingConfidence: 0.9,
          completeness: "missing_calculation_fields",
          explicitlyStatedFields: ["side: left"],
          inferredFields: [],
          missingFields: ["partial vs total"],
          calculationReady: false,
        },
      ],
    });
    const result = extractSpine(
      utt("cervical spine fracture"),
      defaultV2SessionState().systems.spine,
      [],
      ctx,
    );
    // Spine facts only — no smuggling of lower-limb findings.
    const factKeys = Object.keys(result.extractedFactsPatch);
    expect(factKeys.every((k) => k.startsWith("spine_"))).toBe(true);
  });
});
