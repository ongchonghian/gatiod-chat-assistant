// Phase B — preserve candidate findings through consensus acceptance.
//
// Issue #12 / RC-2: when a doctor accepts a pending semantic consensus,
// the resulting ExtractionContext.acceptedFindings used to be hard-coded
// to `[]` because PendingConsensus stored only candidateSystems. After
// this slice, PendingConsensus also persists candidateFindings, and the
// orchestrator threads them into the extraction context so downstream
// extractors and resolvers know exactly which findings the doctor agreed
// to.

import { describe, expect, it } from "vitest";
import { runConsensusOrchestrator } from "../../src/v2/consensusOrchestrator.js";
import {
  defaultV2SessionState,
  setPendingConsensus,
} from "../../src/v2/stateMachine.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import type {
  PendingConsensus,
  SemanticCandidateFinding,
} from "../../src/v2/contracts.js";

const NOW = "2026-05-11T00:00:00.000Z";

const FINDINGS: SemanticCandidateFinding[] = [
  {
    system: "lower_limb",
    sourceSpan: "Left common peroneal nerve lesion with combined sensory and motor deficit",
    findingType: "neurological",
    proposedMapping: "Lower-limb common peroneal nerve, combined deficit",
    systemConfidence: 0.9,
    mappingConfidence: 0.85,
    completeness: "missing_calculation_fields",
    explicitlyStatedFields: ["side: left"],
    inferredFields: [],
    missingFields: ["partial vs total loss"],
    calculationReady: false,
  },
  {
    system: "spine",
    sourceSpan: "L4/L5 disc herniation with radiculopathy",
    findingType: "structural",
    proposedMapping: "Spine intervertebral disc, lumbar",
    systemConfidence: 0.95,
    mappingConfidence: 0.9,
    completeness: "missing_calculation_fields",
    explicitlyStatedFields: ["region: lumbar", "diagnosis: disc herniation"],
    inferredFields: [],
    missingFields: ["severity bracket"],
    calculationReady: false,
  },
];

function pendingWithFindings(): PendingConsensus {
  return {
    interpretationId: "interp-findings-1",
    interpretationHash: "ihash",
    sourceHash: "shash",
    sourceText:
      "Left common peroneal nerve lesion with combined sensory and motor deficit; L4/L5 disc herniation with radiculopathy.",
    message: "Detected: lower_limb, spine",
    candidateSystems: ["lower_limb", "spine"],
    candidateFindings: FINDINGS,
    createdAt: NOW,
    awaiting: "decision",
  };
}

describe("Consensus accept preserves candidateFindings (issue #12, RC-2)", () => {
  it("threads pendingConsensus.candidateFindings into ExtractionContext on Proceed", async () => {
    const state = setPendingConsensus(defaultV2SessionState(), pendingWithFindings());
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Proceed",
      normalized: normalizeClinicalUtterance("Proceed"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("substitute");
    if (result.kind === "substitute") {
      // The accepted findings must come through populated, not as `[]`.
      expect(result.extractionContext.acceptedFindings).toHaveLength(2);
      expect(result.extractionContext.acceptedFindings.map((f) => f.system)).toEqual([
        "lower_limb",
        "spine",
      ]);
      expect(result.extractionContext.acceptedFindings[0].sourceSpan).toContain(
        "common peroneal nerve",
      );
    }
  });

  it("threads candidateFindings on system-first acceptance ('Spine first')", async () => {
    const state = setPendingConsensus(defaultV2SessionState(), pendingWithFindings());
    const result = await runConsensusOrchestrator({
      state,
      replyText: "Spine first",
      normalized: normalizeClinicalUtterance("Spine first"),
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });
    expect(result.kind).toBe("substitute");
    if (result.kind === "substitute") {
      expect(result.extractionContext.focusSystem).toBe("spine");
      expect(result.extractionContext.acceptedFindings).toHaveLength(2);
    }
  });
});
