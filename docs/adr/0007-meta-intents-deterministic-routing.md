---
id: ADR-0007
status: Proposed
sprint_sections:
  - "../v2/sprints.md#sprint-12--multi-system-claim-completion-adr-0006-adr-0007"
---

# 0007 — Meta-intents as a deterministic, LLM-free routing class

## Status

Proposed (2026-05-13). Captures decisions from the multi-system claim completion grilling session. Implementation tracked in [.scratch/multi-system-claim-completion/PRD.md](../../.scratch/multi-system-claim-completion/PRD.md), issue slice #10.

## Context

V2's router (`src/v2/router.ts`) handles four operations: `lookup`, `assessment`, `global_cvc`, `clarify`. Every utterance flows through the deterministic preflight ([ADR-0003](0003-semantic-consensus-architecture.md)) and either gets handled by the semantic interpreter or routed via keyword/synonym scoring to a structured extractor.

This architecture works well for *clinical content* — descriptions of injuries, measurements, severity. It does not handle *navigation* utterances cleanly. When a doctor says "where are we", "skip CNS", "go back to upper limb", or "submit", the existing pipeline either:

- Misclassifies as a clinical utterance and asks for clarification.
- Hands to the LLM, which non-deterministically interprets the intent.
- Falls through to the router and emits a routing decision that doesn't match the doctor's actual intent.

The multi-system completion work introduces three new navigation actions: status, skip system, jump to system, finalise. Each must be:

