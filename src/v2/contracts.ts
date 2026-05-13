export interface SlotSignals {
  // Presence meta-signals (used in required_when conditions)
  rom_present: boolean;
  nerve_present: boolean;
  amputation_present: boolean;
  dbe_present: boolean;
  shortening_present: boolean;
  spine_neuro_present: boolean;
  tinnitus_mentioned: boolean;
  fracture_present: boolean;
  disc_present: boolean;
  // Per-slot satisfaction signals
  side: boolean;
  finding_type: boolean;
  rom_joint: boolean;
  rom_measurements: boolean;
  ankylosis_flag: boolean;
  nerve_details: boolean;
  rom_from_nerve: boolean;
  dbe_condition: boolean;
  // Spine
  region: boolean;
  diagnosis_category: boolean;
  severity_key: boolean;
  fracture_height_loss: boolean;
  asia_grade: boolean;
  monoparesis_gate: boolean;
  bladder_bowel: boolean;
  mri_status: boolean;
  // Lower limb
  toe_vs_shortening_gate: boolean;
  shortening_cm: boolean;
  // Respiratory
  diagnosis: boolean;
  pft_values: boolean;
  selected_pi_within_class: boolean;
  asthma_prerequisites: boolean;
  asthma_medication: boolean;
  asbestosis_profusion: boolean;
  // Gastro
  subSystem: boolean;
  selectedBracketIndex: boolean;
  piPercent: boolean;
  clinicalJustification: boolean;
  // Hearing
  path: boolean;
  leftEarAhl: boolean;
  rightEarAhl: boolean;
  age: boolean;
  affectedEars: boolean;
  tinnitus_gate: boolean;
  // CNS
  cns_section: boolean;
  section_a_group: boolean;
  specialist_confirmation: boolean;
  section_b_component: boolean;
  section_b_bracket: boolean;
  paralysed_limbs: boolean;
  // Visual
  leftEye: boolean;
  rightEye: boolean;
  acuity: boolean;
  field: boolean;
  diplopiaId: boolean;
  modifiers: boolean;
  // Renal
  sex: boolean;
  renal_inputs: boolean;
  clinical_severity: boolean;
  solitary_kidney: boolean;
  provisional_award: boolean;
}

export type GatiodSystemKey =
  | "upper_limb"
  | "lower_limb"
  | "spine"
  | "respiratory"
  | "renal"
  | "gastro_digestive"
  | "hearing"
  | "cns"
  | "visual";

export type RouteOperation = "lookup" | "assessment" | "global_cvc" | "clarify";

export interface NormalizedToken {
  original: string;
  normalized: string;
  category: "abbreviation" | "synonym" | "spelling" | "raw";
}

export interface NormalizedUtterance {
  raw: string;
  normalizedText: string;
  tokens: string[];
  mappedTokens: NormalizedToken[];
  unresolvedTerms: string[];
  confidence: number;
}

export interface RouteDecision {
  operation: RouteOperation;
  systems: GatiodSystemKey[];
  confidence: number;
  reasons: string[];
  /**
   * Soft-match candidates derived from synonym table for unresolved terms.
   * Populated when no system meets the keyword/ontology threshold but the
   * doctor used a clinically-meaningful synonym. Surfaces "did you mean
   * [system]?" confirmations instead of generic system-picker prompts.
   */
  candidateSystems?: Array<{
    term: string;
    system: GatiodSystemKey;
    confidence: number;
    reason: string;
  }>;
}

export interface GroundingCitation {
  source: "gatiod.pdf" | "ontology";
  chapter?: number;
  section?: string;
  label: string;
  snippet: string;
  score: number;
}

export interface OntologyMatch {
  system: GatiodSystemKey;
  type: "dbe" | "nerve" | "amputation" | "spine_category" | "spine_severity" | "concept";
  canonicalId: string;
  label: string;
  score: number;
  aliases: string[];
}

export interface GroundingResult {
  citations: GroundingCitation[];
  ontologyMatches: OntologyMatch[];
}

export interface ToolPlanCall {
  name: string;
  args: Record<string, unknown>;
  status: "proposed" | "executed" | "rejected" | "failed";
  validation: {
    ok: boolean;
    message: string;
  };
  result?: unknown;
}

