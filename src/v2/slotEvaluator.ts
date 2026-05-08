import type { GatiodSystemKey, NormalizedUtterance, SlotSignals } from "./contracts.js";

export interface MissingSlot {
  key: string;
  question: string;
  chips: string[];
}

// ---------------------------------------------------------------------------
// Signal extractors — pattern-based, one per SlotSignals key
// ---------------------------------------------------------------------------

type SignalKey = keyof SlotSignals;
type Extractor = (text: string) => boolean;

const HAS_DEGREE = /\b\d+\s*[°º]|\b\d+\s*degrees?\b/i;
const HAS_NON_ZERO_DEGREE = /\b[1-9]\d*\s*[°º]|\b[1-9]\d*\s*degrees?\b/i;
const HAS_SIDE = /\b(left|right|bilateral|both\s+sides?)\b/i;
const HAS_JOINT_UPPER = /\b(shoulder|elbow|wrist|thumb|finger|pip|dip|mcp)\b/i;
const HAS_JOINT_LOWER = /\b(hip|knee|ankle|subtalar|great\s*toe|hallux)\b/i;
const HAS_NERVE_UPPER = /\b(median|ulnar|radial|brachial\s+plexus?|suprascapular)\b/i;
const HAS_NERVE_LOWER = /\b(sciatic|peroneal|common\s+peroneal|femoral|tibial|sural)\b/i;
const HAS_NERVE_ANY = new RegExp(
  `(${HAS_NERVE_UPPER.source}|${HAS_NERVE_LOWER.source}|\\bnerve\\b)`, "i"
);
const HAS_AMPUTATION = /\b(amputat|disarticulation|below.?elbow|above.?elbow|below.?knee|above.?knee|trans.?humeral|trans.?radial|trans.?femoral|trans.?tibial|forequarter|hindquarter)\b/i;
const HAS_DBE = /\b(dbe|diagnosis.?based|avascular.?necrosis|avn|osteoarthritis|oa|instability|tenosynovitis|meniscus|acl|pcl|rotator.?cuff|tendon.?rupture|carpal.?tunnel|cts)\b/i;
const HAS_ROM = /\b(flexion|extension|abduction|adduction|rotation|pronation|supination|dorsiflexion|plantarflexion|eversion|inversion|restricted.?motion|ankylosis|rom)\b/i;

