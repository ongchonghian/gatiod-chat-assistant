# Meta-intents module with deterministic regex routing

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

A new deep module that recognises navigation utterances ("where are we", "skip CNS", "go back to upper limb", "submit") and routes them deterministically, bypassing both the LLM and the extraction pipeline.

`classifyMetaIntent(utterance: string): MetaIntent | null` returns a discriminated union with four variants:

- `{ kind: "status" }` — matches "where are we", "what's left", "status", "summary", "show me the plan".
- `{ kind: "skip_system", system: GatiodSystemKey }` — matches "skip <system>", "drop <system>", "we don't need <system>". System tokens resolve through the existing synonym table; ambiguous or unrecognised tokens return null.
- `{ kind: "jump_to_system", system: GatiodSystemKey }` — matches "go back to <system>", "edit <body part>", "revisit <system>".
- `{ kind: "finalise_claim" }` — matches "submit", "finalise", "we're done", "that's everything".

`router.ts` runs `classifyMetaIntent` before existing route logic. A non-null result emits `RouteDecision { operation: "meta", metaIntent }` and short-circuits the rest of the pipeline. A null result falls through to normal routing — no regression for utterances that don't match.

`policyEngine.ts` handles `RouteOperation = "meta"` by dispatching on `metaIntent.kind`:

- `status` returns a deterministic render of the claim plan view (no LLM, no extraction).
- `skip_system` writes `claimComponentOverrides[system] = "skipped_by_user"` and acknowledges in chat.
- `jump_to_system` sets `pendingClarification` to route the next turn to that system.
- `finalise_claim` calls into the same path as the Submit chip (slice #07 / #08).

The regex set lives in `src/v2/metaIntents.ts` and is exported as a constant for testability.

## Acceptance criteria

- [ ] New module `src/v2/metaIntents.ts` exports `classifyMetaIntent`, `MetaIntent`, and the regex set as a constant.
- [ ] `MetaIntent` discriminated union added to `contracts.ts`.
- [ ] `RouteOperation = "meta"` added to `contracts.ts` and handled in `router.ts` and `policyEngine.ts`.
- [ ] `router.ts` runs `classifyMetaIntent` before existing route logic; non-null result short-circuits.
- [ ] `policyEngine.ts` dispatches each `MetaIntent.kind` to the correct handler.
- [ ] Status meta-intent returns a render that does not invoke the LLM (verified via spy in test).
- [ ] Unit tests cover every regex pattern (positive + negative cases) and the fall-through-on-null behaviour.
- [ ] Unit tests cover synonym-table resolution for system tokens in `skip_system` and `jump_to_system`.
- [ ] Integration test: "where are we" mid-flow → status response. Normal extraction not invoked.
- [ ] Integration test: "skip spine" → system marked `skipped_by_user`. Pill in sub-header updates.

## Blocked by

- [#01 ADR-0006 + ADR-0007 + CONTEXT.md additions](./01-adrs-claim-submission-and-meta-intents.md)