export interface ToolPlan {
  proposed: ToolPlanCall[];
  actual: ToolPlanCall[];
}

export interface PolicyDecision {
  action: "clarify" | "execute_tools" | "delegate_legacy";
  reason: string;
  requiresConfirmation: boolean;
  clarificationQuestion?: string;
  chips?: string[];
  proposedTools: ToolPlanCall[];
  /**
   * When set, the chat service should write this snapshot to
   * `state.pendingGlobalCvcConfirmation` after applying the decision. Used
   * by the global-CVC policy branch to refresh a stale offer's snapshot.
   * The forward declaration here avoids a circular type — defined fully
   * above as PendingGlobalCvcConfirmation.
   */
  pendingGlobalCvcSnapshot?: PendingGlobalCvcConfirmation;
  /**
   * When true, the chat service should clear `state.pendingGlobalCvcConfirmation`
   * after applying the decision. Used when the doctor picks "Add another
   * system" or "Edit a finding" from a global-CVC offer.
   */
  clearPendingGlobalCvc?: boolean;
}

export type V2SystemStatus = "idle" | "collecting" | "needs_confirmation" | "calculated";

export type V2InstanceStatus = "collecting" | "ready" | "confirmed" | "calculated";

/**
 * A single assessment instance scoped to a system + slot path.
 * e.g. instanceId "upper_limb::left::shoulder", slotPath ["left", "shoulder"].
 *
 * TFacts defaults to V2SystemFacts; typed fact shapes are introduced per-system in Steps 3–5.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface V2AssessmentInstance<TFacts = Record<string, ExtractedFact<any>>> {
  instanceId: string;
  system: GatiodSystemKey;
  slotPath: string[];
  facts: TFacts;
  pendingObservations: PendingObservation[];
  confirmation: V2SystemConfirmation;
  status: V2InstanceStatus;
  piPercent: number | null;
  trace: import("./calculationTrace.js").CalculationTrace | null;
  updatedAt: string;
}

// D4 — per-fact provenance. No confirmed flag; confirmation is system-level.
export interface ExtractedFact<T> {
  value: T;
  sourceText: string;
  confidence: number;
  extractionMethod: "regex" | "llm_proposed_validated" | "user_selected";
  createdAt: string;
  updatedAt: string;
}

// Calculation-grade structured facts keyed by slot name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type V2SystemFacts = Record<string, ExtractedFact<any>>;

/** Why a semantic-accepted finding could not be mapped to a calculation-grade
 *  fact. Populated on `PendingObservation.semanticAttribution` so the
 *  doctor-facing message can explain *what* the system understood and *what*
 *  it still needs (REQ-SC-DISAGREE-001). */
export type SemanticMappingFailureKind =
  | "missing_calculation_field"
  | "unmapped_canonical_term"
  | "ambiguous_mapping"
  | "unsupported_in_structured_v2"
  | "extractor_no_match";

export interface PendingObservationSemanticAttribution {
  interpretationId: string;
  sourceSpan: string;
  proposedMapping: string;
  findingType: SemanticFindingType;
  confidence: number;
  failureKind: SemanticMappingFailureKind;
}

/**
 * Typed shape of the answer a PendingObservation expects from the doctor.
 * Lets a generic resolver graduate the reply into a fact without a
 * system-specific handler. (Issue #12, RC-6)
 *
 * - `enum`     — answer must equal one of `choices` (case-insensitive).
 * - `number`   — answer is parsed as a number; optional unit/range
 *                metadata for prefill, validation, and prompt rendering.
 * - `boolean`  — yes/no, true/false, confirm/deny.
 * - `text`     — free-form string (rare; reserved for cases where
 *                downstream extraction does the parsing).
 */
export type PendingObservationExpectedAnswer =
  | { kind: "enum"; choices: string[]; factKey: string }
  | {
      kind: "number";
      factKey: string;
      unit?: "dB" | "degrees" | "percent" | "cm" | "mmHg" | "mL/min" | "years";
      min?: number;
      max?: number;
    }
  | { kind: "boolean"; factKey: string }
  | { kind: "text"; factKey: string };

