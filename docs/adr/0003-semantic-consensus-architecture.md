---
id: ADR-0003
status: Accepted
sprint_sections:
  - "../v2/sprints.md#sprint-8--semantic-consensus-adr-0003--complete"
---

# 0003 — Semantic consensus architecture

## Status

Accepted (2026-05-13). Slices A–H implemented. Shadow grader wired behind `GATIOD_RUN_SEMANTIC_SHADOW`. V2-809 (Excel batch reporting) is a post-rollout follow-up, not a blocking condition.

## Context

V2 today is a deterministic pipeline: normalize → pending-observation gate → grounding → router → extractor → readiness → confirmation → tool → render. All seven structured-capable systems pass [ADR-0001](0001-structured-live-promotion-gate.md) thresholds at full Excel scale (3,927 rows). Calculation correctness is high.

What V2 does not have is **clinical-language understanding for dense multi-system narratives**. A doctor pasting:

```
Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.
```

today triggers the router on whatever single system wins the keyword/synonym/ontology score, silently dropping the other system. The product needs a layer that proposes "I think this is lower-limb nerve + CNS olfaction, source spans here, missing fields here" and asks the doctor to confirm that interpretation before deterministic extraction runs.

The PRD ([gatiod_holistic_prd.md](../gatiod_holistic_prd.md)) describes the target. This ADR records the architectural decisions that emerged during the 2026-05-10 grilling session and that turn the PRD into something an engineer can implement without further design judgement.

## Decision

The semantic consensus layer is added as a **proposal-only LLM front door** that sits before the existing deterministic V2 pipeline for inputs that need it, and is bypassed entirely for inputs that don't.

### 1. Pipeline placement

```
normalize
→ pending-observation gate     (existing)
→ pending-consensus gate       (new — REQ-SC-RESOLVE-001)
→ shouldRunSemanticConsensus() (new — deterministic, no LLM)
   ├─ true → semantic interpreter → render proposal → STOP
   └─ false → grounding → router → extractor → readiness → confirmation → tool → render
```

`shouldRunSemanticConsensus()` is a deterministic preflight gate — never an LLM call. It uses pending-state checks, local synonym scan for ≥2 detected systems, legacy/deferred signal detection, dense-narrative markers, and low-confidence + unresolved-terms signals. The router still runs in shadow when semantic consensus fires, but its output is audit-only.

### 2. Semantic interpreter contract

The interpreter uses **schema-constrained structured output** (Option A-prime): the model is forced to return a `SemanticInterpretation` JSON object validated by Zod. It is not given access to `assess_*` tools or any function-calling that could execute against the assessment engine. After parsing, the safety validator checks: no `piPercent`, no `toolName`, no `assess_*` reference, `calculationReady` always false, every `sourceSpan` traceable to the original text, candidate systems within the `GatiodSystemKey` enum, legacy systems labelled `legacy_deferred`.

The prompt is assembled at call time from a **registry-backed taxonomy** module (`semanticSystemTaxonomy.ts`) — system status (`structured_supported` vs `legacy_deferred`) is derived from `V2_SYSTEM_REGISTRY.mode`, not hardcoded prose. Clinical signals and source-span examples are curated per system but kept separate from PI tables and CVC formulas, which the interpreter must never see.

### 3. State shape

`V2SessionState` gains three additive fields, all hydrated by `coerceV2State()` for backward compatibility (no DB migration, no `version` bump):

```ts
pendingConsensus: PendingConsensus | null;
claimComponentOverrides: Partial<Record<GatiodSystemKey, ClaimComponentOverride>>;
globalCvcExclusions: Partial<Record<GatiodSystemKey, GlobalCvcExclusion>>;
```

`ClaimAssessmentComponent` (PRD §10.2 / FR-MS-002) is a **derived view model**, not a stored object. The view combines `V2SystemState.status`, pending observations, confirmation, `piPercent`, and `claimComponentOverrides`. The overlay only persists statuses that cannot be derived from `V2SystemState`: `detected`, `legacy_deferred`, `unsupported`, `skipped_by_user`. This avoids the drift risk of a fully parallel claim model.

