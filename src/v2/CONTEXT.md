# V2 Pipeline

The deterministic structured assessment pipeline. Receives a normalized utterance, extracts calculation-grade facts, validates readiness, builds validated tool arguments, executes the engine, and renders results. The root `CONTEXT.md` defines the domain terms (extracted fact, pending observation, confirmation snapshot, semantic consensus, etc.); this file defines the pipeline components that handle those concepts.

## Language

### Per-system capability components

**Slot schema**:
A `SlotDefinition[]` declared in `src/v2/slotSchemas/<system>.ts` and registered as `V2SystemCapability.slotSchema`. Required for all `structured_live` systems; validated at startup by `validateSystemRegistry()`. The single source of truth for: which fact keys a system owns, their types and allowed values, the D2 inference boundary (`clinicalInferenceAllowed`), and the clarification spec (`question`, `candidateAnswers`, `expectedAnswer`) used when a field cannot be extracted verbatim. Three consumers — the structured extractor, `deriveReadinessValidator`, and the arg builder — all read from the same schema.
_Avoid_: "slot config", "field definitions", "extraction schema"

**`SlotDefinition`**:
One entry in a slot schema. Shape: `{ factKey, label, description, valueType, allowedValues?, unit?, clinicalInferenceAllowed, clarification?, required_when }`. `required_when` is a `SlotCondition<TKey>` parameterised by the system's own fact keys — compiler-enforced, cannot reference `PresenceSignals` keys.

**`SlotCondition`**:
The condition language for `required_when`. Variants: `"always" | "never" | { fact, eq } | { fact, in } | { fact, present } | { and: SlotCondition[] }`. No `OR` or `NOT` — not needed by any current system.

**`deriveReadinessValidator`**:
A shared function in `src/v2/slotSchemas/deriveReadinessValidator.ts`. Takes `(defs: SlotDefinition<TKey>[], facts: V2SystemFacts)` and evaluates every slot's `required_when` against `extractedFacts`. Accepts only `extractedFacts` — never `PresenceSignals`. Per-system readiness validators migrate to this incrementally; the imperative validators are kept until migration is complete.
_Avoid_: "generic readiness checker", "condition evaluator"

**Structured extractor**:
A per-system function (`src/v2/extractors/<system>.ts`) that turns a normalized utterance into a `StructuredExtractionResult`. In the target architecture (ADR-0004), backed by an LLM call using the system's slot schema rather than regex pattern tables. Enforces the D2 inference boundary — never infers clinical fields that must be stated; emits a `PendingObservation` with the slot's `clarification` spec when a D2-forbidden field cannot be extracted verbatim.
_Avoid_: "extractor", "parser" (too generic)

**StructuredExtractionResult**:
The output shape of a structured extractor: `{ extractedFactsPatch, pendingObservationsToAdd, pendingObservationsToResolve, slotSignalsPatch, displayValuesPatch, warnings }`. A patch, not a full replacement.

**Readiness validator**:
A per-system function (`src/v2/readiness/<system>.ts`) that checks whether `extractedFacts` is sufficient to build tool arguments. Returns `{ ready: true }` or `{ ready: false, reason, blockingFields }`.

**Arg builder**:
A per-system function (`src/v2/argBuilders/<system>.ts`) that converts `extractedFacts` into a validated tool argument object. Runs `<Schema>.safeParse` before returning `ok: true`. Returns `ok: false` with Zod messages on failure.

**Result renderer**:
A per-system function (`src/v2/renderers/<system>Result.ts`) that converts a tool execution result into a doctor-facing `AssessmentRenderResult`. Progressive by default — summary visible, full breakdown expandable. Auto-expands on exceptions (DBE/ROM conflict, bilateral involvement).

### Registry and migration

**System registry**:
`src/v2/systemRegistry.ts` — the single source of truth for each system's migration mode and wired capability components. `policyEngine.ts` and `chatServiceV2.ts` import from it; no other file sets migration modes.

**Migration mode**:
One of `"legacy" | "structured_shadow" | "structured_live"`. Determines which pipeline path runs for a system.

**structured_shadow**:
Mode where the structured pipeline runs in parallel with legacy, outputting to audit logs only. Legacy response is shown to the doctor. Used to collect calibration evidence before promotion.
_Avoid_: "shadow mode", "parallel mode"

**structured_live**:
Mode where the structured pipeline is the authoritative path. Legacy is not called unless the doctor explicitly requests fallback (D11). A system must meet ADR-0001 calibration thresholds before being promoted.

**PROVISIONAL_STRUCTURED_LIVE**:
An allowlist of systems that are `structured_live` but have not yet satisfied their ADR-0001 calibration gate. Existence on this list is temporary; it blocks CI only for fresh evidence that is below threshold.

