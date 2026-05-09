import type { GatiodSystemKey } from "./contracts.js";

export interface SystemSynonym {
  term: string;
  system: GatiodSystemKey;
  confidence: number;
  /** When true, router treats as soft match suitable for "did you mean?" confirmation. */
  requiresConfirmation?: boolean;
  notes?: string;
}

export interface SimilarTermCandidate {
  term: string;
  system: GatiodSystemKey;
  confidence: number;
  reason: string;
}

export const SYSTEM_SYNONYMS: SystemSynonym[] = [
  // ── Upper limb ───────────────────────────────────────────────────────────
  { term: "upper", system: "upper_limb", confidence: 0.85 },
  { term: "upper limb", system: "upper_limb", confidence: 1.0 },
  { term: "shoulder", system: "upper_limb", confidence: 1.0 },
  { term: "elbow", system: "upper_limb", confidence: 1.0 },
  { term: "wrist", system: "upper_limb", confidence: 1.0 },
  { term: "thumb", system: "upper_limb", confidence: 1.0 },
  { term: "finger", system: "upper_limb", confidence: 1.0 },
  { term: "hand", system: "upper_limb", confidence: 0.95 },
  { term: "arm", system: "upper_limb", confidence: 0.9 },
  { term: "forearm", system: "upper_limb", confidence: 1.0 },
  { term: "humerus", system: "upper_limb", confidence: 1.0 },
  { term: "radius", system: "upper_limb", confidence: 0.9 },
  { term: "ulna", system: "upper_limb", confidence: 1.0 },
  { term: "ulnar", system: "upper_limb", confidence: 1.0 },
  { term: "median", system: "upper_limb", confidence: 0.85, notes: "median nerve — upper limb context typical" },
  { term: "carpal", system: "upper_limb", confidence: 0.95 },
  { term: "metacarpal", system: "upper_limb", confidence: 1.0 },
  { term: "phalanx", system: "upper_limb", confidence: 0.7, requiresConfirmation: true, notes: "phalanges exist in fingers and toes" },
  { term: "brachial", system: "upper_limb", confidence: 1.0 },
  { term: "suprascapular", system: "upper_limb", confidence: 1.0 },
  { term: "rotator cuff", system: "upper_limb", confidence: 1.0 },
  { term: "cts", system: "upper_limb", confidence: 1.0, notes: "carpal tunnel syndrome" },

  // ── Lower limb ──────────────────────────────────────────────────────────
  { term: "lower limb", system: "lower_limb", confidence: 1.0 },
  { term: "hip", system: "lower_limb", confidence: 1.0 },
  { term: "knee", system: "lower_limb", confidence: 1.0 },
  { term: "ankle", system: "lower_limb", confidence: 1.0 },
  { term: "toe", system: "lower_limb", confidence: 1.0 },
  { term: "femoral", system: "lower_limb", confidence: 1.0 },
  { term: "femur", system: "lower_limb", confidence: 1.0 },
  { term: "tibia", system: "lower_limb", confidence: 1.0 },
  { term: "fibula", system: "lower_limb", confidence: 1.0 },
  { term: "patella", system: "lower_limb", confidence: 1.0 },
  { term: "calcaneus", system: "lower_limb", confidence: 1.0 },
  { term: "metatarsal", system: "lower_limb", confidence: 1.0 },
  { term: "leg", system: "lower_limb", confidence: 0.9 },
  { term: "thigh", system: "lower_limb", confidence: 1.0 },
  { term: "foot", system: "lower_limb", confidence: 0.9 },
  { term: "shortening", system: "lower_limb", confidence: 1.0 },
  { term: "meniscus", system: "lower_limb", confidence: 1.0 },
  { term: "acl", system: "lower_limb", confidence: 0.95 },
  { term: "pcl", system: "lower_limb", confidence: 0.95 },

  // ── Spine ──────────────────────────────────────────────────────────────
  { term: "spine", system: "spine", confidence: 1.0 },
  { term: "spinal", system: "spine", confidence: 1.0 },
  { term: "lumbar", system: "spine", confidence: 1.0 },
  { term: "lumbo", system: "spine", confidence: 1.0 },
  { term: "sacral", system: "spine", confidence: 1.0 },
  { term: "lumbo sacral", system: "spine", confidence: 1.0 },
  { term: "lumbosacral", system: "spine", confidence: 1.0 },
  // Slice-34/35 — `lumbosacral plexus` is a lower-limb peripheral nerve.
  // Match the post-normalization form ("lumbo sacral plexus") since the
  // normalizer rewrites "lumbosacral" → "lumbo sacral" with a space.
  // Slice-35's containment-suppression then drops the spine matches for
  // "lumbo", "sacral", "lumbo sacral" when this phrase is present.
  { term: "lumbo sacral plexus", system: "lower_limb", confidence: 1.0 },
  { term: "cervical", system: "spine", confidence: 1.0 },
  { term: "thoracic", system: "spine", confidence: 1.0 },
  { term: "thoraco", system: "spine", confidence: 1.0 },
  { term: "thoraco lumbar", system: "spine", confidence: 1.0 },
  { term: "vertebral", system: "spine", confidence: 1.0 },
  { term: "vertebra", system: "spine", confidence: 1.0 },
  { term: "disc", system: "spine", confidence: 0.95 },
  { term: "intervertebral", system: "spine", confidence: 1.0 },
  { term: "prolapse", system: "spine", confidence: 0.85, notes: "most often disc prolapse" },
  { term: "prolapsed", system: "spine", confidence: 0.85 },
  { term: "spondyl", system: "spine", confidence: 1.0 },
  { term: "spondylosis", system: "spine", confidence: 1.0 },
  { term: "spondylolisthesis", system: "spine", confidence: 1.0 },
  { term: "spondylolysis", system: "spine", confidence: 1.0 },
  { term: "myelopathy", system: "spine", confidence: 1.0 },
  { term: "stenosis", system: "spine", confidence: 0.7, requiresConfirmation: true, notes: "spinal stenosis common but term is not exclusive" },
  { term: "radicular", system: "spine", confidence: 1.0 },
  { term: "radiculopathy", system: "spine", confidence: 1.0 },
  { term: "cauda equina", system: "spine", confidence: 1.0 },
  { term: "compression fracture", system: "spine", confidence: 1.0 },
  { term: "burst fracture", system: "spine", confidence: 1.0 },
  // Slice-16 — neurogenic bladder/bowel is a spinal cord injury
  // complication. Without these signals the row "Neurogenic bladder/bowel:
  // Complete incontinence..." was being routed to gastro_digestive (which
  // matched "bowel" and the slice-13 "incontinence" synonym).
  { term: "neurogenic", system: "spine", confidence: 1.0 },
  { term: "neurogenic bladder", system: "spine", confidence: 1.0 },
  { term: "neurogenic bowel", system: "spine", confidence: 1.0 },

  // ── Respiratory ─────────────────────────────────────────────────────────
  { term: "respiratory", system: "respiratory", confidence: 1.0 },
  { term: "pulmonary", system: "respiratory", confidence: 1.0 },
  { term: "lung", system: "respiratory", confidence: 1.0 },
  { term: "spirometry", system: "respiratory", confidence: 1.0 },
  { term: "fvc", system: "respiratory", confidence: 1.0 },
  { term: "fev1", system: "respiratory", confidence: 1.0 },
  { term: "dlco", system: "respiratory", confidence: 1.0 },
  { term: "vo2", system: "respiratory", confidence: 1.0 },
  { term: "asthma", system: "respiratory", confidence: 1.0 },
  { term: "copd", system: "respiratory", confidence: 1.0 },
  { term: "dyspnoea", system: "respiratory", confidence: 1.0 },
  { term: "dyspnea", system: "respiratory", confidence: 1.0 },
  { term: "breathlessness", system: "respiratory", confidence: 0.95 },
  { term: "obstructive", system: "respiratory", confidence: 0.8, requiresConfirmation: true, notes: "could be airways or vascular" },
  { term: "restrictive", system: "respiratory", confidence: 0.8, requiresConfirmation: true },
  { term: "asbestosis", system: "respiratory", confidence: 1.0 },
  { term: "bronchial", system: "respiratory", confidence: 0.95 },
  { term: "pneumoconiosis", system: "respiratory", confidence: 1.0 },
  // Slice-14 — workbook rows for occupational asthma reference medication
  // classes that the router didn't recognize, dropping confidence below the
  // assessment threshold even though "asthma" was matched. These are all
  // respiratory medication or exposure terms when used in a respiratory
  // context (which "asthma" or "respiratory" co-occurrence anchors).
  { term: "bronchodilator", system: "respiratory", confidence: 0.95 },
  { term: "bronchodilators", system: "respiratory", confidence: 0.95 },
  { term: "inhaler", system: "respiratory", confidence: 0.95 },
  { term: "inhaled", system: "respiratory", confidence: 0.85, notes: "respiratory context (inhaled steroids/bronchodilators)" },
  { term: "nebulizer", system: "respiratory", confidence: 0.95 },
  { term: "nebuliser", system: "respiratory", confidence: 0.95 },
  // "occupational" alone is ambiguous (could be CTS, asbestosis, NID),
  // but in the workbook's respiratory rows it's nearly always paired with
  // asthma / asbestos / exposure. Lower confidence so it boosts but
  // doesn't dominate.
  { term: "occupational", system: "respiratory", confidence: 0.6, requiresConfirmation: true, notes: "ambiguous; needs co-occurring respiratory term" },
  { term: "asbestos", system: "respiratory", confidence: 0.95 },
  { term: "profusion", system: "respiratory", confidence: 0.9, notes: "asbestosis profusion grading" },

  // ── Renal ──────────────────────────────────────────────────────────────
  { term: "renal", system: "renal", confidence: 1.0 },
  { term: "kidney", system: "renal", confidence: 1.0 },
  { term: "creatinine", system: "renal", confidence: 1.0 },
  { term: "ckd", system: "renal", confidence: 1.0 },
  { term: "nephrotic", system: "renal", confidence: 1.0 },
  { term: "nephrology", system: "renal", confidence: 1.0 },
  { term: "nephritis", system: "renal", confidence: 1.0 },
  { term: "proteinuria", system: "renal", confidence: 1.0 },
  { term: "egfr", system: "renal", confidence: 1.0 },
  { term: "glomerular", system: "renal", confidence: 1.0 },
  { term: "dialysis", system: "renal", confidence: 1.0 },
  { term: "solitary kidney", system: "renal", confidence: 1.0 },
  { term: "creatinine clearance", system: "renal", confidence: 1.0 },

  // ── Gastro / digestive ─────────────────────────────────────────────────
  { term: "gastro", system: "gastro_digestive", confidence: 1.0 },
  { term: "gastric", system: "gastro_digestive", confidence: 1.0 },
  { term: "digestive", system: "gastro_digestive", confidence: 1.0 },
  { term: "liver", system: "gastro_digestive", confidence: 1.0 },
  { term: "hepatic", system: "gastro_digestive", confidence: 1.0 },
  { term: "hepatitis", system: "gastro_digestive", confidence: 1.0 },
  { term: "cirrhosis", system: "gastro_digestive", confidence: 1.0 },
  { term: "biliary", system: "gastro_digestive", confidence: 1.0 },
  { term: "hepatobiliary", system: "gastro_digestive", confidence: 1.0 },
  { term: "pancreas", system: "gastro_digestive", confidence: 1.0 },
  { term: "pancreatic", system: "gastro_digestive", confidence: 1.0 },
  { term: "bowel", system: "gastro_digestive", confidence: 1.0 },
  { term: "colitis", system: "gastro_digestive", confidence: 1.0 },
  { term: "colostomy", system: "gastro_digestive", confidence: 1.0 },
  { term: "ileostomy", system: "gastro_digestive", confidence: 1.0 },
  { term: "esophageal", system: "gastro_digestive", confidence: 1.0 },
  { term: "oesophageal", system: "gastro_digestive", confidence: 1.0 },
  { term: "intestinal", system: "gastro_digestive", confidence: 0.95 },
  { term: "stomach", system: "gastro_digestive", confidence: 0.95 },
  { term: "hernia", system: "gastro_digestive", confidence: 0.85, notes: "abdominal hernia is gastro; disc herniation is spine" },
  { term: "herniation", system: "gastro_digestive", confidence: 0.6, requiresConfirmation: true, notes: "could be disc (spine) or abdominal (gastro)" },
  // Lower GI / colorectal — added after the slice-11 calibration showed
  // workbook rows starting "Colon and rectum:", "Anus:" misrouting to spine
  // and upper_limb. These are clear gastro signals.
  { term: "colon", system: "gastro_digestive", confidence: 1.0 },
  { term: "colonic", system: "gastro_digestive", confidence: 1.0 },
  { term: "colorectal", system: "gastro_digestive", confidence: 1.0 },
  { term: "rectum", system: "gastro_digestive", confidence: 1.0 },
  { term: "rectal", system: "gastro_digestive", confidence: 1.0 },
  { term: "anus", system: "gastro_digestive", confidence: 1.0 },
  { term: "anal", system: "gastro_digestive", confidence: 0.9, notes: "anal canal/disease is gastro; anal fissure usually too" },
  { term: "faecal", system: "gastro_digestive", confidence: 1.0 },
  { term: "fecal", system: "gastro_digestive", confidence: 1.0 },
  // "abdominal" alone is gastro most of the time but can refer to abdominal
  // wall trauma broadly — kept lower confidence than core organ terms.
  { term: "abdominal", system: "gastro_digestive", confidence: 0.85, notes: "abdominal wall hernia and abdominal organ disease both route here" },
  { term: "abdomen", system: "gastro_digestive", confidence: 0.85 },

  // ── Hearing ─────────────────────────────────────────────────────────────
  { term: "hearing", system: "hearing", confidence: 1.0 },
  { term: "audiogram", system: "hearing", confidence: 1.0 },
  { term: "audiological", system: "hearing", confidence: 1.0 },
  { term: "ahl", system: "hearing", confidence: 1.0 },
  { term: "ear", system: "hearing", confidence: 0.95 },
  { term: "tinnitus", system: "hearing", confidence: 1.0 },
  { term: "snhl", system: "hearing", confidence: 1.0, notes: "sensorineural hearing loss" },
  { term: "deafness", system: "hearing", confidence: 1.0 },
  { term: "deaf", system: "hearing", confidence: 0.9 },
  { term: "sensorineural", system: "hearing", confidence: 1.0 },
  { term: "conductive", system: "hearing", confidence: 0.85, notes: "usually conductive hearing loss" },
  { term: "cochlear", system: "hearing", confidence: 1.0 },
  { term: "auditory", system: "hearing", confidence: 0.95 },
  { term: "pure tone", system: "hearing", confidence: 1.0 },
  { term: "pta", system: "hearing", confidence: 0.95, notes: "pure tone average" },
  { term: "nid", system: "hearing", confidence: 1.0, notes: "noise-induced deafness" },

  // ── CNS ────────────────────────────────────────────────────────────────
  { term: "cns", system: "cns", confidence: 1.0 },
  { term: "brain", system: "cns", confidence: 1.0 },
  { term: "cerebral", system: "cns", confidence: 1.0 },
  { term: "cerebrovascular", system: "cns", confidence: 1.0 },
  { term: "cva", system: "cns", confidence: 1.0, notes: "cerebrovascular accident" },
  { term: "stroke", system: "cns", confidence: 1.0 },
  { term: "hemiplegia", system: "cns", confidence: 1.0 },
  { term: "hemiparesis", system: "cns", confidence: 1.0 },
  { term: "paraplegia", system: "cns", confidence: 0.8, requiresConfirmation: true, notes: "could be spinal cord injury (spine) too" },
  { term: "quadriplegia", system: "cns", confidence: 0.85, requiresConfirmation: true },
  { term: "tetraplegia", system: "cns", confidence: 0.85, requiresConfirmation: true },
  { term: "epilepsy", system: "cns", confidence: 1.0 },
  { term: "seizure", system: "cns", confidence: 1.0 },
  { term: "seizures", system: "cns", confidence: 1.0 },
  { term: "cognitive", system: "cns", confidence: 1.0 },
  { term: "neuropsychological", system: "cns", confidence: 1.0 },
  { term: "neuropsych", system: "cns", confidence: 1.0 },
  { term: "spastic", system: "cns", confidence: 1.0 },
  { term: "dementia", system: "cns", confidence: 1.0 },
  { term: "parkinson", system: "cns", confidence: 1.0 },
  { term: "ataxia", system: "cns", confidence: 1.0 },
  { term: "cerebellar", system: "cns", confidence: 1.0 },
  { term: "tbi", system: "cns", confidence: 1.0, notes: "traumatic brain injury" },

  // ── Visual ─────────────────────────────────────────────────────────────
  { term: "visual", system: "visual", confidence: 1.0 },
  { term: "vision", system: "visual", confidence: 1.0 },
  { term: "eye", system: "visual", confidence: 1.0 },
  { term: "ocular", system: "visual", confidence: 1.0 },
  { term: "ophthalmic", system: "visual", confidence: 1.0 },
  { term: "ophthalmology", system: "visual", confidence: 1.0 },
  { term: "retina", system: "visual", confidence: 1.0 },
  { term: "retinal", system: "visual", confidence: 1.0 },
  { term: "retinopathy", system: "visual", confidence: 1.0 },
  { term: "glaucoma", system: "visual", confidence: 1.0 },
  { term: "cataract", system: "visual", confidence: 1.0 },
  { term: "cornea", system: "visual", confidence: 1.0 },
  { term: "macular", system: "visual", confidence: 1.0 },
  { term: "optic", system: "visual", confidence: 0.85 },
  { term: "diplopia", system: "visual", confidence: 1.0 },
  { term: "ptosis", system: "visual", confidence: 0.9 },
  { term: "strabismus", system: "visual", confidence: 1.0 },
  { term: "blindness", system: "visual", confidence: 1.0 },
  { term: "acuity", system: "visual", confidence: 0.95 },
];