`skipped_by_user` and `excluded_from_global_cvc` are kept distinct (REQ-GC-EXCLUSION-001). Skip means never assessed; exclusion means assessed-then-omitted-from-CVC. They live in different state fields with different audit events.

`PendingConsensus` carries edit-cycle tracking fields for the edit-cap mechanism (§4):

```ts
interface PendingConsensus {
  interpretationId: string;
  interpretationHash: string;
  sourceHash: string;
  sourceText: string;
  message: string;
  candidateSystems: GatiodSystemKey[];
  candidateFindings: SemanticCandidateFinding[];
  awaiting: "decision" | "edit_instruction";
  revision: number;           // 0 for first proposal, increments after each successful edit
  editAttemptCount: number;   // LLM invocations attempted for this sourceText
  parentInterpretationId?: string;
  lastEditInstruction?: string;
}
```

`ClaimComponentOverride` carries semantic provenance so deferred-extraction turns can reconstruct the accepted context:

```ts
interface ClaimComponentOverride {
  status: "detected" | "legacy_deferred" | "unsupported" | "skipped_by_user";
  reason?: string;
  source?: "semantic_consensus" | "user_choice";
  sourceText?: string;         // pendingConsensus.sourceText at acceptance time
  interpretationId?: string;   // for cleanup on edit reset and dedup
  sourceHash?: string;
  acceptedFindings?: SemanticCandidateFinding[];  // filtered to this system
  createdAt: string;
  updatedAt: string;
}
```

**Binding rule:** `detected` overrides are written **only at acceptance time**, never during the proposal or edit phases. This keeps edit-cycle full resets clean — there is nothing to undo until the doctor explicitly accepts.

### 4. Consensus resolver

The resolver is **deterministic** (REQ-SC-RESOLVE-001). It resolves the doctor's reply to one of: `accepted_all`, `accepted_system_first`, `edit_requested`, `rejected`, `legacy_requested`, `skipped_system`, `unresolved`. Priority order is fixed so specific actions win over generic affirmation. System parsing reuses the shared `detectExplicitSystemSelection` helper, constrained to `pendingConsensus.candidateSystems` (the doctor cannot accidentally jump to a system the interpretation didn't propose).

`accepted_system_first` is an **ordering decision, not a full-extract-all decision**. "Hearing first" means "I accept the whole interpretation; extract hearing this turn." Other accepted structured-capable systems are written into `claimComponentOverrides` as `detected` (source `semantic_consensus`); `buildNextClaimStep` routes the doctor to them on subsequent turns. Accepted legacy systems are written as `legacy_deferred` immediately. This is the **Option B fan-out model** — one extraction target per turn, claim-plan-driven thereafter.

`ConsensusResolutionResult` carries `targetSystem` and `selectedScope` so the orchestrator does not re-derive them:

```ts
interface ConsensusResolutionResult {
  resolved: boolean;
  action: ConsensusResolutionAction;
  state: V2SessionState;
  targetSystem?: GatiodSystemKey;
  selectedScope?: ExtractionContext["selectedScope"];
  response?: { message: string; chips?: string[]; stopPipeline: boolean };
  auditEvent?: { eventType: string; payload: Record<string, unknown> };
}
```

For spine proposals, the resolver detects the requested region from the reply text using `detectSpineScopesFromText` (from `src/v2/spineScope.ts`) and builds `selectedScope` from the matching `pendingConsensus.candidateFindings`. Chip labels are not the canonical key — any phrasing containing the region term resolves correctly. If the doctor's reply is "Proceed" on a multi-region spine proposal, the resolver re-renders region selection rather than emitting a substitute signal.

**Edit-cycle cap.** The LLM is invoked at most once per turn for re-interpretation (when `pendingConsensus.awaiting === "edit_instruction"`). The total cap is `MAX_SEMANTIC_EDIT_ATTEMPTS = 2` LLM invocations per original `sourceText`. After the cap is reached, the resolver returns a hard-choice response regardless of the edit instruction. Edit-cycle resets are **full resets** (Option C): the new `PendingConsensus` replaces the old wholesale; `revision` increments; any provisional `semantic_consensus` overrides linked to the discarded `interpretationId` are cleared. Failed LLM calls (schema failure, safety failure, empty result) count against `editAttemptCount` if the LLM was actually invoked; infrastructure failures (network error before dispatch, feature flag off) do not.

