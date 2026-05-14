# Submit primitive and single-system claim submission

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Introduces the `claim-submission` deep module and the doctor-affirmed `Submit` event for single-system claims. The module is the single source of truth for "is this claim ready to submit?" and "execute submission". It is consumed by `policyEngine.ts` on the new `RouteOperation = "finalise_claim"`, by the meta-intent handler on a "submit" utterance (slice #10), and by the projection module to compute `submitState.visible`.

`canSubmit(state)` returns `{ ok: true }` when every system in `state.detectionOrder` is either `calculated` or `skipped_by_user`. Otherwise returns `{ ok: false, blockingSystems: GatiodSystemKey[] }`. The projection uses this directly to drive the Submit chip's visibility.

`submitClaim(state)` sets `state.claimSubmittedAt` to the current ISO timestamp, emits a `claim_submitted` audit event, and returns the new state. It is idempotent: a second call is a no-op. It is a no-op when `canSubmit` returns `ok: false`.

For single-system claims, clicking Submit triggers `RouteOperation = "finalise_claim"` which calls `submitClaim` and renders the per-system result as the claim's final PI%. The audit event payload is `{ sessionId, doctorId, submittedAt, systemSubtotals, finalPiPercent, claimShape: { detected[], skipped[], calculated[] } }`.

Sub-header Submit chip placement: pinned to the right of the pill row, after the `AddSystemMenu` overflow. Visible per `submitState.visible`; disabled-with-tooltip otherwise listing `blockingSystems`.

## Acceptance criteria

- [ ] New module `src/v2/claimSubmission.ts` exports `canSubmit`, `submitClaim`, `isClaimSubmitted`.
- [ ] `V2SessionState.claimSubmittedAt?: string` added to `contracts.ts`; `coerceV2State` handles missing field for migration safety.
- [ ] `RouteOperation = "finalise_claim"` added to `contracts.ts` and handled in `policyEngine.ts`.
- [ ] `policyEngine.ts` returns a clarification (listing `blockingSystems`) when `finalise_claim` is invoked but `canSubmit.ok === false`.
- [ ] `policyEngine.ts` calls `submitClaim` and renders the per-system result as final when `canSubmit.ok === true` and `detectionOrder.length === 1`.
- [ ] `SubmitChip` component renders per `submitState`; disabled tooltip lists blocking systems.
- [ ] `claim_submitted` audit event emitted exactly once per session with the documented payload.
- [ ] Unit tests for `claim-submission` module cover every state combination, idempotency, and no-op behaviour.
- [ ] Integration test: single-system claim → calculate → Submit chip appears → click → final PI% rendered + audit event emitted.

## Blocked by

- [#01 ADR-0006 + ADR-0007 + CONTEXT.md additions](./01-adrs-claim-submission-and-meta-intents.md)
- [#02 Claim plan projection and empty/single-pill sub-header](./02-claim-plan-projection.md)