const SIGNAL_EXTRACTORS: Record<SignalKey, Extractor> = {
  // --- meta-signals ---
  rom_present: (t) => HAS_DEGREE.test(t) || HAS_ROM.test(t),
  nerve_present: (t) => HAS_NERVE_ANY.test(t) || /\b(sensory|motor|neuropathy|palsy|deficit)\b/i.test(t),
  amputation_present: (t) => HAS_AMPUTATION.test(t),
  dbe_present: (t) => HAS_DBE.test(t) || /\b(fracture|dislocation)\b/i.test(t),
  shortening_present: (t) => /\b(shortening|limb.?length|discrepancy|leg.?length)\b/i.test(t),
  spine_neuro_present: (t) => /\b(cord|cauda.?equina|myelopathy|paresis|paraplegia|quadriplegia|tetraplegia|asia|neurogenic)\b/i.test(t),
  tinnitus_mentioned: (t) => /\btinnitus\b/i.test(t),
  fracture_present: (t) => /\bfracture\b/i.test(t),
  disc_present: (t) => /\b(disc|disk|pivd|herniat|prolapse)\b/i.test(t),

  // --- slot satisfaction signals ---
  side: (t) => HAS_SIDE.test(t),

  // satisfied if any finding type detectable — guards the "what type?" question
  finding_type: (t) =>
    HAS_DEGREE.test(t) || HAS_ROM.test(t) ||
    HAS_NERVE_ANY.test(t) || HAS_AMPUTATION.test(t) || HAS_DBE.test(t) ||
    /\b(fracture|dislocation|shortening|discrepancy)\b/i.test(t),

  rom_joint: (t) => HAS_JOINT_UPPER.test(t) || HAS_JOINT_LOWER.test(t),
  rom_measurements: (t) => HAS_DEGREE.test(t),

  // non-zero angle implies restricted motion (satisfies the ankylosis_flag slot).
  // "ankylosed" uses prefix match (no trailing \b) because the word ends with 'ed'.
  ankylosis_flag: (t) =>
    HAS_NON_ZERO_DEGREE.test(t) ||
    /\b(ankylos|fixed\s+at|fused|restricted\s+motion|restricted\s+active)/i.test(t),

  // satisfied when nerve name AND deficit/loss type both present
  nerve_details: (t) =>
    HAS_NERVE_ANY.test(t) && /\b(sensory|motor|combined|total|partial)\b/i.test(t),

  rom_from_nerve: (t) =>
    /\b(independent|due\s+to\s+nerve|from\s+nerve|because\s+of\s+nerve|not\s+(from|related\s+to)\s+nerve)\b/i.test(t),

  // only satisfied by ontology lookup result, not utterance pattern
  dbe_condition: (_t) => false,

  // spine
  region: (t) => /\b(cervical|thorac|lumbar|lumbo.?sacral|c\d|t\d|l\d|s\d)\b/i.test(t),
  diagnosis_category: (t) =>
    /\b(fracture|dislocation|cord.?injury|cauda.?equina|disc|pivd|spondylolysis|spondylolisthesis|chronic.?pain|normal.?mri)\b/i.test(t),
  severity_key: (t) =>
    /\b(residual.?pain|radicular|sensory.?deficit|motor.?deficit|asia|paresis|pain.?syndrome)\b/i.test(t),
  fracture_height_loss: (t) => /\b(height.?loss|compression|burst|25\s*%|<\s*25|25\s*or\s*more)\b/i.test(t),
  asia_grade: (t) => /\b(asia\s*[a-e]|grade\s*[a-e])\b/i.test(t),
  monoparesis_gate: (t) => /\b(monopar|one\s+limb|single\s+limb|yes.*mono|no.*mono)\b/i.test(t),
  bladder_bowel: (t) => /\b(bladder|bowel|incontinence|neurogenic)\b/i.test(t),
  mri_status: (t) => /\b(mri|prolapsed?\s+disc|degenerat|normal\s+(scan|mri))\b/i.test(t),

  // lower limb
  toe_vs_shortening_gate: (t) =>
    /\b(toe|foot\s+amp|leg.?length|discrepancy|\d+(\.\d+)?\s*cm)\b/i.test(t),
  shortening_cm: (t) => /\b\d+(\.\d+)?\s*cm\b/i.test(t),

  // respiratory
  diagnosis: (t) => /\b(asthma|asbestosis|silicosis|respiratory|pulmonary|standard)\b/i.test(t),
  pft_values: (t) => /\b(fvc|fev1?|dlco|vo2|spirometry|\d+\s*%\s*(fvc|fev))\b/i.test(t),
  selected_pi_within_class: (t) =>
    /\b(select|choose|use|pick)\s+\d+\s*%\b/i.test(t) ||
    /\b\d+\s*%\s*(pi|selected|within)\b/i.test(t),
  asthma_prerequisites: (t) =>
    /\b(mainten|transfer|one\s+year|improvement\s+unlikely|prerequisite|all\s+yes|not\s+all)\b/i.test(t),
  asthma_medication: (t) =>
    /\b(bronchodilator|inhaled\s+steroid|oral\s+steroid|controller|preventer|salbutamol)\b/i.test(t),
  asbestosis_profusion: (t) => /\b(profusion|1\/1|radiolog)\b/i.test(t),

  // gastro
  subSystem: (t) => /\b(colon|rectal|anal|liver|biliary|colonic|hepatic)\b/i.test(t),
  selectedBracketIndex: (t) => /\b(mild|moderate|severe|bracket|class|category)\b/i.test(t),
  piPercent: (t) => /\b\d+\s*%\b/.test(t),
  clinicalJustification: (t) =>
    /\b(because|reason|due\s+to|justify|clinical\s+basis)\b/i.test(t),

  // hearing
  path: (t) => /\b(nid|noise.?induced|injury|occupational.?deafness|hearing.?loss|standard)\b/i.test(t),
  leftEarAhl: (t) =>
    (/\bleft\b/i.test(t) && /\b\d+\s*db\b/i.test(t)) ||
    /\b(left\s+(ear\s+)?ahl|ahl\s+left)\b/i.test(t),
  rightEarAhl: (t) =>
    (/\bright\b/i.test(t) && /\b\d+\s*db\b/i.test(t)) ||
    /\b(right\s+(ear\s+)?ahl|ahl\s+right)\b/i.test(t),
  age: (t) =>
    /\b\d{1,3}\s*(years?\s+old|yo|year.?old)\b/i.test(t) ||
    /\bage\s*[:\s]\s*\d{1,3}\b/i.test(t),
  affectedEars: (t) => /\b(both\s+ears|left\s+ear|right\s+ear|bilateral|unilateral)\b/i.test(t),
  tinnitus_gate: (t) =>
    /\b(tinnitus|ringing|no\s+tinnitus|tinnitus\s+only)\b/i.test(t),

  // CNS
  cns_section: (t) =>
    /\b(section\s*[abc]|epilepsy|dementia|psychiatric|cognitive|paraplegia|tetraplegia|brain.?injury|cerebral)\b/i.test(t),
  section_a_group: (t) =>
    /\b(group\s*\d|class\s*\d|mild|moderate|severe|psychi|epilep|dementia)\b/i.test(t),
  specialist_confirmation: (t) =>
    /\b(confirm|specialist|psychiatrist|neurologist|psychologist)\b/i.test(t),
  section_b_component: (t) =>
    /\b(bladder|bowel|sexual|spasms|pressure.?sore|component)\b/i.test(t),
  section_b_bracket: (t) =>
    /\b(mild|moderate|severe|intermittent|constant|complete)\b/i.test(t),
  paralysed_limbs: (t) =>
    /\b(one\s+limb|two\s+limbs|all\s+limbs|paraplegia|tetraplegia|monoplegia|hemiplegia)\b/i.test(t),

  // visual
  leftEye: (t) => /\b(left\s+eye|os\b|le\b|left\s+visual|va\s+left)\b/i.test(t),
  rightEye: (t) => /\b(right\s+eye|od\b|re\b|right\s+visual|va\s+right)\b/i.test(t),
  acuity: (t) => /\b(acuity|va\b|6\/|20\/|\d+\/\d+)\b/i.test(t),
  field: (t) =>
    /\b(visual.?field|vf\b|field.?defect|perimetry|hemianopia|quadrantanopia)\b/i.test(t),
  diplopiaId: (t) =>
    /\b(diplopia|double.?vision|monocular|binocular|no.?diplopia)\b/i.test(t),
  modifiers: (t) =>
    /\b(dominant|non.?dominant|enucleation|prosthetic)\b/i.test(t),

  // renal
  sex: (t) => /\b(male|female|man|woman|gender)\b/i.test(t),
  renal_inputs: (t) =>
    /\b(creatinine|gfr|egfr|kidney.?function|renal.?function|\d+\s*µmol|\d+\s*umol|\d+\s*ml\/min)\b/i.test(t),
  clinical_severity: (t) =>
    /\b(mild|moderate|severe|class\s*\d|stage\s*\d|grade\s*\d|ckd\s*\d)\b/i.test(t),
  solitary_kidney: (t) =>
    /\b(solitary|single\s+kidney|nephrectomy|one\s+kidney)\b/i.test(t),
  provisional_award: (t) =>
    /\b(provisional|stable|changing|improving|worsening|still\s+changing)\b/i.test(t),
};

