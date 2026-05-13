// Deterministic semantic consensus gate (REQ-SC-GATE-001, ADR-0003).
//
// `shouldRunSemanticConsensus()` is the cost / latency / safety gate that
// decides whether the LLM-driven semantic interpreter is worth invoking.
// It MUST be deterministic — no LLM calls, no network, no ontology retrieval.
//
// The gate signals come from:
//   1. State-based skip signals (active pending workflows, short replies)
//   2. Multi-system lexical signals (≥2 distinct GATIOD systems detected)
//   3. Legacy/deferred system signals (CNS or visual terms present)
//   4. Dense-narrative markers (semicolons, colon-mechanism prefix, length)
//   5. Scope-conflict markers (multiple regions / sides / organs)
//   6. Low-confidence + unresolved-terms + at least one system anchor
//
// The gate is feature-flagged via `SEMANTIC_CONSENSUS_ENABLED`. When the flag
// is off, the gate always returns `shouldRun: false` with a `skipReason`
// of `feature_flag_disabled`. This lets us wire the gate into chatServiceV2
// without changing user-visible behaviour until we explicitly enable it.

import type {
  GatiodSystemKey,
  NormalizedUtterance,
  SemanticConsensusGateResult,
  SemanticConsensusSkipReason,
  SemanticConsensusTriggerKind,
  V2SessionState,
} from "./contracts.js";
import { findContainedSynonyms } from "./systemSynonyms.js";

export interface SemanticConsensusGateInput {
  normalized: NormalizedUtterance;
  state: V2SessionState;
  /** Override the `SEMANTIC_CONSENSUS_ENABLED` env var for testing. */
  forceEnabled?: boolean;
}

/** Whether the gate can fire at all this turn. Default reads
 *  `process.env.SEMANTIC_CONSENSUS_ENABLED`; tests can pass `forceEnabled`. */
function isFeatureEnabled(forceEnabled?: boolean): boolean {
  if (typeof forceEnabled === "boolean") return forceEnabled;
  const flag = process.env.SEMANTIC_CONSENSUS_ENABLED;
  return flag === "true" || flag === "1";
}

/** Words that look like a chip reply or short workflow answer rather than
 *  a new clinical narrative. The list intentionally errs toward "skip" —
 *  the cost of a missed semantic proposal on a one-word reply is low. */
const SHORT_WORKFLOW_REPLIES = new Set([
  "yes",
  "no",
  "y",
  "n",
  "ok",
  "okay",
  "confirm",
  "confirmed",
  "proceed",
  "continue",
  "edit",
  "reject",
  "skip",
  "combine",
  "back",
  "cancel",
  "left",
  "right",
  "bilateral",
  "partial",
  "total",
  "flexion",
  "extension",
  "abduction",
  "adduction",
  "rotation",
  "supination",
  "pronation",
  "dorsiflexion",
  "plantarflexion",
]);

function looksLikeShortWorkflowReply(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 3) return true;
  // Single token that matches the workflow reply set.
  const token = trimmed.replace(/[.!?,;]+$/g, "");
  if (SHORT_WORKFLOW_REPLIES.has(token)) return true;
  // Multi-word phrases that are clearly workflow replies.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= 3 && tokens.every((t) => SHORT_WORKFLOW_REPLIES.has(t))) return true;
  return false;
}

/** Lower-cased terms that indicate a CNS or visual finding likely needs
 *  legacy/deferred handling. The semantic interpreter is best-positioned to
 *  recognize these and label them, so the gate flags their presence as a
 *  trigger reason. */
const LEGACY_DEFERRED_KEYWORDS: ReadonlyArray<string> = [
  // CNS
  "anosmia",
  "olfactory",
  "olfactory nerve",
  "facial nerve",
  "equilibrium",
  "swallowing",
  "station and gait",
  "hemiplegia",
  "paraplegia",
  "quadriplegia",
  "seizure",
  "cognitive impairment",
  "dementia",
  // Visual
  "diplopia",
  "visual field",
  "visual acuity",
  "scotoma",
  "blindness",
  "monocular",
  "homonymous hemianopia",
];

function containsLegacyDeferredSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return LEGACY_DEFERRED_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Markers that indicate a dense / multi-clause clinical narrative. */
function looksLikeDenseNarrative(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 80) return false;
  const semicolons = (trimmed.match(/;/g) ?? []).length;
  if (semicolons >= 1) return true;
  // Mechanism-then-findings pattern: "Heavy object strike: ..."
  if (/^[A-Z][^:.\n]{4,40}:\s+\S/.test(trimmed)) return true;
  // Three or more clauses separated by periods within a long message.
  const periods = (trimmed.match(/\./g) ?? []).length;
  if (periods >= 2 && trimmed.length >= 120) return true;
  return false;
}