// D3 — unresolved observation waiting for a missing clinical field.
export interface PendingObservation {
  id: string;
  system: GatiodSystemKey;
  type:
    | "rom_measurement"
    | "nerve_deficit"
    | "dbe_condition"
    | "severity_bracket"
    | "hearing_value"
    | "visual_value"
    | "respiratory_value"
    | "renal_value"
    | "spine_category"
    | "semantic_mapping_gap"
    | "other";
  sourceText: string;
  parsed: Record<string, unknown>;
  missingFields: string[];
  clarificationQuestion: string;
  candidateAnswers?: string[];
  createdAt: string;
  updatedAt: string;
  /** Set when this observation was produced because a semantically-accepted
   *  finding could not be converted to a calculation-grade fact. The
   *  doctor-facing message says: "I understood this as X, based on
   *  '<sourceSpan>', but I still need <missingField>." (REQ-SC-DISAGREE-001) */
  semanticAttribution?: PendingObservationSemanticAttribution;
  /** Typed shape of the answer expected — when set, a generic resolver can
   *  graduate the doctor's reply into the named fact without a
   *  system-specific code path. (Issue #12, RC-6) */
  expectedAnswer?: PendingObservationExpectedAnswer;
}

// D4 — system-level confirmation with a facts-hash snapshot.
export interface V2SystemConfirmation {
  status: "not_confirmed" | "pending" | "confirmed" | "stale";
  confirmedAt?: string;
  confirmedBy?: string;
  confirmationSummary?: string;
  factsHash?: string;
}

export interface V2SystemState {
  status: V2SystemStatus;
  completeness: number;
  pendingFields: string[];
  slotSignals: Partial<SlotSignals>;
  /** Human-readable extracted values per slot key, accumulated across turns. */
  extractedValues: Record<string, string>;
  /** Calculation-grade structured facts (D3). Only resolved, complete values. */
  extractedFacts: V2SystemFacts;
  /** Observations not yet calculable — missing one or more clinical fields (D3). */
  pendingObservations: PendingObservation[];
  /** System-level confirmation with factsHash snapshot (D4). */
  confirmation: V2SystemConfirmation;
  piPercent: number | null;
  updatedAt: string;
}

export interface PendingConfirmation {
  system: GatiodSystemKey;
  summary: string;
  createdAt: string;
}

/**
 * Snapshot of the per-system PI values the doctor was offered to combine.
 * Set when ≥2 systems have calculated and the assistant offers a global CVC
 * combination. Becomes stale (and gets cleared) if any component's piPercent
 * changes before the doctor confirms — exactly analogous to the per-system
 * `factsHash` snapshot but at session level. Vanilla CVC; cap policy is a
 * follow-up (see CONTEXT.md).
 */
export interface PendingGlobalCvcConfirmation {
  status: "pending";
  componentSystems: GatiodSystemKey[];
  componentValues: number[];
  createdAt: string;
}

// ── Semantic consensus layer (ADR-0003) ────────────────────────────────────
// Proposal-only LLM front door. The interpreter must never write calculation
// facts, produce PI%, or reference assess_* tools. See REQ-SC-OUTPUT-001.

/** Status of a candidate system in a semantic interpretation. */
export type SemanticSystemStatus =
  | "structured_supported"
  | "structured_shadow"
  | "legacy_deferred";

/** Type of a candidate finding within a semantic interpretation. */
export type SemanticFindingType =
  | "amputation"
  | "rom"
  | "neurological"
  | "dbe"
  | "spine_diagnosis"
  | "hearing_loss"
  | "respiratory_function"
  | "renal_function"
  | "gastro_subsystem"
  | "cns_component"
  | "visual_component"
  | "structural"
  | "other";

/** Completeness of a candidate finding. `calculation_ready` is intentionally absent —
 *  semantic findings are never calculation-ready; only deterministic extractors
 *  produce calculation-grade facts. */
export type SemanticFindingCompleteness =
  | "complete_for_extraction"
  | "missing_calculation_fields"
  | "unsupported";

export interface SemanticCandidateSystem {
  system: GatiodSystemKey;
  confidence: number;
  status: SemanticSystemStatus;
  evidence: string[];
  rationale: string;
}

