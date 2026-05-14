---
id: ADR-0006
status: Proposed
sprint_sections:
  - "../v2/sprints.md#sprint-12--multi-system-claim-completion-adr-0006-adr-0007"
---

# 0006 — Claim submission as a first-class state transition

## Status

Proposed (2026-05-13). Captures decisions from the multi-system claim completion grilling session. Implementation tracked in [.scratch/multi-system-claim-completion/PRD.md](../../.scratch/multi-system-claim-completion/PRD.md) and its 14 issue slices.

## Context

V2 today optimises for *correctness* of per-system PI% calculations: factsHash snapshots (D4), no-tool-no-PI guard (D10), no silent inference of clinical fields (D2), fail-loud on V2 failure (D11). These are non-negotiable.

What V2 does not optimise for is *completion* of multi-system claims. Empirically, doctors describing N ≥ 5 systems abandon mid-flow at a rate the per-system correctness invariants cannot detect. The drop-off is invisible to telemetry because there is no signal distinguishing "the doctor finished thinking" from "the doctor got stuck and left".

The pipeline today treats `assess_global_cvc` as the implicit terminal step: whenever ≥2 systems are `calculated`, the global CVC tool can run, and the result message contains "Final PI%". But this is a *capability*, not a *commitment*. The doctor never explicitly declares "this is my final claim". As a result:

- Half-finished multi-system claims look identical to deliberately abandoned single-system claims in the audit log.
- A final PI% can be rendered whenever the doctor happens to trigger global CVC, with no clear medico-legal moment of sign-off.
- Single-system claims have no terminal event at all — the per-system render is the implicit end.
- The completion metric the product needs ("did the doctor finish this claim?") cannot be computed from any existing event.

The grilling session considered three definitions of completion: strict (all systems calculated or skipped, GCVC done where applicable), pragmatic (at least one system calculated), and doctor-affirmed (explicit submit action). Strict is what's clinically meaningful but unobservable without an event boundary. Doctor-affirmed adds the event boundary the audit trail needs and converts strict into a measurable definition.

## Decision

Introduce a doctor-affirmed `claim_submitted` state as a first-class transition in the V2 state machine. Submission is the single event that terminates a claim, fires the medico-legal audit record, and locks the session against further accidental modification.

### 1. State machine addition

`V2SessionState` gains one additive nullable field, hydrated by `coerceV2State()` for backward compatibility:

```ts
claimSubmittedAt?: string;  // ISO timestamp, presence = "claim is closed"
```

No DB migration; no `version` bump. The pattern mirrors `pendingConsensus` from ADR-0003 (D17 hydration policy).

### 2. Route operation addition

`RouteOperation` is extended:

```ts
type RouteOperation =
  | "lookup" | "assessment" | "global_cvc" | "clarify"
  | "meta"              // ADR-0007
  | "finalise_claim";   // this ADR
```

`finalise_claim` is the operation emitted by the Submit chip and by the `finalise` meta-intent (see ADR-0007). It is the only route that leads to `claim_submitted`.

### 3. Eligibility rule

A claim is eligible for submission when every system in `state.detectionOrder` is either `status: "calculated"` or marked `claimComponentOverrides[X].status === "skipped_by_user"`. The eligibility check is the deep module `claim-submission`'s `canSubmit(state)`, which returns `{ ok: true } | { ok: false, blockingSystems: GatiodSystemKey[] }`.

Eligibility drives the Submit chip's visibility in the claim-plan sub-header. The chip is hidden (or visibly disabled with a tooltip listing `blockingSystems`) until eligibility is met. There is no "submit anyway" override — every detected system must reach a terminal status.

### 4. Single-system vs multi-system submission flow

| N detected | Submit → |
|---|---|
| 1 | Renders the per-system result as final and fires `claim_submitted`. No GCVC. |
| ≥2 | Triggers the existing `assess_global_cvc` confirmation card. Confirming the card fires `claim_submitted` with the post-CVC value as `finalPiPercent`. |

The doctor's single Submit click is the only moment of medico-legal irreversibility. For multi-system claims, the GCVC confirmation card serves as the dry-run preview before commitment. The PTI bonus toggle (default off) is presented explicitly on that card.

Single-system claims do see a Submit chip even though the result was already rendered, for two reasons:

- It preserves the audit invariant that every final PI% is preceded by an explicit Submit event.
- It gives the success metric a uniform signal across N = 1..9.

### 5. Audit event

Exactly one `claim_submitted` audit event per session, payload:

```ts
{
  sessionId: string;
  doctorId: string;
  submittedAt: string;            // ISO
  systemSubtotals: Record<GatiodSystemKey, number | null>;
  finalPiPercent: number;
  claimShape: {
    detected: GatiodSystemKey[];
    skipped: GatiodSystemKey[];
    calculated: GatiodSystemKey[];
  };
}
```

