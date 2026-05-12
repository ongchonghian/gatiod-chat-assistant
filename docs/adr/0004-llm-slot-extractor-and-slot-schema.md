# 0004 — LLM slot extractor and slot schema

## Status

Proposed (2026-05-11).

## Context

V2's structured extractors (`src/v2/extractors/[system].ts`) are nine files of ~25–34 K each — predominantly hardcoded regex pattern tables. These patterns encode two distinct concerns:

1. **NLP** — recognising all phrasings a doctor might use ("ninety degrees", "ROM: flex 60/90", "limited to less than a right angle").
2. **Schema** — knowing which fact keys are valid, what values they accept, and which clinical fields must never be inferred (D2).

Regex is adequate for concern 2 but brittle for concern 1. Every novel phrasing is a miss; every miss becomes an unnecessary `PendingObservation` that interrupts the doctor. Calibration evidence from the Excel shadow runner shows extraction misses clustering around word-form variants, abbreviations, and implicit idioms — not schema violations.

At the same time, the D2 inference boundary (ROM direction, deficit type, loss type, severity bracket, ASIA grade, diplopia zone, final PI%) is enforced implicitly inside each extractor's regex logic, not expressed as a typed contract. The same boundary is re-implemented — inconsistently — in readiness validators (when to ask) and the pending observation resolver (how to answer). Three representations of one rule.

Two additional friction points emerged from the architecture review:

- `SlotSignals` (`contracts.ts:1–72`) and `extractedFacts` share key names (`side`, `cns_section`, etc.) with different semantics. There is no type-level guard preventing code or agents from conflating "is side present?" (boolean signal) with "what is the side value?" (typed fact).
- The `required_when` logic in readiness validators is imperative, per-system, and not derivable from any shared contract — meaning adding a new slot requires edits in three separate files (extractor, readiness validator, arg builder) with no shared source of truth.

This ADR records the decisions from the 2026-05-11 grilling session that address these friction points.

## Decision

### 1. Slot schema as a required `V2SystemCapability` component

A `SlotDefinition[]` is added as `slotSchema` to `V2SystemCapability` in `src/v2/systemRegistry.ts`. It is required for all `structured_live` systems and validated at startup by `validateSystemRegistry()`:

```typescript
export interface V2SystemCapability {
  system: GatiodSystemKey;
  mode: SystemMigrationMode;
  slotSchema?: SlotDefinition[];          // required for structured_live
  extractor?: StructuredExtractor;
  readinessValidator?: ReadinessValidator;
  argBuilder?: ToolArgBuilder;
  resultRenderer?: ResultRenderer;
}
```

`validateSystemRegistry()` gains a `slotSchema` check alongside the existing four component checks. A system missing its schema fails startup before accepting any request.

**File location:** Slot schema definitions live in `src/v2/slotSchemas/[system].ts` — one file per system, parallel to `extractors/`, `readiness/`, and `argBuilders/`. The registry imports and wires them, exactly as it does for the other components. This gives consumers testability (import from the schema file directly) and centralization (all per-system components reached via `requireStructuredCapability(system).slotSchema`).

### 2. `SlotDefinition` type shape

```typescript
interface SlotClarification {
  question: string;
  candidateAnswers: string[];
  expectedAnswer: PendingObservationExpectedAnswer;
}

interface SlotDefinition<TKey extends string = string> {
  factKey: TKey;
  label: string;              // human-readable; used in LLM prompt and confirmation UI
  description: string;        // tells the LLM what to look for in the utterance
  valueType: "string" | "number" | "boolean" | "enum";
  allowedValues?: string[];   // valid enum values; used for validation and chip generation
  unit?: string;              // "degrees", "%", "cm" — context for LLM and UI
  clinicalInferenceAllowed: boolean;
  clarification?: SlotClarification; // required when clinicalInferenceAllowed: false
  required_when: SlotCondition<TKey>;
}
```

### 3. `required_when` condition language