// ── Indexes & helpers ──────────────────────────────────────────────────────

const TERM_INDEX = new Map<string, SystemSynonym[]>();
for (const syn of SYSTEM_SYNONYMS) {
  const arr = TERM_INDEX.get(syn.term) ?? [];
  arr.push(syn);
  TERM_INDEX.set(syn.term, arr);
}

const SINGLE_WORD_TERMS: SystemSynonym[] = SYSTEM_SYNONYMS.filter((s) => !s.term.includes(" "));
const PHRASE_TERMS: SystemSynonym[] = SYSTEM_SYNONYMS.filter((s) => s.term.includes(" "));

/** Direct exact-token lookup. Returns [] if no synonym matches. */
export function findSynonyms(term: string): SystemSynonym[] {
  return TERM_INDEX.get(term.toLowerCase()) ?? [];
}

/**
 * Find every synonym (single-token or multi-word phrase) contained in the
 * given normalized text + token list. Returns deduplicated matches.
 */
export function findContainedSynonyms(normalizedText: string, tokens: string[]): SystemSynonym[] {
  const lowered = normalizedText.toLowerCase();
  const tokenSet = new Set(tokens.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const matches: SystemSynonym[] = [];

  for (const syn of SINGLE_WORD_TERMS) {
    if (tokenSet.has(syn.term)) {
      const key = `${syn.system}::${syn.term}`;
      if (!seen.has(key)) { seen.add(key); matches.push(syn); }
    }
  }
  for (const syn of PHRASE_TERMS) {
    if (lowered.includes(syn.term)) {
      const key = `${syn.system}::${syn.term}`;
      if (!seen.has(key)) { seen.add(key); matches.push(syn); }
    }
  }

  // Slice-35 — when a multi-word match strictly contains a single-word
  // match's term, drop the single-word match. Workbook phrasings like
  // "Lumbosacral plexus: ..." otherwise match BOTH "lumbosacral" (spine,
  // single-word) AND "lumbosacral plexus" (lower_limb, multi-word),
  // tying the keyword score and routing to spine by declaration order.
  // The phrase form is more specific and should win.
  const phraseMatches = matches.filter((m) => m.term.includes(" "));
  if (phraseMatches.length === 0) return matches;
  return matches.filter((m) => {
    if (m.term.includes(" ")) return true; // keep phrase matches
    // Drop single-word matches whose term is a token of any phrase match
    // for a DIFFERENT system. (Same-system overlap is fine; doesn't change
    // the system's score.)
    return !phraseMatches.some(
      (p) => p.system !== m.system && p.term.split(/\s+/).includes(m.term),
    );
  });
}

/**
 * Build a per-system keyword map filtered to high-confidence non-confirmation
 * synonyms only. Used by the router for primary keyword scoring.
 */
export function getSystemKeywords(minConfidence = 0.85): Record<GatiodSystemKey, string[]> {
  const result: Record<GatiodSystemKey, string[]> = {
    upper_limb: [], lower_limb: [], spine: [], respiratory: [],
    renal: [], gastro_digestive: [], hearing: [], cns: [], visual: [],
  };
  for (const syn of SYSTEM_SYNONYMS) {
    if (syn.requiresConfirmation) continue;
    if (syn.confidence < minConfidence) continue;
    if (!result[syn.system].includes(syn.term)) result[syn.system].push(syn.term);
  }
  return result;
}

/**
 * Find similar-term candidates for unresolved tokens. Used by the policy
 * engine to surface "did you mean [system]?" instead of generic clarification.
 *
 * Each unresolved term is checked against the synonym index. Multiple terms
 * pointing at the same system are deduped to the highest-confidence one.
 */
export function findSimilarTermCandidates(unresolvedTerms: string[]): SimilarTermCandidate[] {
  const bySystem = new Map<GatiodSystemKey, SimilarTermCandidate>();
  for (const term of unresolvedTerms) {
    const matches = findSynonyms(term);
    for (const match of matches) {
      const candidate: SimilarTermCandidate = {
        term,
        system: match.system,
        confidence: match.confidence,
        reason: match.notes ?? `'${term}' is associated with ${match.system}`,
      };
      const existing = bySystem.get(match.system);
      if (!existing || existing.confidence < candidate.confidence) {
        bySystem.set(match.system, candidate);
      }
    }
  }
  return Array.from(bySystem.values()).sort((a, b) => b.confidence - a.confidence);
}