export interface SemanticCandidateFinding {
  system: GatiodSystemKey;
  /** Quoted substring of the original utterance — must be verifiable against source text. */
  sourceSpan: string;
  findingType: SemanticFindingType;
  proposedMapping: string;
  systemConfidence: number;
  mappingConfidence: number;
  completeness: SemanticFindingCompleteness;
  explicitlyStatedFields: string[];
  inferredFields: string[];
  missingFields: string[];
  /** Always false. Enforced as `z.literal(false)` in the schema validator. */
  calculationReady: false;
}

export interface SemanticInterpretation {
  id: string;
  sourceText: string;
  sourceHash: string;
  candidateSystems: SemanticCandidateSystem[];
  candidateFindings: SemanticCandidateFinding[];
  unsupportedTerms: string[];
  assumptions: string[];
  /** Always true. Marker that this object requires doctor consensus before extraction. */
  requiresUserConsensus: true;
  createdAt: string;
}

/** Persisted state when a semantic proposal awaits doctor decision.
 *  Resolved before any routing, extraction, or policy decision runs (REQ-SC-RESOLVE-001). */
export interface PendingConsensus {
  interpretationId: string;
  /** Hash of the SemanticInterpretation object — detects when the interpretation
   *  itself was replaced (e.g. after an edit cycle). */
  interpretationHash: string;
  /** Hash of the original source text — detects when a new utterance arrives
   *  before the previous proposal was resolved. */
  sourceHash: string;
  sourceText: string;
  /** Doctor-facing rendered proposal message. */
  message: string;
  candidateSystems: GatiodSystemKey[];
  /** Snapshot of the interpretation's candidate findings, preserved so that
   *  when the doctor accepts the consensus the resulting ExtractionContext
   *  carries the exact set of agreed findings (not an empty list). Optional
   *  for backwards compatibility with sessions persisted before this field
   *  was introduced (issue #12, RC-2). New code must always populate it. */
  candidateFindings?: SemanticCandidateFinding[];
  createdAt: string;
  /** "decision" — awaiting Proceed / Edit / Reject / Assess X first / Skip / Use legacy.
   *  "edit_instruction" — Edit was chosen; awaiting the doctor's correction text. */
  awaiting: "decision" | "edit_instruction";
}

// ── Semantic consensus gate (REQ-SC-GATE-001) ───────────────────────────────
// Deterministic preflight that decides whether to invoke the semantic
// interpreter. Must NEVER call an LLM. Returns auditable trigger reasons.

export type SemanticConsensusTriggerKind =
  | "multi_system"
  | "legacy_deferred"
  | "dense_narrative"
  | "scope_conflict"
  | "ambiguous_clinical"
  | "none";

export type SemanticConsensusSkipReason =
  | "feature_flag_disabled"
  | "pending_consensus"
  | "pending_confirmation"
  | "pending_global_cvc"
  | "pending_observation"
  | "short_workflow_reply"
  | "empty_text";

export interface SemanticConsensusGateResult {
  shouldRun: boolean;
  reasons: string[];
  detectedSystems: GatiodSystemKey[];
  triggerKind: SemanticConsensusTriggerKind;
  /** When `shouldRun` is false, the deterministic reason it was skipped. */
  skipReason?: SemanticConsensusSkipReason;
}

// ── Claim-level orchestration (REQ-MS-COMPONENT-001) ───────────────────────
// ClaimAssessmentComponent is a derived view; only states that cannot be
// derived from V2SystemState persist as overrides.

/** Statuses that cannot be derived from `V2SystemState.status`.
 *  Stored as overrides; everything else (idle/collecting/calculated) is derived. */
export type ClaimOverrideStatus =
  | "detected"
  | "legacy_deferred"
  | "unsupported"
  | "skipped_by_user";

export interface ClaimComponentOverride {
  status: ClaimOverrideStatus;
  reason?: string;
  source?: "semantic_consensus" | "user_choice" | "safe_fail" | "legacy_policy" | "system_registry";
  sourceText?: string;
  createdAt: string;
  updatedAt: string;
}

/** Doctor-chosen exclusion of an already-calculated system from Global CVC.
 *  Distinct from `skipped_by_user` (REQ-GC-EXCLUSION-001). The system's PI%
 *  is preserved; only its CVC eligibility is removed. */
export interface GlobalCvcExclusion {
  excludedAt: string;
  excludedBy?: string;
  reason?: string;
  source: "user_choice";
}

