import type { NormalizedToken, NormalizedUtterance } from "./contracts.js";

const TERM_NORMALISATIONS: Array<{
  pattern: RegExp;
  normalized: string;
  category: Exclude<NormalizedToken["category"], "raw">;
}> = [
  { pattern: /\bcts\b/gi, normalized: "carpal tunnel syndrome", category: "abbreviation" },
  { pattern: /\bavn\b/gi, normalized: "avascular necrosis", category: "abbreviation" },
  { pattern: /\brom\b/gi, normalized: "range of motion", category: "abbreviation" },
  { pattern: /\bcvc\b/gi, normalized: "combined values chart", category: "abbreviation" },
  { pattern: /\bfev\s*1\b/gi, normalized: "fev1", category: "synonym" },
  { pattern: /\bdlco\b/gi, normalized: "diffusing capacity carbon monoxide", category: "abbreviation" },
  { pattern: /\blumbo[-\s]?sacral\b/gi, normalized: "lumbo sacral", category: "synonym" },
  { pattern: /\bintervert(e|i)bral\b/gi, normalized: "intervertebral", category: "spelling" },
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
  "upper", "lower", "limb", "spine", "respiratory", "renal", "gastro", "digestive", "hearing", "cns", "visual",
  "fracture", "dislocation", "intervertebral", "disc", "neurological", "nerve", "sensory", "motor", "combined",
  "partial", "total", "amputation", "shortening", "avascular", "necrosis", "femoral", "hip", "knee", "ankle",
  "confirm", "confirmed", "proceed", "calculate", "assessment", "global", "combined", "chart", "pain", "persistent",
  "restricted", "motion", "deficit", "lumbo", "sacral", "radicular", "oa", "osteoarthritis", "carpal", "tunnel",
  "syndrome", "range", "prolapsed", "head",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_/-]+/g, " ")
    .split(/\s+/)
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
