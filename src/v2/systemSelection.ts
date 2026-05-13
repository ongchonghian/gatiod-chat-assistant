import type { GatiodSystemKey } from "./contracts.js";

/**
 * Pattern matching when a doctor types a system name explicitly. Used by both
 * router (to boost confidence on selection replies) and policy engine (to
 * allow low-confidence routing through a clarification).
 *
 * Single source of truth — both files import from here.
 */
export const SYSTEM_SELECTION_PATTERN =
  /\b(spine|spinal|upper\s+limb|lower\s+limb|respiratory|pulmonary|renal|kidney|gastro|digestive|hepatic|hearing|ear|cns|brain|cerebral|visual|vision|eye)\b/i;

/** Map a single matched name to its system key. */
const NAME_TO_SYSTEM: Record<string, GatiodSystemKey> = {
  spine: "spine",
  spinal: "spine",
  "upper limb": "upper_limb",
  "lower limb": "lower_limb",
  respiratory: "respiratory",
  pulmonary: "respiratory",
  renal: "renal",
  kidney: "renal",
  gastro: "gastro_digestive",
  digestive: "gastro_digestive",
  hepatic: "gastro_digestive",
  hearing: "hearing",
  ear: "hearing",
  cns: "cns",
  brain: "cns",
  cerebral: "cns",
  visual: "visual",
  vision: "visual",
  eye: "visual",
};

const SELECTION_GLOBAL =
  /\b(spine|spinal|upper\s+limb|lower\s+limb|respiratory|pulmonary|renal|kidney|gastro|digestive|hepatic|hearing|ear|cns|brain|cerebral|visual|vision|eye)\b/gi;

/**
 * Extract every explicitly-named system from a sentence. Order-preserving;
 * deduplicated. Used to detect multi-system selection replies like
 * "spine, then lower limb".
 */
export function detectExplicitSystemSelection(text: string): GatiodSystemKey[] {
  const seen = new Set<GatiodSystemKey>();
  const out: GatiodSystemKey[] = [];
  for (const match of text.toLowerCase().matchAll(SELECTION_GLOBAL)) {
    const key = match[1].replace(/\s+/g, " ");
    const sys = NAME_TO_SYSTEM[key];
    if (sys && !seen.has(sys)) {
      seen.add(sys);
      out.push(sys);
    }
  }
  return out;
}