/** Read-only context passed to deterministic extractors after consensus is
 *  accepted (REQ-MS-EXTRACT-001). Must not be persisted in V2SystemState. */
export interface ExtractionContext {
  consensusId: string;
  sourceText: string;
  sourceHash: string;
  acceptedSystems: GatiodSystemKey[];
  acceptedFindings: SemanticCandidateFinding[];
  /** When the doctor selected "Assess X first", focusSystem is X. Other accepted
   *  systems are still extracted; focus only affects rendering order. */
  focusSystem?: GatiodSystemKey;
  /** For multi-region narrowing (e.g. spine cervical-first). When set, the
   *  extractor should use these source spans instead of the full original text. */
  selectedScope?: {
    system: GatiodSystemKey;
    scope: string;
    sourceSpans: string[];
  };
}

/** Action chosen by the deterministic consensus resolver (REQ-SC-RESOLVE-001). */
export type ConsensusResolutionAction =
  | "accepted_all"
  | "accepted_system_first"
  | "edit_requested"
  | "rejected"
  | "legacy_requested"
  | "skipped_system"
  | "unresolved";

export interface ConsensusResolutionResult {
  resolved: boolean;
  action: ConsensusResolutionAction;
  state: V2SessionState;
  /** Set when extraction should run this turn (accepted_all / accepted_system_first). */
  extractionPlan?: {
    sourceText: string;
    sourceHash: string;
    sourceUtterance: NormalizedUtterance;
    extractionContext: ExtractionContext;
    targets: GatiodSystemKey[];
    focusSystem?: GatiodSystemKey;
  };
  /** Set when this resolution produces a user-facing reply that stops the pipeline. */
  response?: {
    message: string;
    chips?: string[];
    stopPipeline: boolean;
  };
  auditEvent?: {
    eventType: string;
    payload: Record<string, unknown>;
  };
}

// ── Derived claim plan view (REQ-MS-PLAN-001) ──────────────────────────────
// ClaimAssessmentComponent is computed at render time from V2SystemState +
// claimComponentOverrides + globalCvcExclusions + pending states. It is a
// view model, not a stored object.

/** Full set of statuses a ClaimAssessmentComponent can be in. Includes both
 *  derivable states (idle/needs_clarification/.../calculated) and the four
 *  override-only states from `ClaimOverrideStatus`. */
export type ClaimComponentStatus =
  | "idle"
  | "detected"
  | "needs_clarification"
  | "ready_for_confirmation"
  | "confirmation_pending"
  | "confirmed"
  | "calculated"
  | "legacy_deferred"
  | "unsupported"
  | "skipped_by_user";

export interface ClaimAssessmentComponent {
  system: GatiodSystemKey;
  status: ClaimComponentStatus;
  piPercent?: number;
  missingFields?: string[];
  pendingQuestion?: string;
  /** Reason text from `claimComponentOverrides[system]` or doctor-facing
   *  description when the component is in a terminal state. */
  reason?: string;
  /** Provenance of the override, when present. */
  source?: ClaimComponentOverride["source"];
  /** True when the system is calculated but listed in `globalCvcExclusions`. */
  excludedFromGlobalCvc?: boolean;
  exclusionReason?: string;
}

/** The next user-facing step the claim should advance to. Rendered compactly
 *  for ≤2 active systems, as a structured plan for 3+ (REQ-MS-PLAN-001). */
export type ClaimStep =
  | {
      kind: "confirm_system";
      system: GatiodSystemKey;
      message: string;
      chips: string[];
    }
  | {
      kind: "clarify_system";
      system: GatiodSystemKey;
      message: string;
      chips?: string[];
    }
  | {
      kind: "legacy_deferred";
      system: GatiodSystemKey;
      message: string;
      chips: string[];
    }
  | {
      kind: "unsupported";
      system: GatiodSystemKey;
      message: string;
      chips: string[];
    }
  | {
      kind: "offer_global_cvc";
      message: string;
      chips: string[];
    }
  | {
      kind: "claim_plan";
      message: string;
      chips: string[];
      components: ClaimAssessmentComponent[];
    };

