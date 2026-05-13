import type { SemanticGoldenCase } from "../../../src/v2/semanticShadowGrader.js";

// Curated semantic golden scenarios (P1-A, REQ-SC-TEST-001).
//
// Each case describes a clinical input the doctor might paste, plus the
// minimum the semantic interpreter must produce to be considered correct:
//   - candidateSystems: the systems the input clearly mentions
//   - legacyDeferredSystems: those that must carry status legacy_deferred
//     (cns/visual under the current registry mode)
//   - requiredMissingFields: per-system phrases that should appear in the
//     finding's missingFields list (substring match)
//   - forbiddenSystems: systems that should NOT be in the proposal
//
// The scenarios mirror PRD §22 (GS-001..GS-005) and add a few extra cases
// covering single-system, multi-region spine, and global-CVC trigger inputs.

export const SEMANTIC_GOLDENS: SemanticGoldenCase[] = [
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
      // The semantic interpreter detects spine; the multi-region narrowing
      // is a downstream concern (orchestrator + extractor selectedScope).
      // The interpreter is *not* required to flag region as "missing" —
      // both regions are present in the source text. The interpreter is
      // only required to identify the spine system correctly.
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