### 5. Extraction context

Accepted semantic context flows into deterministic extractors as a **fourth optional `ExtractionContext` parameter** on `StructuredExtractor`. It is explicit, ephemeral, and read-only. It is not stored in `V2SystemState` (which is the calculation source of truth) and not encoded into `NormalizedUtterance` (which is normalizer output).

```ts
interface ExtractionContext {
  consensusId: string;
  sourceText: string;
  sourceHash: string;
  acceptedSystems: GatiodSystemKey[];
  acceptedFindings: SemanticCandidateFinding[];
  targetSystem?: GatiodSystemKey;     // single extraction target this turn
  focusSystem?: GatiodSystemKey;      // optional ordering bias for claim-plan
  selectedScope?: {
    system: GatiodSystemKey;
    scopeType: "spine_region" | "laterality" | "organ" | "anatomical_subregion";
    scope: string;
    sourceSpans: Array<{ text: string; startOffset: number; endOffset: number }>;
  };
}
```

`selectedScope` is **generic in the contract** but **spine-only in Slice G**. When set, the spine extractor builds its effective parse text by joining `selectedScope.sourceSpans[].text` and re-normalising — this is `buildScopedNormalizedUtterance()` in `src/v2/spineScope.ts`. The multi-region hard guard still runs against the scoped text; if a bad scope accidentally contains multiple regions, the guard fires. `acceptedFindings` may guide pending observations (e.g. populate the proposed mapping in a `semantic_mapping_gap` obs) but **must not write `extractedFacts` directly**.

**Spine scope vocabulary** is shared across gate, renderer, resolver, and extractor via `src/v2/spineScope.ts` (`SpineScopeDefinition`, `detectSpineScopesFromText`, `buildSpineScopeChips`, `buildScopedNormalizedUtterance`, `buildSelectedSpineScopeFromPendingConsensus`). Duplicating the region regexes across files is not permitted.

**Deferred extraction for non-target accepted systems.** When `buildNextClaimStep` later routes to a system whose `claimComponentOverride.source === "semantic_consensus"` and `status === "detected"`, `chatServiceV2` re-extracts that system against `override.sourceText` (the original accepted narrative) rather than the doctor's current message — but **only when the current utterance is a workflow continuation** (e.g. "Continue with Spine", "Next"). If the utterance contains clinical signals, it is treated as new content and processed normally. The `looksLikeClinicalContent` check (presence of clinical terms, measurement patterns, unresolved normalizer tokens) gates this decision. Merging old source text with new clinical content is deferred to a follow-up (P1).

### 6. Proposal rendering

The renderer classifies each interpretation before choosing a message template and chip set:

```ts
type SemanticProposalKind =
  | "empty"
  | "single_system"
  | "single_legacy"
  | "multi_scope_spine"   // spine-ONLY proposal with ≥2 spine regions
  | "mixed_structured_legacy"
  | "multi_system";
```

Classification priority: empty → single\_legacy → single\_system → multi\_scope\_spine (spine-only) → mixed\_structured\_legacy → multi\_system. `multi_scope_spine` applies **only when all non-legacy systems are spine**; a proposal containing spine and any other structured system classifies as `multi_system` and defers region selection to after the doctor focuses on spine.

Chip matrix:

| Proposal kind | Chips |
|---|---|
| `single_system` | `["Proceed", "Edit interpretation", "Reject"]` |
| `single_legacy` | `["Proceed with legacy mode", "Edit interpretation", "Reject"]` |
| `multi_scope_spine` | `["Assess Cervical spine first", "Assess Lumbo-Sacral spine first", …, "Edit interpretation", "Reject"]` — no generic "Proceed" |
| `mixed_structured_legacy` | `["Proceed", "Assess <structured> first", "Use legacy for <legacy>", "Edit interpretation", "Reject"]` |
| `multi_system` (≤3) | Explicit `"Assess X first"` chips per system + `"Proceed"`, `"Edit interpretation"`, `"Reject"` |
| `multi_system` (4+) | `["Proceed", "Choose system first", "Edit interpretation", "Reject"]` |

