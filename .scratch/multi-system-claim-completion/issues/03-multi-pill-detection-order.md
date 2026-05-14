# Multi-pill sub-header with detection order, subtotals, and bilateral badge

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Extends the foundational sub-header from slice #02 so that it correctly handles multiple detected systems. The projection populates one pill per entry in `state.detectionOrder`, preserving order — the doctor's narrative sequence drives the sub-header sequence with no automatic reordering. Each pill shows status colour, system label, subtotal when `calculated`, and a small `L+R` badge for bilateral systems (upper limb, lower limb, hearing, visual).

The `SystemPill` sub-component renders the pill content; pill colour maps from `status` (`idle`, `collecting`, `confirmed`, `calculated`, `skipped_by_user`). Bilateral status is derived from the system's `instancesBySystem` entries when more than one side is present.

This slice introduces no new interactions — pills are static. Click-to-jump arrives in slice #04. Narrow-viewport behaviour (horizontal overflow with momentum scroll) lands here so that the pill row never pushes chat off-screen.

## Acceptance criteria

- [ ] Projection handles 2+ systems and preserves `state.detectionOrder` exactly.
- [ ] `SystemPill` component renders status colour, label, and subtotal (when present).
- [ ] Bilateral systems show an `L+R` inline badge when `instancesBySystem[system].length > 1`.
- [ ] Projection unit tests cover 3-system, 9-system, mixed-status, and bilateral fixtures.
- [ ] Projection unit tests assert pills are returned in detection order regardless of `systems` insertion order.
- [ ] Sub-header pill row uses horizontal overflow with momentum scroll on narrow viewports.

## Blocked by

- [#02 Claim plan projection and empty/single-pill sub-header](./02-claim-plan-projection.md)