- Auditable (the doctor's intent must be recoverable from the session log).
- Latency-cheap (status requests should not pay the cost of an LLM call).
- Determinism-preserving (the whole point of the existing pipeline is to keep the LLM out of consequential decisions).

There is no existing routing path that satisfies all three properties for navigation. The grilling session considered four options for how navigation should be recognised: deterministic regex + chips, chip-only, LLM-classify-first, or chip-primary with narrow regex for high-value intents.

## Decision

Introduce **meta-intents** as a new routing class: navigation actions recognised by a deterministic regex set, dispatched to typed handlers, never routed through the LLM. Chip clicks emit meta-intents directly; free-text utterances are classified by regex before the existing router runs; misses fall through to normal routing.

### 1. RouteOperation extension

```ts
type RouteOperation =
  | "lookup" | "assessment" | "global_cvc" | "clarify"
  | "meta"              // this ADR
  | "finalise_claim";   // ADR-0006
```

`meta` is a top-level operation, distinct from `finalise_claim`. The reason both exist is that `finalise_claim` is invoked by both the Submit chip *and* the `finalise` meta-intent; treating them as separate top-level operations lets the chip path skip the regex layer entirely while still routing to the same `policyEngine.ts` handler.

### 2. MetaIntent discriminated union

```ts
type MetaIntent =
  | { kind: "status" }
  | { kind: "skip_system";    system: GatiodSystemKey }
  | { kind: "jump_to_system"; system: GatiodSystemKey }
  | { kind: "finalise_claim" };
```

When a meta-intent is classified from free text, the resulting `RouteDecision` is `{ operation: "meta", metaIntent }`. `finalise_claim` is special-cased: classifying it returns `{ operation: "finalise_claim" }` directly so downstream handlers don't need to inspect `metaIntent.kind` for the most common case.

### 3. Recognition module

A new module `src/v2/metaIntents.ts` exports:

```ts
const META_INTENT_PATTERNS: readonly MetaIntentPattern[] = [...];
function classifyMetaIntent(utterance: string): MetaIntent | null;
```

The pattern set is bounded and audited:

- `status`: `where are we | what'?s left | (?:show me the |claim )?status | summary | show me the plan`
- `skip_system`: `(?:skip|drop|don'?t need) <system-token>` with `<system-token>` resolved through the existing `systemSynonyms` table.
- `jump_to_system`: `(?:go back to|edit|revisit) <system-token>`.
- `finalise_claim`: `submit | finali[sz]e | we'?re done | that'?s everything`.

The set is exported as a constant for testability; tests assert each pattern matches its positive cases and rejects its negative cases.

### 4. Pipeline placement

```
normalize
→ pending-observation gate
→ pending-consensus gate
→ classifyMetaIntent()         (new — deterministic, LLM-free)
   ├─ non-null → emit RouteDecision { operation: "meta" | "finalise_claim", metaIntent }
   └─ null     → existing semantic gate + router
```

A non-null classification short-circuits the rest of routing. A null result means "fall through to normal routing" — the existing pipeline is unchanged for utterances that don't match.

Chip clicks bypass the classifier entirely. The frontend translates chip events directly into `RouteDecision` objects with the appropriate operation.

### 5. Handler dispatch

`policyEngine.ts` handles `RouteOperation = "meta"` by dispatching on `metaIntent.kind`:

| `kind` | Handler behaviour |
|---|---|
| `status` | Returns a deterministic claim-plan render. No LLM, no extraction. |
| `skip_system` | Writes `claimComponentOverrides[system] = { status: "skipped_by_user", source: "user_choice" }`; emits chat acknowledgment. |
| `jump_to_system` | Sets `pendingClarification` for the target system; the doctor's next utterance routes there. |
| `finalise_claim` | Delegates to the same path the Submit chip uses (ADR-0006). |

The status handler is particularly important: it is the only response in the entire pipeline that *must* be LLM-free. This is what makes "where are we" cheap, instant, and auditable.

### 6. Post-submit interaction

After `claimSubmittedAt` is set, the post-submit guard in `policyEngine.ts` allows only `lookup` and `meta:status` through. Meta-intents other than `status` (skip, jump_to, finalise) are not meaningful on a submitted claim — they receive the same soft-redirect as other operations.

This means a doctor who types "status" on a submitted claim still gets a deterministic plan render (now with the locked timestamp), while typing "skip spine" gets redirected to the claim-closed message.

### 7. Synonym table reuse

System token resolution in `skip_system` and `jump_to_system` reuses the existing `systemSynonyms.ts` table (the same one consumed by `router.ts`). This means new synonyms added for routing (e.g. recent slice 35's lumbosacral plexus handling) automatically apply to meta-intents — no duplicate maintenance.

Ambiguous or unrecognised system tokens cause the classifier to return null (fall-through), not an error. The doctor's "skip thingy" gets routed normally; the existing router can ask for clarification.

## Alternatives considered

- **Chip-only navigation** — meta-intents fire only from explicit chip clicks; no free-text matching. Rejected because doctors mid-flow often type "submit" or "where are we" instead of clicking; forcing the chip path adds friction for the cheapest possible action.

- **LLM-classify each turn** — small LLM call categorises every utterance as `meta` vs `content` before routing. Rejected on three grounds: (a) adds LLM cost and latency to every turn, including the 90 %+ that are clinical content; (b) introduces a new non-deterministic failure surface — an LLM hallucinating a "status" classification on a clinical utterance would corrupt the audit trail; (c) defeats the design philosophy that the whole pipeline is about keeping the LLM out of consequential routing.

- **Chip-primary with narrow regex for submit/status only** — recognise only the two highest-value patterns deterministically; everything else requires chips. Rejected as a half-measure: once we've paid the cost of a regex set (testing, maintenance), expanding it from 2 to 4 patterns is essentially free, and the additional coverage on skip and jump is valuable.

- **Treat meta-intents as a flavour of `clarify`** — overload the existing operation rather than adding a new one. Rejected because `clarify` is conceptually about *missing required facts*; meta-intents are about *session navigation*. Conflating them in the operation enum would force every clarify-handler to disambiguate, multiplying conditionals.

- **Two separate top-level operations per kind** — `status_meta`, `skip_meta`, `jump_meta`, `finalise_claim`. Rejected because the four "kind" values share a common dispatcher; promoting them all to top-level would explode the `RouteOperation` enum without buying any type safety the discriminated union doesn't already provide.

- **A meta-intent post-classifier** — run meta-intent classification *after* the router instead of before. Rejected because the router might emit a clarify response for "where are we" (interpreting it as ambiguous content), and the post-classifier would have to undo that decision. Pre-classifying is cleaner.

## Consequences

- One new `RouteOperation` variant (`meta`); plus `finalise_claim` shared with ADR-0006. One new module (`src/v2/metaIntents.ts`); one new discriminated-union type (`MetaIntent`). No existing tests affected.
- Free-text "where are we" / "submit" / "skip CNS" / "go back to upper limb" become deterministic, auditable navigation actions. Misses fall through to normal routing — graceful degradation.
- The `status` meta-intent is the *only* response in the V2 pipeline that is guaranteed LLM-free post-acceptance. This is intentional: status is the action a doctor will repeat most often, and making it cheap is part of the cognitive-load reduction the parent PRD targets.
- The pattern set is small and bounded. Adding a new meta-intent requires editing the constant, updating its tests, and (optionally) adding a chip. There is no plugin system; this is by design.
- Regex misses are an expected failure mode and are handled by fall-through. The cost of a miss is a single extra turn (the doctor restates), not a corrupted state.
- The synonym-table reuse means meta-intents stay in sync with router improvements automatically. There is no "meta-intents table" to maintain separately.

## References

- [.scratch/multi-system-claim-completion/PRD.md](../../.scratch/multi-system-claim-completion/PRD.md) — the parent PRD this ADR ratifies.
- [ADR-0006](0006-claim-submission-state-transition.md) — partner ADR introducing `claim_submitted` and the `finalise_claim` route operation that this ADR also wires.
- [ADR-0003](0003-semantic-consensus-architecture.md) — the pipeline placement pattern (deterministic preflight before LLM dispatch) that this ADR follows.
- [systemSynonyms.ts](../../src/v2/systemSynonyms.ts) — shared system-token resolution table.