The audit event is the canonical signal for downstream completion metrics. Abandonment is defined as a session idle for ≥30 minutes with `detectionOrder.length > 0` and `claimSubmittedAt === null`.

### 6. Post-submit lock

Once `claimSubmittedAt` is set, `policyEngine.ts` short-circuits every operation except `lookup` and the `status` meta-intent. The short-circuit response is a soft redirect:

> *"This claim was submitted at <timestamp>. Start a new claim, or reopen this one?"*

with chips `[Start new claim]` and `[Reopen this claim]`. The sub-header renders a locked visual with the timestamp badge in place of the Submit chip.

`lookup` is permitted post-submit so the doctor can still ask reference questions about the closed claim ("what's the table value for shoulder flexion 90°?") without unlocking it.

### 7. Reopen semantics

`[Reopen this claim]` performs a **true reversal**: `claimSubmittedAt` is cleared, the post-submit lock disengages, and a `claim_reopened` audit event fires to record the reversal. The original `claim_submitted` event remains in the audit log unchanged — the trail is `claim_submitted → claim_reopened → (later) claim_submitted` rather than a mutation of the original record.

Chosen over the side-flag alternative (`unlocked: true` preserving the original record) for three reasons:

1. **`isSubmitted` stays semantically truthful.** With `claimSubmittedAt` cleared, every read of `isClaimSubmitted(state)` returns false — there is no "submitted but actually editable" state to surprise callers.
2. **The audit log already captures history.** Medico-legal review reads the audit log, not the state field. `claim_submitted` and `claim_reopened` events together describe the lifecycle without polluting the state shape.
3. **Re-submission produces a fresh `claim_submitted` event.** The audit log records each terminal commitment as its own event, which is the natural shape for compensation review.

`claim_reopened` payload:

```ts
{
  sessionId: string;
  doctorId: string;
  reopenedAt: string;            // ISO
  originalSubmittedAt: string;    // value of claimSubmittedAt before reversal
  reason?: string;                // free text, optional
}
```

### 8. Idempotency

`submitClaim(state)` is idempotent: a second call returns the same state unchanged and does not re-fire the audit event. `canSubmit` returns `{ ok: false, blockingSystems: [] }` once a claim is already submitted (the caller can detect "already done" by inspecting `claimSubmittedAt`).

## Alternatives considered

- **Strict implicit completion (no Submit event)** — define completion as "all systems calculated or skipped AND (single-system rendered OR GCVC confirmed)". Rejected because it cannot distinguish "doctor stopped voluntarily" from "doctor abandoned" — the same observable state covers both. Audit trail lacks a single moment of sign-off.

- **Pragmatic completion (at least one system calculated)** — count any session with one calculated system as "complete". Rejected because it misrepresents multi-system abandonment as success, defeating the measurement.

- **Treat GCVC confirmation as the implicit submit** — promote the existing `assess_global_cvc` confirmation card to be the terminal event. Rejected because it doesn't generalise to single-system claims, and dilutes the "one moment of irreversibility" frame. Multi-system claims would have a clear endpoint; single-system claims wouldn't.

- **Add a "claim status" enum (`active | submitted | abandoned`)** — explicit state field rather than a nullable timestamp. Rejected because the timestamp is a richer signal than the boolean (when did this happen?), and `abandoned` is a derived classification, not a stored state. Mixing them in the same enum creates classification ambiguity.

- **Auto-submit when all systems reach calculated** — fire `claim_submitted` automatically once eligibility is met, no chip needed. Rejected as paternalistic; the medico-legal frame requires explicit doctor action.

## Consequences

- One additive nullable field on `V2SessionState`; one new `RouteOperation` variant; one new audit event. Existing tests are unaffected.
- The new deep module `claim-submission` becomes the single source of truth for completion. `policyEngine.ts`, the meta-intent dispatcher (ADR-0007), and the claim-plan projection all consume it.
- The success metric ("completed claims / sessions with ≥1 detected system") becomes measurable for the first time. Abandonment becomes detectable.
- The post-submit lock is a new pipeline gate. It is intentionally less restrictive than V2 confirmation snapshots (it allows `lookup` and `status` through) — the goal is to prevent accidental fact additions, not to be coercive.
- Single-system claims gain a small extra ceremony (the Submit click) where today's render is implicit-terminal. The trade-off is uniformity of the audit event across N = 1..9.
- Reopen semantics need to be resolved before slice #09 can ship. Captured as the slice's HITL component.

## References

- [.scratch/multi-system-claim-completion/PRD.md](../../.scratch/multi-system-claim-completion/PRD.md) — the parent PRD this ADR ratifies.
- [ADR-0003](0003-semantic-consensus-architecture.md) — additive-field hydration pattern this ADR follows.
- [architecture-decisions.md](../v2/architecture-decisions.md) — D2, D4, D10, D11 invariants this ADR composes with.
- [ADR-0007](0007-meta-intents-deterministic-routing.md) — partner ADR introducing the `meta` and `finalise_claim` route operations.