Legacy-deferred systems are always visible in the proposal before acceptance so the doctor can correct wrong legacy attribution.

### 7. Semantic-attributed pending observations

`semanticAttribution` on `PendingObservation` is reserved for **true semantic mapping gaps** — cases where accepted consensus exists for a system but the deterministic extractor produced neither `extractedFacts` nor a meaningful system-specific pending observation from the accepted source text. Normal missing-field clarifications (e.g. hearing identified, AHL not in source text) remain plain pending observations with no attribution.

Detection is two-tier: (1) the extractor may explicitly emit a `"semantic_mapping_gap"` pending observation; (2) `chatServiceV2` synthesizes one as a fallback when `extractionContext` is present and the extraction result is empty. The `semantic_to_structured_extraction_failed` audit event fires **immediately** when the gap is created, not at abandonment. A separate `semantic_gap_abandoned_by_user` event fires if the doctor later abandons the system.

Failure kind taxonomy:

```ts
type SemanticMappingFailureKind =
  | "missing_calculation_field"
  | "unmapped_canonical_term"
  | "ambiguous_mapping"
  | "unsupported_in_structured_v2"
  | "extractor_no_match";
```

Dedup key: `consensusId:system:sourceSpan:proposedMapping`.

### 8. Unified claim plan

`buildNextSystemHandoff` is replaced by `buildNextClaimStep`, which reads from `deriveClaimAssessmentComponents`. The compact 2-system handoff message is one rendering mode of the unified plan; the structured 3+ system plan is another. This is the only orchestration mechanism the app has, eliminating the drift risk of two parallel "what's next" functions and ensuring legacy-deferred / unsupported / skipped systems never disappear from the plan.

## Alternatives considered

- **Pure deterministic gate vs. LLM pre-classifier for `shouldRunSemanticConsensus()`** — rejected the LLM pre-classifier because it adds non-determinism and cost to a function that runs on every message. Deterministic preflight handles dense-narrative detection well enough at zero LLM cost.
- **Tool/function calling for the semantic interpreter** — rejected because exposing any callable surface to the semantic LLM risks accidentally executing assessment tools. Schema-constrained structured output gets the same JSON reliability without the execution risk.
- **Prompt-only JSON output (Option C)** — rejected as primary because it weakens the safety boundary for a medico-legal workflow. Kept as the fallback when the model provider doesn't support schema-constrained output.
- **Hardcoded taxonomy in the prompt prose** — rejected because system status (legacy / shadow / live) lives in `V2_SYSTEM_REGISTRY` and would drift from the prompt without a generated section. The taxonomy module is keyed by `GatiodSystemKey` so a registry mode flip propagates automatically.
- **Fully stored `claimComponents`** — rejected because it duplicates `V2SystemState.status` and creates a drift surface. Thin overlay + derivation is enough.
- **Expanding `V2SystemStatus` to 9 values** — rejected because the new claim-level concepts (`detected`, `skipped_by_user`, `legacy_deferred`, `unsupported`) are at a different abstraction level than the existing extraction/calculation states. Mixing them would force every extractor and readiness validator to understand claim-level orchestration concepts they don't need.
- **LLM intent classifier for consensus replies** — rejected because the resolution space is bounded (six branches, chip-driven). Deterministic parsing is safer and faster.
- **Multi-pass extraction on acceptance (Option A)** — rejected in favour of Option B (one extraction per turn, fan-out via claim plan). Multi-pass in one turn creates competing UI states (spine confirmation pending + hearing needs AHL + renal collecting) that `buildNextClaimStep` cannot resolve to a single coherent next action.
- **Additive merge on edit-cycle re-interpretation (Option B for edits)** — rejected in favour of full reset (Option C). An additive merge preserves systems the doctor has just repudiated, creating stale `detected` overrides. The doctor's edit instruction means "the previous interpretation is not consented to."
- **Scope-aware multi-region guard in the spine extractor (Option B for `selectedScope`)** — rejected for Slice G. It requires the extractor to reason about in-scope vs out-of-scope regions and adds a new bug class. `selectedScope` narrows the parse text to the authorised span; the guard still runs on that scoped text.
- **Semantic findings directly creating `extractedFacts` (Option C for `acceptedFindings`)** — explicitly rejected. `acceptedFindings` may guide clarification questions but must not bypass deterministic extraction and readiness validation.
- **`multi_scope_spine` classification outranking `multi_system`** — rejected. A proposal containing spine and any other structured system must show the full picture before acceptance; collapsing it to a spine-only region picker hides accepted non-spine findings.

