# Post-submit lock and Reopen mechanism

Status: done
Type: HITL → AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Two coupled pieces: a HITL micro-ADR resolving the Reopen semantics (open question carried forward from the PRD), and the AFK implementation of the post-submit lock once the semantics are decided.

**HITL: Reopen semantics ADR.** The PRD flagged an open question: should `[Reopen this claim]` perform a true reversal (clear `claimSubmittedAt`, undo the audit event idempotently) or set a side flag (`unlocked: true`, preserve original `claim_submitted` audit event)? The decision affects medico-legal audit trail interpretation. Capture in a short ADR (or extend ADR-0006) before implementation.

**AFK: Post-submit lock implementation.** Once `claimSubmittedAt` is set, `policyEngine.ts` short-circuits every operation except `lookup` and the `status` meta-intent. The short-circuit response is a soft-redirect:

> "This claim was submitted at <timestamp>. Start a new claim, or reopen this one?"

with chips `[Start new claim]` and `[Reopen this claim]`. The sub-header renders a locked visual state with a "Submitted at <timestamp>" badge replacing the Submit chip. Reopen behaviour follows the decision from the HITL step.

## Acceptance criteria

- [ ] HITL: ADR landed that records the Reopen semantics decision.
- [ ] `policyEngine.ts` returns the soft-redirect response when `claimSubmittedAt` is set and operation is not `lookup` or `meta:status`.
- [ ] Sub-header renders locked visual state with "Submitted at <timestamp>" badge.
- [ ] `[Start new claim]` chip resets the session to `defaultV2SessionState()`.
- [ ] `[Reopen this claim]` chip implements the behaviour chosen in the ADR (true reversal or `unlocked` flag).
- [ ] Integration test: submit a single-system claim → describe new finding → soft-redirect appears.
- [ ] Integration test: submit → reopen → describe new finding → normal extraction resumes.
- [ ] Integration test: `lookup` operations still work post-submit (doctor can ask reference questions about the closed claim).

## Blocked by

- [#07 Submit primitive and single-system claim submission](./07-submit-single-system.md)
- [#08 Multi-system claim submission via global CVC confirmation](./08-submit-multi-system-gcvc.md)