// ── ADR-0004 Extractor comparison UI ─────────────────────────────────────────
//
// When both the primary (regex) and shadow (LLM) extractors run on the same
// utterance, the pipeline stops and the doctor chooses which output is
// accurate — or asks to re-state the values when both are wrong.

/**
 * Set when both the primary (regex) and shadow (LLM) extractors ran on the
 * same utterance. The pipeline stops until the doctor chooses which output is
 * more accurate (ADR-0004 comparison UI).
 *
 * Cleared when the doctor picks "Use A", "Use B", "Both correct", or
 * "Both wrong". In the "Both wrong" case, `PendingSlotCorrection` is set
 * instead so the doctor can re-state the correct values.
 */
export interface PendingExtractorComparison {
  /** Session-unique ID for this comparison offer. */
  id: string;
  system: GatiodSystemKey;
  /** The raw source utterance both extractors ran on. */
  sourceText: string;
  /**
   * Primary (regex) extraction result — not yet applied to state.
   * Applied if doctor picks "Use A (live)" or "Both correct".
   */
  primaryResult: StructuredExtractionResult;
  /**
   * Shadow (LLM) extraction result — not yet applied to state.
   * Applied if doctor picks "Use B (LLM)".
   */
  shadowResult: StructuredExtractionResult;
  /** Doctor-facing comparison message rendered from both results. */
  message: string;
  /** True when at least one fact key has conflicting values between extractors. */
  hasConflicts: boolean;
  /** Offered chips: always ["Use A (live)", "Use B (LLM)", "Both wrong"],
   *  plus "Both correct" when `!hasConflicts`. */
  chips: string[];
  createdAt: string;
}

/**
 * Set when the doctor chose "Both wrong" on an extractor comparison.
 * The doctor must re-state the correct values. On the next turn, the primary
 * extractor re-runs on the correction utterance without showing the comparison
 * again (suppressed by the pipeline for this system).
 */
export interface PendingSlotCorrection {
  /** Session-unique ID for this correction offer. */
  id: string;
  system: GatiodSystemKey;
  /** Doctor-facing message explaining what was wrong and what to do next. */
  message: string;
  createdAt: string;
}

export interface V2SessionState {
  version: 1;
  systems: Record<GatiodSystemKey, V2SystemState>;
  /**
   * Instance-aware state (Step 2+). Lives alongside `systems` during migration.
   * Extractors, readiness validators, and arg builders migrate to use this;
   * `systems` remains the source of truth for legacy/shadow paths until each
   * system is promoted back to structured_live with instance support.
   */
  instancesBySystem: Partial<Record<GatiodSystemKey, V2AssessmentInstance[]>>;
  pendingClarification: string | null;
  pendingConfirmation: PendingConfirmation | null;
  pendingGlobalCvcConfirmation: PendingGlobalCvcConfirmation | null;
  /** Set when a semantic interpretation awaits doctor decision (REQ-SC-RESOLVE-001). */
  pendingConsensus: PendingConsensus | null;
  /** Claim-level statuses that cannot be derived from V2SystemState (REQ-MS-COMPONENT-001). */
  claimComponentOverrides: Partial<Record<GatiodSystemKey, ClaimComponentOverride>>;
  /** Calculated systems explicitly excluded from Global CVC by doctor choice (REQ-GC-EXCLUSION-001). */
  globalCvcExclusions: Partial<Record<GatiodSystemKey, GlobalCvcExclusion>>;
  /**
   * Set when both primary and shadow extractors ran and produced output that
   * the doctor must review (ADR-0004 comparison UI). Pipeline stops here.
   * Cleared once the doctor picks a side or requests re-entry.
   */
  pendingExtractorComparison: PendingExtractorComparison | null;
  /**
   * Set when the doctor chose "Both wrong" — they must re-state the correct
   * values. On the next turn the primary extractor runs without shadow so the
   * comparison loop cannot re-trigger.
   */
  pendingSlotCorrection: PendingSlotCorrection | null;
}

export interface ChatV2Response {
  sessionId: string;
  message: string;
  route: RouteDecision;
  grounding: GroundingResult;
  needsClarification: boolean;
  clarificationQuestion?: string;
  suggestedChips?: string[];
  toolPlan: ToolPlan;
  policy: PolicyDecision;
  shadowMode: boolean;
}

