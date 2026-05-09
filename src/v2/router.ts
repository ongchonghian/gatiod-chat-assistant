import type { GatiodSystemKey, GroundingResult, NormalizedUtterance, RouteDecision, V2SessionState } from "./contracts.js";
import {
  findContainedSynonyms,
  findSimilarTermCandidates,
  getSystemKeywords,
} from "./systemSynonyms.js";
import { SYSTEM_SELECTION_PATTERN } from "./systemSelection.js";

const SYSTEM_KEYWORDS: Record<GatiodSystemKey, string[]> = getSystemKeywords();

const ALL_SYSTEMS: GatiodSystemKey[] = [
  "upper_limb", "lower_limb", "spine", "respiratory", "renal",
  "gastro_digestive", "hearing", "cns", "visual",
];

// ── Ontology noise controls ────────────────────────────────────────────────
// Limb systems own hundreds of nerve / amputation / DBE entries; without
// limits, generic words like "loss" or "neck" cause those entries to swamp
// scores for hearing/cns/renal/etc. queries. (REQ-A1)
const MIN_ONTOLOGY_MATCH_SCORE = 0.25;
const MAX_ONTOLOGY_BOOST_PER_SYSTEM = 3.0;

// ── Confidence thresholds ──────────────────────────────────────────────────
// Single unambiguous system gets a relaxed threshold so unambiguous queries
// like "pulmonary FVC 65%" don't get blocked behind a "which system?" wall.
const SINGLE_SYSTEM_THRESHOLD = 0.4;
const MULTI_SYSTEM_THRESHOLD = 0.55;

// ── Multi-system inclusion ─────────────────────────────────────────────────
// Replaced the prior 55% top-fraction with a permissive ratio + floor so a
// single confident keyword (e.g. "retinopathy") still surfaces alongside a
// dominant primary system. The floor of 1.0 means one solid keyword always
// makes the route. (REQ-D2)
const SECONDARY_INCLUSION_RATIO = 0.2;
const SECONDARY_INCLUSION_FLOOR = 1.0;

// Each keyword/synonym match contributes this much. Bumping above 1.0 lets a
// clear single-keyword signal outweigh moderate ontology noise (e.g. "glaucoma"
// alone should beat upper_limb's incidental "loss"-token ontology matches).
const KEYWORD_WEIGHT_PER_MATCH = 1.5;

function detectOperation(normalized: string, state: V2SessionState): RouteDecision["operation"] {
  if (/\b(combine|global|overall|total)\b.*\b(pi|assessment|impairment)\b/i.test(normalized) || /\bassess_global_cvc\b/i.test(normalized)) {
    return "global_cvc";
  }

  if (/\b(what is|define|meaning|lookup|table|how much|percent for|what does)\b/i.test(normalized)) {
    return "lookup";
  }

  if (state.pendingConfirmation && /\b(confirm|confirmed|proceed|yes|ok)\b/i.test(normalized)) {
    return "assessment";
  }

  if (SYSTEM_SELECTION_PATTERN.test(normalized)) {
    return "assessment";
  }

  if (/\b(assess|assessment|calculate|pi|incapacity|injury|fracture|deficit|amputation)\b/i.test(normalized)) {
    return "assessment";
  }

  return "clarify";
}

interface SystemScoreBreakdown {
  keyword: number;
  ontologyRaw: number;
  ontologyCapped: number;
  acceptedOntologyMatches: number;
  rejectedOntologyMatches: number;
}

interface RankResult {
  ranked: Array<{ system: GatiodSystemKey; score: number; breakdown: SystemScoreBreakdown }>;
  ontologyClipped: boolean;
}

function emptyBreakdowns(): Record<GatiodSystemKey, SystemScoreBreakdown> {
  const out = {} as Record<GatiodSystemKey, SystemScoreBreakdown>;
  for (const sys of ALL_SYSTEMS) {
    out[sys] = { keyword: 0, ontologyRaw: 0, ontologyCapped: 0, acceptedOntologyMatches: 0, rejectedOntologyMatches: 0 };
  }
  return out;
}

function rankSystems(
  utterance: NormalizedUtterance,
  grounding: GroundingResult
): RankResult {
  const breakdowns = emptyBreakdowns();

  // 1. Keyword matching — single-word tokens AND multi-word phrases via the
  //    synonym table. Each match contributes 1 point regardless of which
  //    keyword fired (so a query mentioning "spine" twice still scores 1).
  const synonymMatches = findContainedSynonyms(utterance.normalizedText, utterance.tokens);
  const matchedTermsBySystem = new Map<GatiodSystemKey, Set<string>>();
  for (const match of synonymMatches) {
    if (!matchedTermsBySystem.has(match.system)) matchedTermsBySystem.set(match.system, new Set());
    matchedTermsBySystem.get(match.system)!.add(match.term);
  }
  for (const [system, terms] of matchedTermsBySystem.entries()) {
    breakdowns[system].keyword = terms.size * KEYWORD_WEIGHT_PER_MATCH;
  }

  // 2. Ontology matching — apply minimum-score threshold and per-system cap
  //    so limb-heavy ontology data can't swamp cleanly-keyworded non-limb
  //    queries.
  let ontologyClipped = false;
  for (const match of grounding.ontologyMatches) {
    const boost = Math.max(0.5, match.score * 3);
    if (match.score < MIN_ONTOLOGY_MATCH_SCORE) {
      breakdowns[match.system].rejectedOntologyMatches += 1;
      continue;
    }
    breakdowns[match.system].acceptedOntologyMatches += 1;
    breakdowns[match.system].ontologyRaw += boost;
  }
  for (const sys of ALL_SYSTEMS) {
    const raw = breakdowns[sys].ontologyRaw;
    const capped = Math.min(raw, MAX_ONTOLOGY_BOOST_PER_SYSTEM);
    breakdowns[sys].ontologyCapped = capped;
    if (capped < raw) ontologyClipped = true;
  }

  const ranked = ALL_SYSTEMS.map((sys) => ({
    system: sys,
    score: breakdowns[sys].keyword + breakdowns[sys].ontologyCapped,
    breakdown: breakdowns[sys],
  })).sort((a, b) => b.score - a.score);

  return { ranked, ontologyClipped };
}

