# Pill peek popover with click-to-jump, skip, and re-confirm

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

Clicking a pill opens a peek (popover) anchored to it that shows per-side breakdown (for bilateral systems) and three chips: `[Edit]`, `[Skip this system]`, `[Re-confirm]`.

- `[Edit]` calls a new server endpoint that sets `pendingClarification` to that system's next required field, so the doctor's next utterance is routed there. The peek closes.
- `[Skip this system]` writes `claimComponentOverrides[system] = { status: "skipped_by_user", source: "user_choice" }` and emits a chat acknowledgment ("Spine skipped — system excluded from this claim").
- `[Re-confirm]` is only enabled when the system is `calculated` and its `confirmation.status === "confirmed"`; clicking re-presents the confirmation card.

Click is doctor-explicit navigation — the system order in `state.detectionOrder` is not modified. The proactive system queue is bypassed for this turn only and resumes normally on the turn after.

## Acceptance criteria

- [ ] `SystemPeek` component renders on pill click, anchored to the clicked pill.
- [ ] Peek shows per-side breakdown for bilateral systems.
- [ ] `[Edit]` chip sets `pendingClarification` server-side and routes the next turn to that system.
- [ ] `[Skip this system]` chip writes the `claimComponentOverrides` entry and emits an acknowledgment line.
- [ ] `[Re-confirm]` chip is disabled unless the system is `calculated` and previously `confirmed`.
- [ ] Clicking outside the peek closes it without side effects.
- [ ] Integration test: click pill → edit → next turn routes to that system. State `detectionOrder` unchanged.

## Blocked by

- [#03 Multi-pill sub-header with detection order, subtotals, and bilateral badge](./03-multi-pill-detection-order.md)
