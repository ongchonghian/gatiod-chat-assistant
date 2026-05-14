# "+ add system" overflow chip and remaining-systems menu

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

A pinned overflow chip at the right end of the pill row, rendered as a small `+` button. Clicking it opens a menu listing every system that is not yet in `state.detectionOrder` (and not already in `claimComponentOverrides` with `skipped_by_user`). Selecting a system from the menu writes `claimComponentOverrides[system] = { status: "detected", source: "user_choice", source_text: "add_system_overflow" }`, which causes the projection to surface that system as a new pill on the next response.

The chip is only visible once `detectionOrder.length >= 1` (no point showing it on an empty session). It is hidden when all 9 systems are already represented (detected or skipped). After `claim_submitted` is set, the chip is hidden entirely.

This is the explicit "checklist" affordance flagged in the PRD — the default sub-header is detected-only (to respect the doctor's narrative), and the overflow gives doctors who want the full taxonomy a one-click path to it without coercing the default.

## Acceptance criteria

- [ ] `AddSystemMenu` component renders as a `+` chip pinned to the right of the pill row.
- [ ] Chip is hidden when `detectionOrder.length === 0`, when all 9 systems are present, or when `claimSubmittedAt` is set.
- [ ] Click opens a menu listing remaining systems with their canonical clinical labels.
- [ ] Selecting a system writes the `claimComponentOverrides` entry and re-fetches the response.
- [ ] New pill for the selected system appears in the next response, ordered after existing pills.
- [ ] Integration test: select a system from the overflow → pill appears with `status: "collecting"`.

## Blocked by

- [#03 Multi-pill sub-header with detection order, subtotals, and bilateral badge](./03-multi-pill-detection-order.md)
