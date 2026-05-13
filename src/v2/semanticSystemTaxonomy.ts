// Registry-backed semantic system taxonomy (REQ-SC-PROMPT-001, ADR-0003).
//
// The semantic interpreter prompt is assembled from:
//   1. Hardcoded safety rules + schema instructions (semanticInterpreterPrompt.ts)
//   2. A generated GATIOD taxonomy section, derived from this module
//   3. System status derived from V2_SYSTEM_REGISTRY.mode
//
// This module owns clinical-recognition signals and source-span examples per
// system. It must NEVER include PI tables, CVC formulas, final percentages,
// or assess_* tool argument schemas — those belong to the deterministic
// engine, not the semantic layer.
//
// `semanticStatus` is computed at call time from the registry mode:
//   `legacy`            → "legacy_deferred"
//   `structured_shadow` → "structured_shadow"
//   `structured_live`   → "structured_supported"
// This guarantees a registry mode flip propagates to the prompt without any
// manual edit (REQ-SC-PROMPT-001 acceptance criterion).

import type {
  GatiodSystemKey,
  SemanticSystemStatus,
} from "./contracts.js";
import { V2_SYSTEM_REGISTRY } from "./systemRegistry.js";

export interface SemanticSystemTaxonomyEntry {
  system: GatiodSystemKey;
  displayName: string;
  /** Phrases or terms that strongly suggest this system. Used to tune the
   *  semantic interpreter's recognition without leaking calculation rules. */
  commonClinicalSignals: string[];
  /** Worked source-span examples — the model is shown these so its output's
   *  `sourceSpan` field stays anchored to actual quoted substrings. */
  exampleSourceSpans: string[];
  /** Calculation-critical fields the deterministic extractor will need; the
   *  semantic interpreter should populate `missingFields` when these are not
   *  stated in the source text. */
  commonMissingFields: string[];
}

/** Curated clinical knowledge for the semantic prompt. Keep this list short
 *  per system — the goal is recognition help, not exhaustive coverage. */
