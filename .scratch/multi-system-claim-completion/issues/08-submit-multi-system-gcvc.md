# Multi-system claim submission via global CVC confirmation

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Extends the Submit flow from slice #07 to handle multi-system claims. When the doctor clicks Submit and `detectionOrder.length >= 2`, the policy engine returns the existing `assess_global_cvc` confirmation card (preview of subtotals, exclusion chips, PTI bonus toggle) rather than executing immediately. Confirming the card triggers `submitClaim` and renders the final cross-system PI%, with the same `claim_submitted` audit event semantics as the single-system path.

This re-uses the existing global CVC plumbing — no new tool, no new confirmation card. The change is in `policyEngine.ts`: the `finalise_claim` operation routes to the GCVC confirmation when N ≥ 2, and routes straight to `submitClaim` when N = 1.

The PTI bonus question is presented explicitly in the GCVC confirmation card (default off). Per-system exclusion chips allow the doctor to remove a calculated subtotal from the cross-system CVC if they decide it doesn't belong; the underlying `globalCvcExclusions` state already supports this.

## Acceptance criteria

- [ ] `policyEngine.ts` returns the `assess_global_cvc` confirmation card on `finalise_claim` when `detectionOrder.length >= 2`.
- [ ] Confirming the GCVC card calls `submitClaim` and renders the final cross-system PI%.
- [ ] `claim_submitted` event fires exactly once after GCVC confirmation; `finalPiPercent` in the payload is the post-CVC value, not the pre-CVC subtotals sum.
- [ ] PTI bonus toggle defaults to off; when enabled, the final value reflects the +25% bonus.
- [ ] Per-system exclusion chips in the GCVC card write to `globalCvcExclusions` and update the preview without re-submitting.
- [ ] Integration test: 3-system claim → all calculated → Submit → GCVC confirmation → confirm → final PI% + audit event.
- [ ] Integration test: same flow with PTI bonus on → final value includes the bonus.

## Blocked by

- [#07 Submit primitive and single-system claim submission](./07-submit-single-system.md)