`SlotCondition` is **parameterised by the system's own fact keys** (`TKey`). This is a compile-time guarantee: a condition cannot reference a key that is not a `SlotDefinition.factKey` for that system. `PresenceSignals` keys (see §5) can never appear in a `SlotCondition` — the type parameter prevents it.

```typescript
type SlotCondition<TKey extends string> =
  | "always"
  | "never"
  | { fact: TKey; eq: unknown }
  | { fact: TKey; in: unknown[] }
  | { fact: TKey; present: true }
  | { and: SlotCondition<TKey>[] };
```

No `OR` or `NOT` variants — surveying all nine systems' readiness logic shows no case that requires them. Complex multi-branch conditions (e.g. CNS Section B's sub-conditions) may remain in their readiness validator imperatively in the first pass, with a migration path once the pattern is validated.

`deriveReadinessValidator<TKey>(defs: SlotDefinition<TKey>[], facts: V2SystemFacts): ReadinessResult` evaluates every slot's `required_when` against `extractedFacts`. Its signature accepts only `extractedFacts` — never `PresenceSignals`. Per-system readiness validators become thin wrappers or are replaced outright as the schema matures.

### 4. `clinicalInferenceAllowed: false` — clarify, never guess

When a slot has `clinicalInferenceAllowed: false` and the extractor (LLM or regex) cannot extract the field from a verbatim term or recognised synonym in the source text, the extractor **must emit a `PendingObservation`** using the slot's `clarification` spec. It must not return `null`, it must not guess, and it must not use contextual implication (e.g. "limited to" implying "loss" direction).

The `clarification` field carries the question string, the candidate answer chips, and the `expectedAnswer` schema for the generic resolver (`pendingObservationResolver.ts:resolveByExpectedAnswer`). This is the **single definition** of that clarification — currently duplicated across readiness validators (generate the question), extractors (build the `PendingObservation`), and the resolver (match the answer).

`clarification` is required on every slot where `clinicalInferenceAllowed: false`. A slot with `clinicalInferenceAllowed: false` and no `clarification` is a schema validation error caught by `validateSystemRegistry()`.

### 5. `PresenceSignals` boundary

`SlotSignals` (`contracts.ts`) is renamed to `PresenceSignals` in a single follow-on refactor pass. The rename makes the semantic distinction visible in code: **signals** are boolean presence flags set by the structured extractor; **facts** are typed values in `extractedFacts`. Both remain in the codebase — `PresenceSignals` are still consumed by the slot evaluator for `legacy` and `structured_shadow` systems.

Two enforcement mechanisms prevent conflation:

- **Type-level (app):** `SlotCondition<TKey>` is parameterised by fact keys only. Referencing a `PresenceSignals` key in a `required_when` condition is a compile error.
- **Naming (agents):** `PresenceSignals` carries a JSDoc note: *"Presence flags set by the structured extractor. Not used by `deriveReadinessValidator`, which reads `extractedFacts` directly."*

### 6. LLM slot extractor — Approach A (raw text → slots)

The LLM slot extractor replaces the regex pattern tables as the implementation behind the existing `StructuredExtractor` seam. The interface (`contracts.ts:StructuredExtractor`) and output shape (`StructuredExtractionResult`) are unchanged — the LLM extractor is a drop-in implementation.

**Input:** raw utterance text + the system's `SlotDefinition[]` (from the registry). The LLM is not given PI tables, CVC formulas, or `assess_*` tool access.

**Output:** the same `StructuredExtractionResult` contract — `extractedFactsPatch`, `pendingObservationsToAdd`, `slotSignalsPatch`, `displayValuesPatch`, `warnings`.

**Approach A** (raw utterance text → slots directly) is selected over **Approach B** (semantic interpreter findings → slots). Approach B only fires when the semantic consensus gate triggers, leaving single-system turns — the majority of utterances — on the regex path unchanged. Approach A closes the accuracy gap on every turn.

