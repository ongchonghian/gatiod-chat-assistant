# Save-point chat acknowledgment with count-remaining

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

When a system transitions to `status: "calculated"`, emit a single short acknowledgment line in chat that pairs the per-system save-point signal with the endowed-progress count: *"Upper limb saved at 12% — 3 systems left."*

The pill colour change is already handled by the projection from slice #03. This slice adds the chat line only, which is what closes the loss-aversion loop ("the work you just did is locked in") with the forward-looking nudge ("here is what remains").

The acknowledgment is emitted by `chatServiceV2.ts` after the tool result is applied and before the response is rendered. Implementation uses a diff between the previous and current `state.systems[key].status` — if any system newly transitioned to `calculated`, generate one line per transition (typical case: one).

Count-remaining is computed as `detectionOrder.filter(s => state.systems[s].status !== "calculated" && !state.claimComponentOverrides[s]?.status?.includes("skipped")).length`. Singular form: "1 system left". Zero systems left: "All systems complete — ready to submit." This last variant prompts the Submit chip's appearance.

No animation, no toast — restrained MUI, matching the existing message style.

## Acceptance criteria

- [ ] `chatServiceV2.ts` diff-detects newly-calculated systems on each turn.
- [ ] Acknowledgment line emitted in chat for each newly-calculated system.
- [ ] Line format: "<System label> saved at <subtotal>% — <count> system<s?> left." (or "All systems complete — ready to submit.")
- [ ] No additional UI chrome (no toasts, no banners, no animations).
- [ ] Integration test: calculate upper limb → chat contains the acknowledgment line.
- [ ] Integration test: calculate the last system in detectionOrder → line reads "All systems complete — ready to submit."

## Blocked by

- [#03 Multi-pill sub-header with detection order, subtotals, and bilateral badge](./03-multi-pill-detection-order.md)