### Pipeline gates

**Policy engine**:
`src/v2/policyEngine.ts` — decides what to do next given the current session state. Returns one of: `execute_tools`, `clarify`, `delegate_legacy`, `await_confirmation`.

**State machine**:
`src/v2/stateMachine.ts` — owns `V2SessionState` shape, `defaultV2SessionState()`, and `coerceV2State()` (the hydration boundary that handles missing nullable fields from older sessions).

**PresenceSignals** (formerly `SlotSignals`):
Boolean presence flags set by the structured extractor via `StructuredExtractionResult.slotSignalsPatch`. Semantically distinct from `extractedFacts`: a `PresenceSignal` answers "is this category present?" (boolean); a fact answers "what is the value?" (typed). Key names overlap between the two (e.g. `cns_section`) — `SlotCondition<TKey>` prevents conflation at the type level. `PresenceSignals` are retained for `legacy` and `structured_shadow` systems; `deriveReadinessValidator` reads only `extractedFacts` and never touches them.
_Avoid_: "SlotSignals" (old name), "signals" without qualifier

**Slot evaluator**:
`src/v2/slotEvaluator.ts` — the legacy per-system signal and value extractor. **Must not run** for `structured_live` systems; those get signals exclusively from `StructuredExtractionResult.slotSignalsPatch`. Retained for `legacy` and `structured_shadow` systems.

**Pending-observation gate**:
The pipeline step that runs before routing on every turn. If `pendingObservations.length > 0`, the gate attempts to resolve them before proceeding. Blocks the entire pipeline if any observation remains unresolved.

**Generic expected-answer resolver**:
The mechanism by which pending observations with a declared `expectedAnswer` field (enum-typed questions) are graduated to extracted facts automatically when the doctor's chip response matches. No extractor re-run needed.

### Consensus pipeline

**Consensus orchestrator**:
`src/v2/consensusOrchestrator.ts` — coordinates between semantic interpreter and doctor reply. Dispatches to the consensus resolver after the semantic interpreter proposes.

**Consensus resolver**:
`src/v2/consensusResolver.ts` — deterministic parser for doctor replies to a semantic proposal. Implements the six resolution branches (accepted_all, accepted_system_first, edit_requested, rejected, legacy_requested, skipped_system).

**Semantic gate**:
`shouldRunSemanticConsensus()` in `src/v2/semanticConsensusGate.ts` — deterministic, LLM-free preflight classifier that decides whether to invoke the semantic interpreter for this turn.

**Semantic attribution**:
`src/v2/semanticAttribution.ts` — detects findings accepted by the doctor in the semantic consensus that were not successfully extracted by the structured extractor, and converts them to pending observations with `semanticAttribution` metadata.

### Calibration

**Calibration report**:
The output of the Excel shadow runner for a system — records `sampleSize`, `componentSafeOutcomeRate`, and `exactCalculationRate`. The promotion gate reads this before allowing a system to be `structured_live`.

**Excel shadow runner**:
The script (`scripts/calibration/`) that reads `.xlsx` workbook scenarios, drives the V2 pipeline, and produces calibration reports. Distinct from the in-CI shadow test suite.

## Relationships

- **Structured extractor** → produces **StructuredExtractionResult** → patches `extractedFacts` + `pendingObservations`
- **Readiness validator** reads only `extractedFacts` (never pending observations)
- **Arg builder** reads only `extractedFacts` and must not call the engine directly
- **Result renderer** receives the engine tool result, not `extractedFacts`
- **System registry** wires all four capability components together; **policy engine** reads from it
- **Slot evaluator** is bypassed entirely for `structured_live` systems
- **Semantic gate** → **Consensus orchestrator** → **Consensus resolver** → extraction (if accepted)

## Example dialogue

> **Dev:** "When a system is in `structured_shadow` mode, does the doctor see the structured output?"
> **Domain expert:** "No. Shadow output goes to audit logs only. The doctor sees the legacy response. We're just collecting calibration evidence in the background."

> **Dev:** "Can the arg builder call the engine to validate its output?"
> **Domain expert:** "No. It runs `safeParse` against the engine's Zod schema — that's the validation. If schema validation passes, it returns `ok: true`. The engine call itself is `policyEngine`'s job."

## Flagged ambiguities

- "Shadow mode" — used loosely to refer to both `structured_shadow` migration mode and the Excel shadow runner. These are distinct: migration mode is a registry setting; the shadow runner is a test script.
- "Extractor" — may refer to the structured extractor (`src/v2/extractors/`) or the legacy slot evaluator. Prefer "structured extractor" or "slot evaluator" to disambiguate.