**Accuracy mechanism:** "100% accuracy" is achieved not by requiring a perfect LLM, but by the LLM knowing when it is uncertain and the system knowing how to ask. High-confidence extractions with verifiable source spans graduate to `extractedFacts`. Low-confidence extractions and `clinicalInferenceAllowed: false` fields emit `PendingObservation` with prefilled chips. The doctor's reply resolves the observation via the generic expected-answer resolver.

**Migration path:** The LLM extractor runs in `structured_shadow` mode first (`GATIOD_EXTRACTOR_SHADOW=true`). Shadow output is logged but never updates state. Accuracy is measured against the existing calibration workbook (ADR-0001 evidence pattern) before promotion to `structured_live`. Regex extractors are retained as shadow comparison runners until accuracy thresholds are met, then deleted.

## Alternatives considered

- **LLM as grounding step over semantic findings (Approach B)** — rejected because it only improves accuracy for multi-system / dense-narrative turns where the semantic interpreter already fired. Single-system turns (the majority) remain on regex. Approach A closes the gap everywhere at the cost of one additional LLM call per extracting turn.
- **Augment regex with LLM fallback (hybrid)** — rejected because it maintains two code paths (regex and LLM) with no clear promotion gate between them. The accuracy measurement becomes ambiguous: are failures regex misses or LLM misses? Clean replacement with shadow calibration is more auditable.
- **Keep `required_when` in readiness validators only (Option A)** — rejected because the same condition is re-implemented in three places (extractor, readiness validator, resolver). The slot schema as a single source of truth (Option B) removes the duplication and makes derivation possible.
- **OR / NOT in `SlotCondition`** — deferred. No current system requires it. Re-open if a new system introduces a condition that cannot be expressed as `AND` of `eq/in/present` clauses.
- **Slot schema in `src/v2/slotSchemas/` only (Option A placement)** — rejected as the primary location because it creates a fourth import location for per-system components. The registry (`V2SystemCapability.slotSchema`) is the correct home; schema files live in `slotSchemas/` and are imported by the registry, matching the pattern for all other components.

## Consequences

- `V2SystemCapability` gains a `slotSchema` field. `validateSystemRegistry()` enforces its presence for `structured_live` systems. **No change to `V2SystemState` shape or DB.**
- `SlotSignals` is renamed to `PresenceSignals` in a single follow-on pass. All existing consumers update their import; behaviour is unchanged.
- `deriveReadinessValidator` is a new shared function. Per-system readiness validators migrate to it incrementally — starting with `respiratory` and `renal` (the simplest condition sets), finishing with `cns` (the most complex). Legacy validators are kept until migration is complete.
- The `clarification` spec on `SlotDefinition` becomes the single definition for all PendingObservation clarification logic. Redundant clarification construction in readiness validators and extractors is removed as each system's schema is written.
- One additional LLM call per extracting turn (Approach A). Latency impact to be measured in `structured_shadow` before promotion.
- Implementation sequence: (1) `SlotDefinition` type + `slotSchemas/upperLimb.ts` pilot, (2) `deriveReadinessValidator` backed by pilot schema, (3) LLM extractor for upper_limb in `structured_shadow`, (4) calibration run, (5) promotion to `structured_live`, (6) remaining systems in order of complexity.

## References

- [architecture-decisions.md](../v2/architecture-decisions.md) — D2 (inference boundary), D3 (pending observations), D5 (shadow mode), D12 (system registry single source of truth), D14 (typed expected-answer schemas).
- [ADR-0001](0001-structured-live-promotion-gate.md) — calibration thresholds the LLM extractor must meet before promotion.
- [ADR-0003](0003-semantic-consensus-architecture.md) — semantic interpreter that runs upstream; LLM slot extractor is downstream of it and independent.
- [contracts.ts](../../src/v2/contracts.ts) — `StructuredExtractor`, `StructuredExtractionResult`, `PendingObservation`, `ExtractedFact` types.
- [systemRegistry.ts](../../src/v2/systemRegistry.ts) — `V2SystemCapability`, `validateSystemRegistry()`.
