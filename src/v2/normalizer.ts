import type { NormalizedToken, NormalizedUtterance } from "./contracts.js";

const TERM_NORMALISATIONS: Array<{
  pattern: RegExp;
  normalized: string;
  category: Exclude<NormalizedToken["category"], "raw">;
}> = [
  // Upper limb
  { pattern: /\bcts\b/gi, normalized: "carpal tunnel syndrome", category: "abbreviation" },
  { pattern: /\bavn\b/gi, normalized: "avascular necrosis", category: "abbreviation" },
  // Generic
  { pattern: /\brom\b/gi, normalized: "range of motion", category: "abbreviation" },
  { pattern: /\bcvc\b/gi, normalized: "combined values chart", category: "abbreviation" },
  // Respiratory
  { pattern: /\bfev\s*1\b/gi, normalized: "fev1", category: "synonym" },
  // NOTE: keep abbreviations as-is. Multi-word expansions (e.g. AHL → "average
  // hearing level") break extractor regexes that expect "AHL <digits>" or
  // "CKD stage". The synonym table already handles routing for these tokens.
  // Spine
  { pattern: /\blumbo[-\s]?sacral\b/gi, normalized: "lumbo sacral", category: "synonym" },
  { pattern: /\bthoraco[-\s]?lumbar\b/gi, normalized: "thoraco lumbar", category: "synonym" },
  { pattern: /\bintervert(e|i)bral\b/gi, normalized: "intervertebral", category: "spelling" },
  // Spelling
  { pattern: /\bnecrosos\b/gi, normalized: "necrosis", category: "spelling" },
  { pattern: /\bfractr?ure\b/gi, normalized: "fracture", category: "spelling" },
  { pattern: /\bmot?r\s+def(ic)?it\b/gi, normalized: "motor deficit", category: "synonym" },
  { pattern: /\bsens(or)?y\s+def(ic)?it\b/gi, normalized: "sensory deficit", category: "synonym" },
];

const STOPWORDS = new Set([
  "the", "and", "or", "to", "for", "of", "a", "an", "is", "are", "was", "were", "with", "without", "on",
  "in", "at", "by", "from", "this", "that", "it", "be", "as", "if", "then", "than", "we", "i", "you",
  "road", "traffic", "accident", "while", "working", "work", "during", "after", "before",
]);