export function routeUtterance(
  utterance: NormalizedUtterance,
  grounding: GroundingResult,
  state: V2SessionState
): RouteDecision {
  const operation = detectOperation(utterance.normalizedText, state);
  const { ranked, ontologyClipped } = rankSystems(utterance, grounding);
  const top = ranked[0];
  const second = ranked[1];

  // Build the included-systems list. The top system is included if it scored
  // > 0; secondaries must clear the ratio + floor AND have at least one
  // keyword/synonym hit. The keyword requirement prevents pure ontology
  // noise (limb nerve/amputation entries matching generic words like "loss")
  // from surfacing as a route candidate when the doctor never used a limb
  // term.
  const systems: GatiodSystemKey[] = [];
  if (top && top.score > 0) systems.push(top.system);
  const secondaryThreshold = Math.max(SECONDARY_INCLUSION_FLOOR, (top?.score ?? 0) * SECONDARY_INCLUSION_RATIO);
  for (const row of ranked.slice(1, 3)) {
    if (row.score >= secondaryThreshold && row.breakdown.keyword > 0) systems.push(row.system);
  }

  let confidence = 0.35;
  const reasons: string[] = [];

  if (top && top.score > 0) {
    const separation = top.score - (second?.score ?? 0);
    confidence += Math.min(0.35, top.score * 0.08);
    confidence += Math.min(0.2, Math.max(0, separation) * 0.05);
    reasons.push(
      `Top system score: ${top.system}=${top.score.toFixed(2)} (kw=${top.breakdown.keyword}, ont=${top.breakdown.ontologyCapped.toFixed(2)})`
    );
  }

  if (grounding.ontologyMatches.length > 0) {
    confidence += 0.15;
    reasons.push(`Ontology matches: ${grounding.ontologyMatches.length}`);
  }

  if (ontologyClipped) {
    reasons.push("Ontology contribution capped (limb-noise control active)");
  }

  const distinctOntologySystems = new Set(grounding.ontologyMatches.map((m) => m.system)).size;
  if (distinctOntologySystems >= 2) {
    confidence += 0.1;
    reasons.push(`Multi-system ontology signal: ${distinctOntologySystems} systems`);
  }

  if (systems.length >= 2) {
    confidence += 0.12;
    reasons.push(`Multi-system route candidate: ${systems.join(", ")}`);
  }

  if (SYSTEM_SELECTION_PATTERN.test(utterance.normalizedText) && systems.length > 0) {
    confidence += 0.18;
    reasons.push("Explicit system selection detected");
  }

  confidence = Math.max(0.05, Math.min(0.98, confidence * utterance.confidence));

  // Soft-match candidates from synonyms on unresolved terms — surfaces "did
  // you mean [system]?" instead of generic clarification when the doctor
  // used a term we didn't match (REQ-C1).
  const candidateSystems = systems.length === 0
    ? findSimilarTermCandidates(utterance.unresolvedTerms).map((c) => ({
        term: c.term,
        system: c.system,
        confidence: c.confidence,
        reason: c.reason,
      }))
    : undefined;

  if (operation === "global_cvc") {
    return {
      operation,
      systems: [],
      confidence: Math.max(confidence, 0.75),
      reasons: [...reasons, "Global CVC intent keywords detected"],
    };
  }

  if (systems.length === 0) {
    return {
      operation: "clarify",
      systems: [],
      confidence: Math.min(confidence, 0.45),
      reasons: [...reasons, "No system could be confidently identified"],
      candidateSystems,
    };
  }

  // Single unambiguous system gets a lower threshold than multi-system routes.
  // Rationale: if the doctor said something clinical and only one plausible
  // system resulted, asking "which system?" is annoying. Multi-system queries
  // need higher confidence because the consequence of misrouting is bigger.
  const threshold = systems.length === 1 ? SINGLE_SYSTEM_THRESHOLD : MULTI_SYSTEM_THRESHOLD;
  const multiSystemSignal = systems.length >= 2 && distinctOntologySystems >= 2;
  if (confidence < threshold && operation !== "lookup" && !multiSystemSignal) {
    return {
      operation: "clarify",
      systems,
      confidence,
      reasons: [...reasons, `Confidence ${confidence.toFixed(2)} below ${systems.length === 1 ? "single" : "multi"}-system threshold ${threshold}`],
    };
  }

  return { operation, systems, confidence, reasons };
}