// ── Component result types (shared across extractor / readiness / arg-builder / renderer) ──

export interface ExtractionAuditEvent {
  /** Audit event type — recorded as `eventType` in the audit log. */
  eventType: string;
  /** Structured payload for the event. */
  payload: Record<string, unknown>;
}

export interface StructuredExtractionResult {
  extractedFactsPatch: V2SystemFacts;
  pendingObservationsToAdd: PendingObservation[];
  pendingObservationsToResolve: string[];
  slotSignalsPatch: Partial<SlotSignals>;
  displayValuesPatch: Record<string, string>;
  warnings: string[];
  /**
   * Typed audit events emitted during extraction. The chat service forwards
   * each one to `logAuditEvent` so extractors can record structured facts
   * (e.g. blocked overwrites, scope-violation safe-fails) without smuggling
   * structured data through the warnings channel.
   */
  auditEvents?: ExtractionAuditEvent[];
  /**
   * The instance this extraction targets (e.g. "hearing::right_ear").
   * Undefined for non-instance-aware extractors and when the instance cannot
   * be determined yet (path or slot unknown). When set, the caller must route
   * facts to `applyInstanceFactsPatch` rather than `applyStructuredExtraction`.
   */
  instanceId?: string;
}

export interface ReadinessResult {
  ready: boolean;
  reason?: string;
  missingFields?: string[];
  clarificationQuestion?: string;
  candidateAnswers?: string[];
  /** Optional typed-answer schema. When set, the chat service writes a
   *  PendingObservation carrying this `expectedAnswer`, so the doctor's
   *  next reply is graduated by the generic resolver in
   *  `pendingObservationResolver.ts` instead of stalling. (Issue #12, RC-5/RC-6)
   */
  expectedAnswer?: PendingObservationExpectedAnswer;
}

export interface BuildProvenance {
  userSupplied: string[];
  builderZeroFilled: string[];
  factsHash: string;
}

export type BuildResult<T> =
  | { ok: true; toolName: string; args: T; warnings: string[]; provenance: BuildProvenance }
  | { ok: false; warnings: string[]; zodErrors?: string[] };

// D9 — assessment render result
export interface AssessmentRenderResult {
  message: string;
  suggestedChips: string[];
  resultSummary: {
    system: GatiodSystemKey;
    side?: "left" | "right";
    finalPercent: number;
    categoryPercents: Record<string, number>;
  };
  fullBreakdown: {
    inputFacts: string[];
    categoryResults: { label: string; rawPercent: number; notes: string[] }[];
    dbeRomConflicts: { joint: string; romPercent: number; dbePercent: number; winner: string }[];
    cvcInputs: number[];
    cvcTrace: string[];
    capsApplied: string[];
    rulesApplied: string[];
    finalPercent: number;
  };
  displayMode: "summary" | "expanded";
}

// D6 — pending-observation resolution result
export interface PendingObservationResolutionResult {
  resolved: boolean;
  blocked: boolean;
  state: V2SessionState;
  system?: GatiodSystemKey;
  observationId?: string;
  clarificationQuestion?: string;
  candidateAnswers?: string[];
  auditEvent?: Record<string, unknown>;
}

// D10 — no-tool-no-PI guard types
export type V2ResponseKind =
  | "clarification"
  | "confirmation"
  | "lookup_only"
  | "assessment_result"
  | "global_result"
  | "error";

export interface V2RenderedResponse {
  kind: V2ResponseKind;
  message: string;
  suggestedChips?: string[];
  toolEvidence?: { toolName: string; status: "executed" | "failed"; success: boolean; resultHash?: string };
  numericClaims: Array<{ label: string; value: number; unit: "%"; authority: "lookup_only" | "assessment_result" }>;
}

// D11 — V2 failure types
export type V2FailureKind =
  | "readiness_failed"
  | "stale_confirmation"
  | "arg_builder_failed"
  | "schema_validation_failed"
  | "tool_execution_failed"
  | "renderer_failed"
  | "guard_failed";

export interface V2FailureResponse {
  kind: "v2_failure";
  failureKind: V2FailureKind;
  message: string;
  suggestedChips: string[];
  allowLegacyFallback: boolean;
  auditRef?: string;
}