export const SEMANTIC_SYSTEM_TAXONOMY: Record<GatiodSystemKey, SemanticSystemTaxonomyEntry> = {
  upper_limb: {
    system: "upper_limb",
    displayName: "Upper Limb",
    commonClinicalSignals: [
      "shoulder", "elbow", "wrist", "hand", "thumb", "finger",
      "humerus", "radius", "ulna",
      "median nerve", "ulnar nerve", "radial nerve",
      "amputation", "ROM", "range of motion",
      "flexion", "extension", "abduction", "adduction",
      "internal rotation", "external rotation",
    ],
    exampleSourceSpans: [
      "Right humeral shaft fracture healed with severe angulation",
      "Left shoulder active flexion limited to 90 degrees",
      "Loss of right thumb - both phalanges",
    ],
    commonMissingFields: [
      "side (left/right)",
      "ROM direction (flexion/extension/abduction/etc.)",
      "joint identity",
      "amputation level",
      "DBE condition severity bracket",
    ],
  },
  lower_limb: {
    system: "lower_limb",
    displayName: "Lower Limb",
    commonClinicalSignals: [
      "hip", "knee", "ankle", "foot", "toe",
      "femur", "tibia", "fibula",
      "femoral nerve", "sciatic nerve", "common peroneal nerve",
      "tibial nerve", "obturator nerve",
      "leg shortening", "limb length discrepancy",
      "amputation", "ROM", "flexion", "extension",
    ],
    exampleSourceSpans: [
      "Left common peroneal nerve lesion with combined sensory and motor deficit",
      "Right knee flexion limited to 80 degrees",
      "Loss of left great toe - both phalanges",
    ],
    commonMissingFields: [
      "side (left/right)",
      "nerve loss type: partial or total",
      "ROM direction",
      "shortening cm",
      "toe vs metatarsal level",
    ],
  },
  spine: {
    system: "spine",
    displayName: "Spine",
    commonClinicalSignals: [
      "cervical", "thoraco-lumbar", "thoracic", "lumbar", "lumbo-sacral", "sacral",
      "fracture", "dislocation", "compression", "burst fracture",
      "prolapsed disc", "disc herniation", "degenerated disc",
      "ASIA grade", "spinal cord injury",
      "neurogenic bladder", "neurogenic bowel",
    ],
    exampleSourceSpans: [
      "Thoraco-lumbar compression/burst fracture <25% height loss with residual pain",
      "Lumbo-sacral prolapsed intervertebral disc with persistent pain, restricted motion and motor deficit",
      "Cervical spinal cord injury without fracture/dislocation with ASIA D motor deficit",
    ],
    commonMissingFields: [
      "spinal region (cervical/thoraco-lumbar/lumbo-sacral)",
      "diagnosis category",
      "fracture height loss percentage",
      "ASIA grade",
      "presence of motor or sensory deficit",
    ],
  },
  respiratory: {
    system: "respiratory",
    displayName: "Respiratory",
    commonClinicalSignals: [
      "FVC", "FEV1", "DLCO", "VO2 max",
      "occupational asthma", "asbestosis", "silicosis",
      "high-dose inhaled steroids", "bronchodilators",
      "PFT", "pulmonary function test",
    ],
    exampleSourceSpans: [
      "Occupational asthma requiring daily high-dose inhaled steroids",
      "FEV1 of 65% predicted with FVC of 75% predicted",
    ],
    commonMissingFields: [
      "PFT values (FEV1, FVC)",
      "diagnosis",
      "medication class",
      "occupational asthma prerequisite confirmation",
    ],
  },
  renal: {
    system: "renal",
    displayName: "Renal",
    commonClinicalSignals: [
      "CKD", "creatinine clearance", "serum creatinine",
      "dialysis", "solitary kidney", "renal dysfunction",
      "eGFR", "kidney function",
    ],
    exampleSourceSpans: [
      "CKD stage 4 with creatinine clearance of 25 mL/min",
      "Renal dysfunction within the 11-30% impairment class, selected value 20%",
    ],
    commonMissingFields: [
      "creatinine clearance value",
      "sex (for clinical-severity calculation)",
      "doctor-selected provisional award within bracket",
    ],
  },
  gastro_digestive: {
    system: "gastro_digestive",
    displayName: "Gastro / Digestive",
    commonClinicalSignals: [
      "upper digestive", "colorectal", "anal", "rectal",
      "liver", "biliary", "hepatic", "Child-Pugh",
      "hernia", "abdominal wall",
      "incontinence", "bowel resection",
    ],
    exampleSourceSpans: [
      "Recurrent abdominal wall hernia",
      "Liver dysfunction Child-Pugh class B",
    ],
    commonMissingFields: [
      "subsystem (upper digestive / colorectal / liver-biliary / hernia)",
      "doctor-selected PI% within bracket",
      "clinical justification",
    ],
  },
  hearing: {
    system: "hearing",
    displayName: "Hearing",
    commonClinicalSignals: [
      "AHL", "audiogram", "SNHL", "sensorineural hearing loss",
      "right ear", "left ear", "bilateral hearing",
      "noise-induced", "NID", "blast injury",
      "tinnitus",
    ],
    exampleSourceSpans: [
      "Right ear hearing loss AHL 90 dB after blast injury",
      "Bilateral noise-induced hearing loss with AHL 65 dB and tinnitus",
    ],
    commonMissingFields: [
      "pathway: injury vs noise-induced (NID)",
      "affected ear (left/right/bilateral)",
      "AHL value (dB)",
      "age (for NID adjustment)",
    ],
  },
  cns: {
    system: "cns",
    displayName: "Central Nervous System",
    commonClinicalSignals: [
      "anosmia", "olfactory nerve",
      "facial nerve", "trigeminal",
      "equilibrium", "vestibular",
      "swallowing", "dysphagia",
      "station and gait", "ataxia",
      "hemiplegia", "paraplegia", "quadriplegia",
      "seizure", "cognitive impairment", "dementia",
    ],
    exampleSourceSpans: [
      "Complete anosmia due to traumatic olfactory nerve injury",
      "Minimal equilibrium impairment requiring limitation only in hazardous surroundings",
    ],
    commonMissingFields: [
      "CNS section (A/B/C)",
      "Section B component identity",
      "specialist confirmation",
      "paralysis distribution",
    ],
  },
  visual: {
    system: "visual",
    displayName: "Visual",
    commonClinicalSignals: [
      "left eye", "right eye", "bilateral eye",
      "visual acuity", "best corrected visual acuity",
      "visual field", "scotoma",
      "diplopia", "double vision",
      "corneal scar", "cataract", "glaucoma",
      "legal blindness", "monocular",
    ],
    exampleSourceSpans: [
      "Left eye best corrected visual acuity 6/18",
      "Persistent diplopia with central scotoma",
      "Left corneal opacity/scar/decompensation arising from injury",
    ],
    commonMissingFields: [
      "affected eye (left/right/bilateral)",
      "acuity value",
      "visual field deficit",
      "diplopia zone",
    ],
  },
};

/** Map registry mode to semantic taxonomy status (REQ-SC-PROMPT-001). */
export function getSemanticSystemStatus(system: GatiodSystemKey): SemanticSystemStatus {
  const cap = V2_SYSTEM_REGISTRY[system];
  if (!cap) return "legacy_deferred";
  switch (cap.mode) {
    case "structured_live":
      return "structured_supported";
    case "structured_shadow":
      return "structured_shadow";
    case "legacy":
    default:
      return "legacy_deferred";
  }
}

/** Build the prompt taxonomy section from the registry-backed taxonomy. */
export function buildSemanticTaxonomyPromptSection(): string {
  const lines: string[] = ["Known GATIOD systems:"];
  // Iterate in deterministic order matching the system list elsewhere.
  const order: GatiodSystemKey[] = [
    "spine",
    "upper_limb",
    "lower_limb",
    "hearing",
    "visual",
    "respiratory",
    "renal",
    "gastro_digestive",
    "cns",
  ];
  for (const sys of order) {
    const entry = SEMANTIC_SYSTEM_TAXONOMY[sys];
    const status = getSemanticSystemStatus(sys);
    lines.push(`- ${sys} — ${entry.displayName} — ${status}`);
    lines.push(`  Clinical signals: ${entry.commonClinicalSignals.slice(0, 8).join(", ")}.`);
    lines.push(`  Example source span: "${entry.exampleSourceSpans[0]}".`);
    lines.push(`  Common missing fields: ${entry.commonMissingFields.join(", ")}.`);
  }
  return lines.join("\n");
}