const KNOWN_CLINICAL_TOKENS = new Set([
  // Core
  "upper", "lower", "limb", "spine", "respiratory", "renal", "gastro", "digestive", "hearing", "cns", "visual",
  "fracture", "dislocation", "intervertebral", "disc", "neurological", "nerve", "sensory", "motor", "combined",
  "partial", "total", "amputation", "shortening", "avascular", "necrosis", "femoral", "hip", "knee", "ankle",
  "confirm", "confirmed", "proceed", "calculate", "assessment", "global", "chart", "pain", "persistent",
  "restricted", "motion", "deficit", "lumbo", "sacral", "radicular", "oa", "osteoarthritis", "carpal", "tunnel",
  "syndrome", "range", "prolapsed", "head",
  // Spine
  "lumbar", "vertebral", "vertebra", "spondyl", "spondylosis", "spondylolisthesis", "myelopathy", "stenosis",
  "radiculopathy", "thoracic", "thoraco", "cervical", "compression", "burst", "cauda", "equina", "spinal",
  // Slice-16 — spinal cord injury complications and degenerated-disc terms.
  "neurogenic", "bladder", "degenerated", "degenerating", "discomfort", "acceptable", "superimposed",
  // Respiratory
  "pulmonary", "lung", "spirometry", "fvc", "fev1", "dlco", "vo2", "asthma", "copd", "dyspnoea", "dyspnea",
  "breathlessness", "obstructive", "restrictive", "asbestosis", "bronchial", "pneumoconiosis",
  // Slice-14 — respiratory medication and exposure terms surfaced as
  // "missing terms" for occupational asthma rows in the workbook.
  "bronchodilator", "bronchodilators", "inhaled", "inhaler", "nebulizer", "nebuliser",
  "steroid", "steroids", "occupational", "asbestos", "profusion", "exposure", "exposed",
  // Renal
  "kidney", "creatinine", "ckd", "nephrotic", "nephrology", "nephritis", "proteinuria", "egfr", "glomerular",
  "dialysis", "solitary", "clearance",
  // Gastro
  "gastric", "liver", "hepatic", "hepatitis", "cirrhosis", "biliary", "hepatobiliary", "pancreas", "pancreatic",
  "bowel", "colitis", "colostomy", "ileostomy", "esophageal", "oesophageal", "intestinal", "stomach", "hernia",
  "herniation",
  // Slice-13/14 — colorectal and abdominal terms (router synonyms added too).
  "colon", "colonic", "colorectal", "rectum", "rectal", "anus", "anal", "faecal", "fecal",
  "abdominal", "abdomen", "incontinence",
  // Hearing
  "audiogram", "audiological", "ahl", "ear", "tinnitus", "snhl", "deafness", "deaf", "sensorineural", "conductive",
  "cochlear", "auditory", "pta", "nid", "nihl",
  // CNS
  "brain", "cerebral", "cerebrovascular", "cva", "stroke", "hemiplegia", "hemiparesis", "paraplegia", "quadriplegia",
  "tetraplegia", "epilepsy", "seizure", "seizures", "cognitive", "neuropsychological", "neuropsych", "spastic",
  "dementia", "parkinson", "ataxia", "cerebellar", "tbi",
  // Visual
  "vision", "eye", "ocular", "ophthalmic", "ophthalmology", "retina", "retinal", "retinopathy", "glaucoma",
  "cataract", "cornea", "macular", "optic", "diplopia", "ptosis", "strabismus", "blindness", "acuity",
  // Limb extras
  "shoulder", "elbow", "wrist", "thumb", "finger", "hand", "arm", "forearm", "humerus", "radius", "ulna", "ulnar",
  "median", "metacarpal", "phalanx", "brachial", "suprascapular", "rotator", "cuff",
  "femur", "tibia", "fibula", "patella", "calcaneus", "metatarsal", "leg", "thigh", "foot", "toe", "meniscus",
  // Slice-18 — limb ROM/anatomical vocab. Workbook rows like "Right shoulder
  // active flexion from neutral / arc of active flexion: 140°" had nine
  // words flagged as "missing terms" (right, active, flexion, neutral, arc,
  // ankylosed, abduction, rotation, etc.), dragging routing confidence
  // below the assessment threshold even though "shoulder" matched cleanly.
  "left", "right", "active", "passive", "flexion", "extension", "abduction", "adduction",
  "rotation", "internal", "external", "supination", "pronation", "eversion", "inversion",
  "dorsiflexion", "plantarflexion", "ankylosed", "ankylosis", "neutral", "arc", "position",
  "function", "phalanges", "phalangeal", "interphalangeal", "metacarpophalangeal",
  "metatarsophalangeal", "dip", "pip", "mp", "ip", "mtp", "ddi", "mcp",
  "hip", "ankle", "knee", "midforearm", "midfoot", "forefoot", "hindfoot", "subtalar",
  "displaced", "undisplaced", "calcaneocuboid", "talocalcaneal", "talonavicular",
  "discrepancy", "shortening",
  // Slice-26 — additional limb anatomical/clinical terms surfaced by the
  // workbook's DBE rows.
  "patellofemoral", "tibiofemoral", "tibiotalar", "talofibular", "deltoid",
  "post-traumatic", "intra-articular", "pelvic", "pelvis", "sacrum", "sacroiliac",
  "metatarsal", "angulation", "comminuted", "subluxation",
  "acl", "pcl",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_/-]+/g, " ")
    // Slice-30 — also split on `/` so workbook prefixes like
    // "Ankle/subtalar:" tokenize as ["ankle", "subtalar"] rather than
    // staying as one unrecognized "ankle/subtalar" token. Hyphens
    // inside tokens (e.g. "low-dose") stay as part of the token.
    .split(/[/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function normalizeClinicalUtterance(raw: string): NormalizedUtterance {
  let normalizedText = raw;
  const mappedTokens: NormalizedToken[] = [];

  for (const rule of TERM_NORMALISATIONS) {
    normalizedText = normalizedText.replace(rule.pattern, (matched) => {
      mappedTokens.push({ original: matched, normalized: rule.normalized, category: rule.category });
      return rule.normalized;
    });
  }

  const tokens = tokenise(normalizedText);
  const unresolvedTerms = tokens.filter((token) => {
    if (STOPWORDS.has(token)) return false;
    if (token.length <= 2) return false;
    if (KNOWN_CLINICAL_TOKENS.has(token)) return false;
    if (/^\d+$/.test(token)) return false;
    return /[a-z]/.test(token);
  }).slice(0, 6);

  const mappingBoost = Math.min(mappedTokens.length * 0.04, 0.2);
  const clinicalSignalBoost = tokens.some((t) => KNOWN_CLINICAL_TOKENS.has(t)) ? 0.08 : 0;
  const unresolvedPenalty = Math.min(unresolvedTerms.length * 0.03, 0.18);
  const confidence = Math.max(0.3, Math.min(0.98, 0.82 + mappingBoost + clinicalSignalBoost - unresolvedPenalty));

  return {
    raw,
    normalizedText,
    tokens,
    mappedTokens,
    unresolvedTerms,
    confidence,
  };
}
