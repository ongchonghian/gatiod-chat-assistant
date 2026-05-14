# Inline plan-of-attack in semantic consensus message

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

When the doctor provides a multi-system narrative and `PendingConsensus.candidateSystems.length >= 2`, the existing semantic consensus message gains an inline plan-of-attack block listing the systems in detection order:

> *I'll work through these in this order:*
> *1) Upper limb*
> *2) Spine*
> *3) Hearing*
>
> *Proceed with this plan?*

A `[Reorder]` chip is added alongside the existing `Proceed | Edit interpretation | Choose system first | Reject` chips. Clicking `[Reorder]` opens a quick reorder interface (small list with up/down arrows or click-to-move) that lets the doctor adjust the sequence before extraction starts. The reordered sequence becomes the new `state.detectionOrder`.

No new turn — the plan announcement is appended to the existing consensus message. Single-system or 0-system consensus cases continue to render exactly as today; the block is conditional on `candidateSystems.length >= 2`.

The doctor's existing acceptance chips (Proceed etc.) work unchanged. Choosing Proceed accepts both the interpretation and the order.

## Acceptance criteria

- [ ] Consensus message renderer adds the plan-of-attack block when `candidateSystems.length >= 2`.
- [ ] Block lists systems in detection order using their clinical labels (no raw `GatiodSystemKey` strings).
- [ ] `[Reorder]` chip appears alongside existing consensus chips when block is rendered.
- [ ] `[Reorder]` flow updates `state.detectionOrder` to the doctor's chosen sequence.
- [ ] Single-system consensus messages render identically to current behaviour (no plan block).
- [ ] Integration test: paste a multi-system narrative → consensus message includes plan block in detection order.
- [ ] Integration test: click `[Reorder]` → adjust order → click `[Proceed]` → extraction proceeds in the new order.

## Blocked by

None — can start immediately.