## Consequences

- The PRD's P0 backlog grows from 7 items to 14, all required to ship together for safe rollout. P1 covers production trust (shadow runner, CVC re-offer on exclusion change, edit-cycle re-interpretation, registry alignment, audit dashboard).
- The implementation follows eight slices (A→H, see PRD §25). The critical dependency is that the consensus resolver (D) and unified claim plan (B) must exist before the semantic interpreter is user-visible (F). Skipping this ordering would create accepted systems the app cannot resolve or remember.
- `getCalculatedSystems()`, the spine extractor, the registry type, and `chatServiceV2.ts` all change. None of these changes are user-visible behaviour changes by themselves (Slice A is contract-only); the user-visible change happens at Slice F.
- Two test tiers: fast semantic goldens (default CI, no LLM, validate contracts) and slow semantic shadow (opt-in via `GATIOD_RUN_SEMANTIC_SHADOW=true`, real LLM, grade interpretation quality). The shadow runner mirrors the ADR-0001 evidence pattern but with semantic-specific outcome classes.
- Auditability gains: every semantic decision (proposal created, accepted, edited, rejected, legacy-requested, skip), every claim-component transition, every Global CVC exclusion/re-inclusion, and every semantic/deterministic disagreement emits a typed audit event with a structured payload.

### Known contradictions in existing code (must be fixed before Slice F ships)

Four places in the current codebase contradict the decisions above:

1. **`ExtractionContext.focusSystem` comment** says "other accepted systems are still extracted; focus only affects rendering order." This is Option A language. Replace with: "other accepted structured systems are written as `detected` overrides; focus only affects claim-plan ordering."

2. **`consensusResolver.ts` — `accepted_system_first` branch** applies `legacy_deferred` overrides for legacy candidates but does not apply `detected` overrides for non-target structured candidates. Add the structured fan-out loop.

3. **`renderSemanticConsensus()`** always emits generic chips `["Proceed", "Edit interpretation", "Choose system first", "Reject"]` regardless of proposal kind. Replace with proposal-kind-specific templates per §6.

4. **`classifySemanticProposal()`** (if added before this fix) evaluates `multi_scope_spine` before the multi-system check, causing mixed proposals to be misclassified. The corrected priority is: empty → single\_legacy → single\_system → multi\_scope\_spine (spine-only only) → mixed\_structured\_legacy → multi\_system.

### New file required before Slice F

`src/v2/spineScope.ts` must exist and export `SpineScopeDefinition`, `SpineScopeKey`, `detectSpineScopesFromText`, `buildSpineScopeChips`, `getSpineScopeLabel`, `buildScopedNormalizedUtterance`, `buildSelectedSpineScopeFromPendingConsensus`. The gate, renderer, resolver, and spine extractor must all import from this module; no local copies of spine-region patterns are permitted.

## References

- [gatiod_holistic_prd.md](../gatiod_holistic_prd.md) — full target architecture.
- [ADR-0001](0001-structured-live-promotion-gate.md) — promotion gate that the semantic shadow runner will eventually mirror.
- [ADR-0002](0002-cns-visual-structured-migration.md) — CNS/Visual remain `legacy_deferred`; the semantic layer recognizes them but does not produce structured PI%.
- [CONTEXT.md](../../CONTEXT.md) — glossary additions for semantic consensus, claim plan, override states, extraction context.