export function extractSignals(utterance: NormalizedUtterance): Partial<SlotSignals> {
  const text = utterance.normalizedText;
  const result: Partial<SlotSignals> = {};
  for (const [key, extractor] of Object.entries(SIGNAL_EXTRACTORS) as [SignalKey, Extractor][]) {
    if (extractor(text)) result[key] = true;
  }
  return result;
}

// Signals are monotonic: once detected, they stay true across turns.
export function mergeSignals(
  existing: Partial<SlotSignals>,
  incoming: Partial<SlotSignals>
): Partial<SlotSignals> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming) as [SignalKey, boolean][]) {
    if (v) merged[k] = true;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Per-system slot definitions (mirrors gatiod_conversation_policy_data/policy/systems/)
// Excludes the "confirmation" slot — that's handled as a separate state.
// ---------------------------------------------------------------------------

interface SlotDefinition {
  key: string;
  requiredWhen: string;
  question: string;
  chips: string[];
}

const SYSTEM_SLOTS: Record<GatiodSystemKey, SlotDefinition[]> = {
  upper_limb: [
    {
      key: "side",
      requiredWhen: "always",
      question: "Which upper limb is affected — left or right?",
      chips: ["Left", "Right"],
    },
    {
      key: "finding_type",
      requiredWhen: "no_assessable_finding_detected",
      question: "What type of upper-limb finding should I assess: amputation, ROM restriction, nerve deficit, or diagnosis-based injury?",
      chips: ["ROM restriction", "Nerve deficit", "DBE injury", "Amputation"],
    },
    {
      key: "rom_joint",
      requiredWhen: "rom_present AND joint_missing",
      question: "Which joint is the ROM finding for — shoulder, elbow, wrist, thumb, or finger?",
      chips: ["Shoulder", "Elbow", "Wrist", "Finger"],
    },
    {
      key: "rom_measurements",
      requiredWhen: "rom_present AND measurements_missing",
      question: "What ROM direction and angle should I record? For example: shoulder flexion 90°, abduction 90°.",
      chips: ["Flexion 90°", "Abduction 90°", "Extension 45°", "Add multiple values"],
    },
    {
      key: "ankylosis_flag",
      requiredWhen: "rom_present AND fixed_position_unclear",
      question: "Is the joint ankylosed/fixed, or is this restricted active motion?",
      chips: ["Restricted motion", "Ankylosed/fixed"],
    },
    {
      key: "nerve_details",
      requiredWhen: "neurological_present AND nerve_or_deficit_missing",
      question: "Which nerve is affected, and is the deficit sensory, motor, or combined? Is it total or partial?",
      chips: ["Sensory partial", "Motor total", "Combined partial", "Combined total"],
    },
    {
      key: "rom_from_nerve",
      requiredWhen: "rom_present AND neurological_present",
      question: "Are the ROM restrictions due to the nerve lesion, or are they independent ROM findings?",
      chips: ["Independent ROM", "Due to nerve lesion"],
    },
  ],

  lower_limb: [
    {
      key: "side",
      requiredWhen: "always",
      question: "Which lower limb is affected — left or right?",
      chips: ["Left", "Right"],
    },
    {
      key: "finding_type",
      requiredWhen: "no_assessable_finding_detected",
      question: "What lower-limb finding should I assess: amputation, ROM restriction, nerve deficit, limb shortening, or diagnosis-based injury?",
      chips: ["ROM restriction", "DBE injury", "Amputation", "Shortening"],
    },
    {
      key: "toe_vs_shortening_gate",
      requiredWhen: "toe_amputation_or_shortening_ambiguous",
      question: "Is this a toe/foot amputation, or a measured leg-length discrepancy in centimetres?",
      chips: ["Toe/foot amputation", "Leg-length discrepancy"],
    },
    {
      key: "rom_joint",
      requiredWhen: "rom_present AND joint_missing",
      question: "Which joint is the ROM finding for — hip, knee, ankle, subtalar, or toe?",
      chips: ["Hip", "Knee", "Ankle", "Great toe"],
    },
    {
      key: "rom_measurements",
      requiredWhen: "rom_present AND measurements_missing",
      question: "What ROM direction and angle should I record?",
      chips: ["Knee flexion", "Hip flexion", "Ankle dorsiflexion"],
    },
    {
      key: "shortening_cm",
      requiredWhen: "shortening_present AND discrepancyCm_missing",
      question: "What is the measured limb length discrepancy in centimetres?",
      chips: ["1 cm", "2 cm", "3 cm", "No shortening"],
    },
    {
      key: "nerve_details",
      requiredWhen: "neurological_present AND nerve_or_deficit_missing",
      question: "Which lower-limb nerve is affected, and is the deficit sensory, motor, or combined? Is it total or partial?",
      chips: ["Sciatic", "Common peroneal", "Femoral", "Tibial"],
    },
    {
      key: "rom_from_nerve",
      requiredWhen: "rom_present AND neurological_present",
      question: "Are the ROM restrictions due to the nerve lesion, or are they independent ROM findings?",
      chips: ["Independent ROM", "Due to nerve lesion"],
    },
  ],

  spine: [
    {
      key: "region",
      requiredWhen: "always",
      question: "Which spinal region is being assessed — cervical, thoraco-lumbar, or lumbo-sacral?",
      chips: ["Cervical", "Thoraco-lumbar", "Lumbo-sacral"],
    },
    {
      key: "diagnosis_category",
      requiredWhen: "always",
      question: "Which spine pathway applies: fracture/dislocation, cord/cauda equina injury, intervertebral disc, spondylolysis/spondylolisthesis, or chronic pain with normal MRI?",
      chips: ["Fracture/dislocation", "Cord/cauda injury", "Disc injury", "Normal MRI pain"],
    },
    {
      key: "severity_key",
      requiredWhen: "diagnosis_category_present",
      question: "What is the applicable severity finding — residual pain, persistent radicular pain, sensory deficit, motor deficit, or ASIA grade?",
      chips: ["Residual pain", "Radicular pain", "Sensory deficit", "Motor deficit", "ASIA grade"],
    },
    {
      key: "fracture_height_loss",
      requiredWhen: "fracture_present AND height_loss_unclear",
      question: "For the compression or burst fracture, is height loss less than 25% or 25% or more?",
      chips: ["<25%", "≥25%"],
    },
    {
      key: "asia_grade",
      requiredWhen: "asia_or_paresis_present AND grade_missing",
      question: "What is the ASIA grade — A/B, C, or D?",
      chips: ["ASIA D", "ASIA C", "ASIA A/B"],
    },
    {
      key: "monoparesis_gate",
      requiredWhen: "asia_grade_present AND limb_distribution_unclear",
      question: "Is this monoparesis affecting one limb only?",
      chips: ["Yes, monoparesis", "No"],
    },
    {
      key: "bladder_bowel",
      requiredWhen: "spine_neuro_present AND bladder_not_yet_asked",
      question: "Is there neurogenic bladder or bowel incontinence? If yes, is it incomplete or complete?",
      chips: ["No bladder/bowel", "Incomplete bladder", "Complete bladder", "Bladder and bowel"],
    },
    {
      key: "mri_status",
      requiredWhen: "disc_or_chronic_pain_pathway",
      question: "What does the MRI show — prolapsed disc, degenerated disc with superimposed injury, or normal MRI?",
      chips: ["Prolapsed disc", "Degenerated + injury", "Normal MRI"],
    },
  ],

  respiratory: [
    {
      key: "diagnosis",
      requiredWhen: "always",
      question: "Is this a standard respiratory assessment, occupational asthma, or asbestosis/silicosis?",
      chips: ["Standard", "Occupational asthma", "Asbestosis/silicosis"],
    },
    {
      key: "pft_values",
      requiredWhen: "standard_pathway",
      question: "Please provide any available pulmonary function values: FVC%, FEV1%, DLCO%, or VO2 max.",
      chips: ["FVC/FEV1", "DLCO", "VO2 max"],
    },
    {
      key: "asthma_prerequisites",
      requiredWhen: "occupational_asthma_pathway",
      question: "For occupational asthma: does the worker require daily maintenance medication, has exposure transfer lasted at least one year, and is further improvement unlikely?",
      chips: ["All yes", "Not all met"],
    },
    {
      key: "asthma_medication",
      requiredWhen: "occupational_asthma_prerequisites_met",
      question: "What is the minimum medication required to maintain control?",
      chips: ["Bronchodilators", "Low-dose inhaled steroids", "High-dose/combination", "Oral steroids"],
    },
    {
      key: "asbestosis_profusion",
      requiredWhen: "asbestosis_silicosis_pathway",
      question: "Is the radiological profusion at least 1/1?",
      chips: ["At least 1/1", "Below 1/1"],
    },
  ],

  renal: [
    {
      key: "renal_inputs",
      requiredWhen: "always",
      question: "Please provide the renal function values: serum creatinine (µmol/L) or eGFR (mL/min), and the sex if using creatinine-based scoring.",
      chips: ["Provide creatinine + sex", "Provide eGFR"],
    },
    {
      key: "sex",
      requiredWhen: "serum_creatinine_used",
      question: "Is this patient male or female? (Required for creatinine-based renal scoring.)",
      chips: ["Male", "Female"],
    },
    {
      key: "clinical_severity",
      requiredWhen: "lab_values_absent_or_class_selection_needed",
      question: "What clinical severity class applies for the renal assessment?",
      chips: ["Mild", "Moderate", "Severe"],
    },
    {
      key: "solitary_kidney",
      requiredWhen: "renal_assessment_present",
      question: "Is this a solitary kidney (nephrectomy or single functioning kidney)?",
      chips: ["Yes, solitary kidney", "No"],
    },
    {
      key: "provisional_award",
      requiredWhen: "condition_still_changing_unclear",
      question: "Is the condition still changing (provisional award), or has it stabilised?",
      chips: ["Stable", "Still changing (provisional)"],
    },
  ],

  gastro_digestive: [
    {
      key: "subSystem",
      requiredWhen: "always",
      question: "Which gastro-digestive subsystem applies: colonic/rectal/anal, or liver/biliary?",
      chips: ["Colonic/rectal/anal", "Liver/biliary"],
    },
    {
      key: "selectedBracketIndex",
      requiredWhen: "subSystem_present AND bracket_missing",
      question: "Which severity bracket applies for this condition?",
      chips: ["Mild", "Moderate", "Severe"],
    },
    {
      key: "piPercent",
      requiredWhen: "bracket_range_selected",
      question: "Which PI% within the selected range should be used?",
      chips: ["Use minimum", "Use midpoint", "Use maximum"],
    },
    {
      key: "clinicalJustification",
      requiredWhen: "piPercent_selected",
      question: "Please provide a brief clinical justification for the selected PI% within the range.",
      chips: ["Mild presentation", "Moderate presentation", "Severe presentation"],
    },
  ],

  hearing: [
    {
      key: "path",
      requiredWhen: "always",
      question: "Is this a noise-induced deafness (NID) assessment or an injury/other hearing-loss assessment?",
      chips: ["Noise-induced (NID)", "Injury-related"],
    },
    {
      key: "leftEarAhl",
      requiredWhen: "path_present AND left_value_needed",
      question: "What is the Average Hearing Level (AHL) for the left ear in dB?",
      chips: ["Provide left AHL value"],
    },
    {
      key: "rightEarAhl",
      requiredWhen: "path_present AND right_value_needed",
      question: "What is the Average Hearing Level (AHL) for the right ear in dB?",
      chips: ["Provide right AHL value"],
    },
    {
      key: "age",
      requiredWhen: "nid_pathway",
      question: "What is the claimant's age? (Required for NID age-correction.)",
      chips: ["Provide age"],
    },
    {
      key: "affectedEars",
      requiredWhen: "injury_pathway",
      question: "Which ears are affected — left only, right only, or both?",
      chips: ["Left ear", "Right ear", "Both ears"],
    },
    {
      key: "tinnitus_gate",
      requiredWhen: "tinnitus_mentioned",
      question: "Is this a tinnitus-only assessment, or does tinnitus accompany a hearing loss finding?",
      chips: ["Tinnitus only", "Tinnitus + hearing loss"],
    },
  ],

  cns: [
    {
      key: "cns_section",
      requiredWhen: "always",
      question: "Which CNS section applies: Section A (epilepsy/dementia/psychiatric), Section B (neurological deficits), or Section C (paralysis)?",
      chips: ["Section A", "Section B", "Section C"],
    },
    {
      key: "section_a_group",
      requiredWhen: "section_a_present AND group_missing",
      question: "Which Section A group applies? (e.g., epilepsy group, dementia group, psychiatric group and severity class)",
      chips: ["Epilepsy", "Dementia", "Psychiatric"],
    },
    {
      key: "specialist_confirmation",
      requiredWhen: "group2_or_group4_present",
      question: "Has a specialist (psychiatrist, neurologist, or psychologist) confirmed the diagnosis and severity?",
      chips: ["Yes, specialist confirmed", "Not yet confirmed"],
    },
    {
      key: "section_b_component",
      requiredWhen: "section_b_present AND component_missing",
      question: "Which Section B neurological component applies: bladder, bowel, sexual function, spasms, or pressure sores?",
      chips: ["Bladder", "Bowel", "Sexual function", "Spasms"],
    },
    {
      key: "section_b_bracket",
      requiredWhen: "section_b_component_present AND bracket_missing",
      question: "What severity bracket applies for this Section B component?",
      chips: ["Mild/intermittent", "Moderate", "Severe/constant"],
    },
    {
      key: "paralysed_limbs",
      requiredWhen: "section_c_present AND limb_mapping_missing",
      question: "How many limbs are affected: one limb (monoplegia), two limbs (paraplegia/hemiplegia), or all four (tetraplegia)?",
      chips: ["One limb", "Two limbs (paraplegia)", "Two limbs (hemiplegia)", "All four (tetraplegia)"],
    },
  ],

  visual: [
    {
      key: "leftEye",
      requiredWhen: "always",
      question: "What is the visual acuity for the left eye (e.g., 6/6, 6/12, 6/60)?",
      chips: ["6/6", "6/12", "6/36", "6/60", "No light perception"],
    },
    {
      key: "rightEye",
      requiredWhen: "always",
      question: "What is the visual acuity for the right eye?",
      chips: ["6/6", "6/12", "6/36", "6/60", "No light perception"],
    },
    {
      key: "acuity",
      requiredWhen: "eye_present AND acuity_missing",
      question: "Please provide the corrected visual acuity for both eyes.",
      chips: ["Provide acuity values"],
    },
    {
      key: "field",
      requiredWhen: "eye_present AND field_missing",
      question: "Is there any visual field defect (e.g., hemianopia, quadrantanopia)? If none, state so.",
      chips: ["No field defect", "Hemianopia", "Quadrantanopia", "Other field loss"],
    },
    {
      key: "diplopiaId",
      requiredWhen: "always",
      question: "Is there diplopia (double vision)? If yes, is it monocular or binocular?",
      chips: ["No diplopia", "Monocular", "Binocular"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Condition evaluator — maps required_when strings to signal logic
// ---------------------------------------------------------------------------

function evaluateCondition(condition: string, s: Partial<SlotSignals>): boolean {
  switch (condition) {
    case "always":
      return true;
    case "no_assessable_finding_detected":
      return !s.rom_present && !s.nerve_present && !s.amputation_present && !s.dbe_present;
    case "rom_present AND joint_missing":
      return Boolean(s.rom_present) && !s.rom_joint;
    case "rom_present AND measurements_missing":
      return Boolean(s.rom_present) && !s.rom_measurements;
    case "rom_present AND fixed_position_unclear":
      return Boolean(s.rom_present) && !s.ankylosis_flag;
    case "neurological_present AND nerve_or_deficit_missing":
      return Boolean(s.nerve_present) && !s.nerve_details;
    case "rom_present AND neurological_present":
      return Boolean(s.rom_present) && Boolean(s.nerve_present) && !s.rom_from_nerve;
    case "dbe_present AND condition_unclear":
      return Boolean(s.dbe_present) && !s.dbe_condition;
    // spine
    case "diagnosis_category_present":
      return Boolean(s.diagnosis_category) && !s.severity_key;
    case "fracture_present AND height_loss_unclear":
      return Boolean(s.fracture_present) && !s.fracture_height_loss;
    case "asia_or_paresis_present AND grade_missing":
      return Boolean(s.spine_neuro_present) && !s.asia_grade;
    case "asia_grade_present AND limb_distribution_unclear":
      return Boolean(s.asia_grade) && !s.monoparesis_gate;
    case "spine_neuro_present AND bladder_not_yet_asked":
      return Boolean(s.spine_neuro_present) && !s.bladder_bowel;
    case "disc_or_chronic_pain_pathway":
      return Boolean(s.disc_present || s.diagnosis_category) && !s.mri_status;
    // lower limb
    case "toe_amputation_or_shortening_ambiguous":
      return Boolean(s.amputation_present) && !s.toe_vs_shortening_gate;
    case "shortening_present AND discrepancyCm_missing":
      return Boolean(s.shortening_present) && !s.shortening_cm;
    // respiratory
    case "standard_pathway":
      return Boolean(s.diagnosis) && !s.pft_values;
    case "occupational_asthma_pathway":
      return Boolean(s.diagnosis) && !s.asthma_prerequisites;
    case "occupational_asthma_prerequisites_met":
      return Boolean(s.asthma_prerequisites) && !s.asthma_medication;
    case "asbestosis_silicosis_pathway":
      return Boolean(s.diagnosis) && !s.asbestosis_profusion;
    // renal
    case "serum_creatinine_used":
      return Boolean(s.renal_inputs) && !s.sex;
    case "lab_values_absent_or_class_selection_needed":
      return Boolean(s.renal_inputs) && !s.clinical_severity;
    case "renal_assessment_present":
      return Boolean(s.renal_inputs) && !s.solitary_kidney;
    case "condition_still_changing_unclear":
      return Boolean(s.clinical_severity) && !s.provisional_award;
    case "class_range_detected":
      return Boolean(s.clinical_severity) && !s.selected_pi_within_class;
    // gastro
    case "subSystem_present AND bracket_missing":
      return Boolean(s.subSystem) && !s.selectedBracketIndex;
    case "bracket_range_selected":
      return Boolean(s.selectedBracketIndex) && !s.piPercent;
    case "piPercent_selected":
      return Boolean(s.piPercent) && !s.clinicalJustification;
    // hearing
    case "path_present AND left_value_needed":
      return Boolean(s.path) && !s.leftEarAhl;
    case "path_present AND right_value_needed":
      return Boolean(s.path) && !s.rightEarAhl;
    case "nid_pathway":
      return Boolean(s.path) && !s.age;
    case "injury_pathway":
      return Boolean(s.path) && !s.affectedEars;
    case "tinnitus_mentioned":
      return Boolean(s.tinnitus_mentioned) && !s.tinnitus_gate;
    // cns
    case "section_a_present AND group_missing":
      return Boolean(s.cns_section) && !s.section_a_group;
    case "group2_or_group4_present":
      return Boolean(s.section_a_group) && !s.specialist_confirmation;
    case "section_b_present AND component_missing":
      return Boolean(s.cns_section) && !s.section_b_component;
    case "section_b_component_present AND bracket_missing":
      return Boolean(s.section_b_component) && !s.section_b_bracket;
    case "section_c_present AND limb_mapping_missing":
      return Boolean(s.cns_section) && !s.paralysed_limbs;
    // visual
    case "eye_present AND acuity_missing":
      return (Boolean(s.leftEye) || Boolean(s.rightEye)) && !s.acuity;
    case "eye_present AND field_missing":
      return (Boolean(s.leftEye) || Boolean(s.rightEye)) && !s.field;
    // skip unknown conditions — don't block assessment
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Value extractor — pulls human-readable string values from utterances.
// These are stored in V2SystemState.extractedValues for use in confirmations.
// Values are OVERRIDING (not monotonic): a correction replaces the old value.
// ---------------------------------------------------------------------------

const ROM_DIRECTION_RE = /\b(flexion|extension|abduction|adduction|external?\s+rotation|internal?\s+rotation|pronation|supination|dorsiflexion|plantarflexion|eversion|inversion)\s+(\d+)\s*[°º]/gi;
const DEGREE_RE = /\b(\d+)\s*[°º]/g;

export function extractValues(utterance: NormalizedUtterance): Record<string, string> {
  const text = utterance.normalizedText;
  const values: Record<string, string> = {};

  // Side
  const sideMatch = /\b(left|right|bilateral)\b/i.exec(text);
  if (sideMatch) values.side = sideMatch[1].toLowerCase();

  // Joint
  const jointMatch = /\b(shoulder|elbow|wrist|thumb|index|middle|ring|little|hip|knee|ankle|subtalar|great\s*toe|hallux)\b/i.exec(text);
  if (jointMatch) values.rom_joint = jointMatch[1].toLowerCase();

  // ROM readings: "flexion 90°", "abduction 60°"
  const romPairs: string[] = [];
  let m: RegExpExecArray | null;
  const dirRe = new RegExp(ROM_DIRECTION_RE.source, "gi");
  while ((m = dirRe.exec(text)) !== null) {
    romPairs.push(`${m[1].toLowerCase()} ${m[2]}°`);
  }
  if (romPairs.length > 0) values.rom_readings = romPairs.join(", ");

  // Generic degree values when no direction keyword is present
  if (!values.rom_readings) {
    const degPairs: string[] = [];
    const degRe = new RegExp(DEGREE_RE.source, "g");
    while ((m = degRe.exec(text)) !== null) {
      degPairs.push(`${m[1]}°`);
    }
    if (degPairs.length > 0) values.degrees = degPairs.join(", ");
  }

  // Ankylosis type (inferred)
  if (/\b(ankylos|fixed\s+at|fused)/i.test(text)) {
    values.ankylosis_type = "ankylosed";
  } else if (HAS_NON_ZERO_DEGREE.test(text)) {
    values.ankylosis_type = "restricted motion";
  }

  // Nerve name
  const nerveMatch = /\b(median|ulnar|radial|brachial(?:\s+plexus)?|suprascapular|axillary|musculocutaneous|sciatic|common\s+peroneal|peroneal|femoral|tibial|sural)\b/i.exec(text);
  if (nerveMatch) values.nerve_name = nerveMatch[1].toLowerCase();

  // Deficit type
  const deficitMatch = /\b(sensory|motor|combined)\b/i.exec(text);
  if (deficitMatch) values.nerve_deficit = deficitMatch[1].toLowerCase();

  // Loss type
  const lossMatch = /\b(total|partial|complete)\b/i.exec(text);
  if (lossMatch) values.nerve_loss = lossMatch[1].toLowerCase();

  // Explicit negations (stored as "none" to show in confirmation)
  if (/\b(no|without|negative|absent)\s+(nerve|neurological|neuropathy)/i.test(text)) {
    values.nerve_present = "none";
  }
  if (/\b(no|without)\s+(amputation|amp)/i.test(text)) {
    values.amputation_present = "none";
  }
  if (/\b(no|without|negative)\s+(dbe|diagnosis.?based|fracture|instability)/i.test(text)) {
    values.dbe_present = "none";
  }
  if (/\bno\s+other\s+findings?\b/i.test(text)) {
    values.nerve_present = values.nerve_present ?? "none";
    values.amputation_present = values.amputation_present ?? "none";
    values.dbe_present = values.dbe_present ?? "none";
  }

  // rom_from_nerve
  if (/\b(independent|not\s+(from|due\s+to|related\s+to)\s+nerve)\b/i.test(text)) {
    values.rom_from_nerve = "independent";
  } else if (/\b(due\s+to\s+nerve|from\s+nerve|because\s+of\s+nerve|caused\s+by\s+nerve)\b/i.test(text)) {
    values.rom_from_nerve = "from nerve";
  }

  // Spine region
  const regionMatch = /\b(cervical|thorac(?:ic)?|lumbar|lumbo.?sacral|c\d|t\d|l\d)\b/i.exec(text);
  if (regionMatch) values.region = regionMatch[1].toLowerCase();

  // Spine diagnosis category
  const diagMatch = /\b(fracture|dislocation|cord\s+injury|cauda\s*equina|disc\s+(?:injury|herniation|prolapse)|spondylolysis|spondylolisthesis|chronic\s+pain)\b/i.exec(text);
  if (diagMatch) values.diagnosis_category = diagMatch[1].toLowerCase();

  // Shortening in cm
  const cmMatch = /\b(\d+(?:\.\d+)?)\s*cm\b/i.exec(text);
  if (cmMatch) values.shortening_cm = `${cmMatch[1]} cm`;

  // ASIA grade
  const asiaMatch = /\basia\s*([a-e])\b/i.exec(text);
  if (asiaMatch) values.asia_grade = `ASIA ${asiaMatch[1].toUpperCase()}`;

  return values;
}

export function getMissingSlots(
  system: GatiodSystemKey,
  signals: Partial<SlotSignals>
): MissingSlot[] {
  const defs = SYSTEM_SLOTS[system];
  if (!defs) return [];

  const missing: MissingSlot[] = [];
  for (const slot of defs) {
    // Skip if signal for this slot key is already satisfied
    if (signals[slot.key as keyof SlotSignals]) continue;
    // Skip if the slot's condition is not currently active
    if (!evaluateCondition(slot.requiredWhen, signals)) continue;
    missing.push({ key: slot.key, question: slot.question, chips: slot.chips });
  }
  return missing;
}