/** Markers that indicate scope conflicts the semantic layer should narrow.
 *  Specifically: cervical+lumbar in one utterance, both eyes mentioned
 *  alongside diplopia, multiple sides for different limbs, etc. */
function containsScopeConflict(text: string): boolean {
  const lower = text.toLowerCase();

  // Multi-region spine in one utterance.
  const spineRegions = ["cervical", "thoraco", "thoracic", "lumbar", "lumbo", "sacral"];
  const spineHits = spineRegions.filter((r) => lower.includes(r));
  if (spineHits.length >= 2) return true;

  // Both eyes mentioned together.
  if (/\bleft eye\b/.test(lower) && /\bright eye\b/.test(lower)) return true;

  // Both ears mentioned together (excluding "bilateral" which is handled by hearing extractor).
  if (/\bleft ear\b/.test(lower) && /\bright ear\b/.test(lower)) return true;

  return false;
}

/** Distinct GATIOD systems detected via the synonym scanner. */
function preflightDetectSystems(
  normalized: NormalizedUtterance,
): GatiodSystemKey[] {
  const synonyms = findContainedSynonyms(normalized.normalizedText, normalized.tokens);
  const set = new Set<GatiodSystemKey>();
  for (const syn of synonyms) {
    set.add(syn.system);
  }
  return [...set];
}

function classifyTriggerKind(reasons: string[]): SemanticConsensusTriggerKind {
  if (reasons.includes("scope_conflict")) return "scope_conflict";
  if (reasons.includes("legacy_deferred_system_detected")) return "legacy_deferred";
  if (reasons.includes("multiple_systems_detected")) return "multi_system";
  if (reasons.includes("dense_clinical_narrative")) return "dense_narrative";
  if (reasons.includes("ambiguous_clinical_terms")) return "ambiguous_clinical";
  return "none";
}

function skipResult(
  reason: SemanticConsensusSkipReason,
  detectedSystems: GatiodSystemKey[] = [],
): SemanticConsensusGateResult {
  return {
    shouldRun: false,
    reasons: [],
    detectedSystems,
    triggerKind: "none",
    skipReason: reason,
  };
}

/**
 * The deterministic semantic consensus gate. Runs on every turn but should
 * cost no more than a few hundred microseconds — synonym scanning and
 * regex checks only.
 *
 * Returns `shouldRun: true` when at least one trigger reason fires. Returns
 * `shouldRun: false` with a `skipReason` when an active workflow gate
 * (pending observation/confirmation/global CVC/consensus) blocks the turn,
 * the utterance is a short workflow reply, or the feature flag is off.
 */
export function shouldRunSemanticConsensus(
  input: SemanticConsensusGateInput,
): SemanticConsensusGateResult {
  const { normalized, state } = input;
  const text = normalized.normalizedText ?? "";

  // Hard skip: feature flag.
  if (!isFeatureEnabled(input.forceEnabled)) {
    return skipResult("feature_flag_disabled");
  }

  // Hard skip: empty text.
  if (text.trim().length === 0) {
    return skipResult("empty_text");
  }

  // Hard skip: any active pending state. Pending observation has highest
  // priority because the existing chatServiceV2 pipeline already resolves it
  // before grounding/routing. The other pending states are also resolved
  // before semantic consensus by REQ-SC-RESOLVE-001.
  if (state.pendingConsensus) {
    return skipResult("pending_consensus");
  }
  if (state.pendingConfirmation) {
    return skipResult("pending_confirmation");
  }
  if (state.pendingGlobalCvcConfirmation) {
    return skipResult("pending_global_cvc");
  }
  for (const sys of Object.values(state.systems)) {
    if (sys.pendingObservations.length > 0) {
      return skipResult("pending_observation");
    }
  }

  // Soft skip: short workflow reply.
  if (looksLikeShortWorkflowReply(text)) {
    return skipResult("short_workflow_reply");
  }

  // Lexical pass: detect distinct systems from synonyms.
  const detectedSystems = preflightDetectSystems(normalized);

  const reasons: string[] = [];
  if (detectedSystems.length >= 2) {
    reasons.push("multiple_systems_detected");
  }
  if (containsLegacyDeferredSignal(text)) {
    reasons.push("legacy_deferred_system_detected");
  }
  if (looksLikeDenseNarrative(text)) {
    reasons.push("dense_clinical_narrative");
  }
  if (containsScopeConflict(text)) {
    reasons.push("scope_conflict");
  }
  if (
    typeof normalized.confidence === "number" &&
    normalized.confidence < 0.75 &&
    normalized.unresolvedTerms.length > 0 &&
    detectedSystems.length > 0
  ) {
    reasons.push("ambiguous_clinical_terms");
  }

  return {
    shouldRun: reasons.length > 0,
    reasons,
    detectedSystems,
    triggerKind: classifyTriggerKind(reasons),
  };
}
