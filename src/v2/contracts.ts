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
}

export type V2SystemStatus = "idle" | "collecting" | "needs_confirmation" | "calculated";

export interface V2SystemState {
  status: V2SystemStatus;
  completeness: number;
  pendingFields: string[];
  slotSignals: Partial<SlotSignals>;
  /** Human-readable extracted values per slot key, accumulated across turns. */
  extractedValues: Record<string, string>;
  piPercent: number | null;
  updatedAt: string;
}

export interface PendingConfirmation {
  system: GatiodSystemKey;
  summary: string;
  createdAt: string;
}

export interface V2SessionState {
  version: 1;
  systems: Record<GatiodSystemKey, V2SystemState>;
  pendingClarification: string | null;
  pendingConfirmation: PendingConfirmation | null;
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
