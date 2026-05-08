import type { GatiodSystemKey, GroundingResult, NormalizedUtterance, RouteDecision, V2SessionState } from "./contracts.js";

const SYSTEM_KEYWORDS: Record<GatiodSystemKey, string[]> = {
  upper_limb: ["upper", "shoulder", "elbow", "wrist", "thumb", "finger", "brachial", "suprascapular"],
  lower_limb: ["lower", "hip", "knee", "ankle", "toe", "femoral", "lumbosacral", "shortening"],
  spine: ["spine", "lumbo", "sacral", "cervical", "thoraco", "disc", "radicular"],
  respiratory: ["respiratory", "fvc", "fev1", "dlco", "asthma", "dyspnoea", "vo2"],
  renal: ["renal", "creatinine", "ckd", "kidney", "solitary"],
  gastro_digestive: ["gastro", "digestive", "liver", "pancreas", "hepatobiliary", "bowel"],
  hearing: ["hearing", "audiogram", "ahl", "ear"],
  cns: ["cns", "brain", "cognitive", "spastic", "neuropsych"],
  visual: ["visual", "vision", "eye", "acuity", "field"],
};

const SYSTEM_SELECTION_PATTERN = /\b(spine|upper\s+limb|lower\s+limb|respiratory|renal|gastro|digestive|hearing|cns|visual)\b/i;

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

  // Explicit system selection replies should proceed as assessment routing,
  // especially after a clarification prompt.
  if (SYSTEM_SELECTION_PATTERN.test(normalized)) {
    return "assessment";
  }

  if (/\b(assess|assessment|calculate|pi|incapacity|injury|fracture|deficit|amputation)\b/i.test(normalized)) {
    return "assessment";
  }

  return "clarify";
}

function rankSystems(tokens: string[], grounding: GroundingResult): Array<{ system: GatiodSystemKey; score: number }> {
  const scoreMap: Record<GatiodSystemKey, number> = {
    upper_limb: 0,
    lower_limb: 0,
    spine: 0,
    respiratory: 0,
    renal: 0,
    gastro_digestive: 0,
    hearing: 0,
    cns: 0,
    visual: 0,
  };

  for (const [system, keywords] of Object.entries(SYSTEM_KEYWORDS) as Array<[GatiodSystemKey, string[]]>) {
    for (const token of tokens) {
      if (keywords.includes(token)) scoreMap[system] += 1;
    }
  }

  for (const match of grounding.ontologyMatches) {
    scoreMap[match.system] += Math.max(0.5, match.score * 3);
  }

  return Object.entries(scoreMap)
    .map(([system, score]) => ({ system: system as GatiodSystemKey, score }))
    .sort((a, b) => b.score - a.score);
}

export function routeUtterance(
  utterance: NormalizedUtterance,
  grounding: GroundingResult,
  state: V2SessionState
): RouteDecision {
  const operation = detectOperation(utterance.normalizedText, state);
  const rankedSystems = rankSystems(utterance.tokens, grounding);
  const top = rankedSystems[0];
  const second = rankedSystems[1];

  const systems = rankedSystems
    .filter((s) => s.score >= Math.max(1, top?.score ? top.score * 0.55 : 1))
    .slice(0, 3)
    .map((s) => s.system);

  let confidence = 0.35;
  const reasons: string[] = [];

  if (top && top.score > 0) {
    const separation = top.score - (second?.score ?? 0);
    confidence += Math.min(0.35, top.score * 0.08);
    confidence += Math.min(0.2, Math.max(0, separation) * 0.05);
    reasons.push(`Top system score: ${top.system}=${top.score.toFixed(2)}`);
  }

  if (grounding.ontologyMatches.length > 0) {
    confidence += 0.15;
    reasons.push(`Ontology matches: ${grounding.ontologyMatches.length}`);
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
    };
  }

  const multiSystemSignal = systems.length >= 2 && distinctOntologySystems >= 2;
  if (confidence < 0.5 && operation !== "lookup" && !multiSystemSignal) {
    return {
      operation: "clarify",
      systems,
      confidence,
      reasons: [...reasons, "Confidence below safe routing threshold"],
    };
  }

  return { operation, systems, confidence, reasons };
}
