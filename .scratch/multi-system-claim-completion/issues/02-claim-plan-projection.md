# Claim plan projection and empty/single-pill sub-header

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

The foundational tracer bullet for the claim plan UI. A pure-function projection module on the server transforms `V2SessionState` into a `ClaimPlanView` shape; the chat API envelope includes this view in every response; the frontend gains a new `ClaimPlanSubHeader` component slotted between `AppBar` and `ChatPanel` in `web/src/App.tsx`.

The slice is deliberately minimal at the UI level: the sub-header renders nothing when `detectionOrder.length === 0`, and renders a single pill when one system has been detected. The deep module is the load-bearing piece — every later slice composes against it.

`ClaimPlanView` carries: `systems: SystemPillView[]`, `submitState: { visible: boolean; reason?: string }`, `nextSystem?: GatiodSystemKey`. Each `SystemPillView` is `{ system, label, status, subtotalPercent?, sideBreakdown?, isLegacyMode }`. The projection reads only from `V2SessionState` — no side effects.

The chat response shape gains a `claimPlan: ClaimPlanView` field. Frontend consumes it directly; no business logic in React.

## Acceptance criteria

- [ ] New module `src/v2/claimPlanProjection.ts` exports `projectClaimPlan(state: V2SessionState): ClaimPlanView`.
- [ ] `ClaimPlanView`, `SystemPillView`, and `SubmitState` types added to `src/v2/contracts.ts`.
- [ ] Chat API response shape includes `claimPlan` field; `chatServiceV2.ts` calls the projection on every response.
- [ ] `web/src/components/ClaimPlanSubHeader.tsx` created; renders nothing on empty view, one pill on single-system view.
- [ ] `web/src/App.tsx` slots `ClaimPlanSubHeader` between `AppBar` and `ChatPanel`.
- [ ] Projection unit tests cover empty state, single-system collecting state, and single-system calculated state with subtotal.
- [ ] Projection unit tests assert `submitState.visible` is `false` whenever any detected system is not `calculated` or `skipped_by_user`.

## Blocked by

- [#01 ADR-0006 + ADR-0007 + CONTEXT.md additions](./01-adrs-claim-submission-and-meta-intents.md)
