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
    | "other";
  sourceText: string;
  parsed: Record<string, unknown>;
  missingFields: string[];
  clarificationQuestion: string;
  candidateAnswers?: string[];
  createdAt: string;
  updatedAt: string;
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
