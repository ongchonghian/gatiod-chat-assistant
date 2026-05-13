// Semantic shadow golden registry (V2-805, REQ-SC-TEST-001).
//
// Seeded from the curated PRD §22 scenarios. Kept here (not imported from
// tests/) so production code has no test-directory dependency. If scenarios
// are updated in tests/v2/semanticShadow/scenarios.ts, mirror the change
// here as well.

import type { SemanticGoldenCase } from "./semanticShadowGrader.js";

export const SEMANTIC_SHADOW_GOLDENS: SemanticGoldenCase[] = [
  {
    id: "GS-001-lower-limb-and-cns",
    description: "Lower limb common peroneal nerve + CNS anosmia (PRD GS-001)",
    input:
      "Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.",
    expected: {
      candidateSystems: ["lower_limb", "cns"],
      legacyDeferredSystems: ["cns"],
      requiredMissingFields: {
        lower_limb: ["partial", "total"],
      },
    },
  },
  {
    id: "GS-002-spine-and-hearing",
    description: "Thoraco-lumbar fracture + right ear AHL 90 (PRD GS-002)",
    input:
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB.",
    expected: {
      candidateSystems: ["spine", "hearing"],
    },
  },
  {
    id: "GS-003-ambiguous-rom",
    description: "Bare upper-limb ROM angle without direction (PRD GS-003)",
    input: "Left shoulder 90 degrees.",
    expected: {
      candidateSystems: ["upper_limb"],
      requiredMissingFields: {
        upper_limb: ["direction"],
      },
    },
  },
  {
    id: "GS-004-multi-region-spine",
    description: "Cervical + lumbo-sacral spine in same utterance (PRD GS-004)",
    input:
      "Cervical prolapsed disc with sensory deficit and lumbo-sacral compression/burst fracture <25% residual pain.",
    expected: {
      candidateSystems: ["spine"],
    },
  },
  {
    id: "GS-005-all-9-systems",
    description: "Polytrauma claim spanning all nine GATIOD systems (PRD GS-005)",
    input:
      "Polytrauma claim: right ear hearing loss AHL 90 after blast; thoraco-lumbar compression fracture <25%; left common peroneal nerve lesion combined sensory and motor deficit; complete anosmia after olfactory nerve injury; left eye 6/60 with central diplopia; CKD stage 4; occupational asthma on high-dose inhaled steroids; recurrent abdominal wall hernia; left shoulder flexion 90 degrees.",
    expected: {
      candidateSystems: [
        "hearing",
        "spine",
        "lower_limb",
        "cns",
        "visual",
        "renal",
        "respiratory",
        "gastro_digestive",
        "upper_limb",
      ],
      legacyDeferredSystems: ["cns", "visual"],
    },
  },
  {
    id: "GS-006-single-system-hearing",
    description: "Simple single-system hearing input — gate may skip but if it does fire, semantic must be tight",
    input: "Right ear injury AHL 90 dB.",
    expected: {
      candidateSystems: ["hearing"],
      forbiddenSystems: ["spine", "lower_limb", "upper_limb", "cns", "visual", "renal", "respiratory", "gastro_digestive"],
    },
  },
  {
    id: "GS-007-spine-hearing-cvc-trigger",
    description: "Spine + hearing — Global CVC eligible after extraction; semantic should not produce final PI",
    input:
      "Lumbo-sacral compression burst fracture with persistent pain plus right ear AHL 65 dB after blast injury.",
    expected: {
      candidateSystems: ["spine", "hearing"],
    },
  },
  {
    id: "GS-008-cns-visual-only",
    description: "CNS olfactory + visual diplopia only — both legacy/deferred",
    input:
      "Complete anosmia after olfactory nerve injury and persistent diplopia with central scotoma.",
    expected: {
      candidateSystems: ["cns", "visual"],
      legacyDeferredSystems: ["cns", "visual"],
    },
  },
];

/** Look up a golden case by the `id` field. Returns `undefined` when there
 *  is no match — the shadow hook treats a no-match as `hadGolden: false`. */
export function findGoldenByInterpretationId(
  interpretationId: string,
): SemanticGoldenCase | undefined {
  return SEMANTIC_SHADOW_GOLDENS.find((g) => g.id === interpretationId);
}

/** Look up a golden case by the SHA-256 hex hash of the input text
 *  (`sourceHash` on the interpretation). Returns `undefined` on no-match. */
export function findGoldenBySourceHash(
  sourceHash: string,
): SemanticGoldenCase | undefined {
  // The grader only has the hash, so pre-compute hashes on demand.
  // This file is imported at most once per process; the tiny linear scan
  // is negligible for a registry of < 20 cases.
  const { createHash } = require("crypto") as typeof import("crypto");
  return SEMANTIC_SHADOW_GOLDENS.find(
    (g) => createHash("sha256").update(g.input).digest("hex") === sourceHash,
  );
}
