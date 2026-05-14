# Stale-confirmation diff chip with clinical field labels

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

When a system's `confirmation.status` transitions to `"stale"` (because a fact patched after the doctor had already confirmed a snapshot), today's flow re-prompts the full confirmation summary — a wall of text the doctor must re-read to find the change. This slice replaces that with a single chip showing the diff only.

A new deep module `stale-confirmation-diff` exports `diffFacts(oldFacts: V2SystemFacts, newFacts: V2SystemFacts): DiffLine[]`. Each `DiffLine` is `{ label: string; oldValue?: string; newValue?: string; kind: "added" | "removed" | "changed" }`. Field labels and enum values are rendered through the existing clinical display layer — no raw schema keys appear in doctor-facing output.

The diff chip is emitted as a chip-action message in chat: `[Re-confirm with 2 changes]` (count reflects the number of `DiffLine`s). Clicking the chip opens a popover/peek showing the diff lines and offers `[Re-confirm]` or `[See full summary]`. The full summary path falls back to today's behaviour for doctors who want it.

Diff lines for facts that aren't doctor-visible (internal-only routing flags) are filtered out — the doctor sees only clinically meaningful changes.

## Acceptance criteria

- [ ] New module `src/v2/staleConfirmationDiff.ts` exports `diffFacts` and the `DiffLine` type.
- [ ] Diff lines use clinical labels and enum translations from the existing clinical display layer.
- [ ] Internal-only fields are filtered out of diff output.
- [ ] Chat emits a chip-action message with the chip label `[Re-confirm with <N> change<s?>]` when a system goes `stale`.
- [ ] Clicking the chip opens a popover with the diff lines; `[Re-confirm]` re-presents the confirmation card; `[See full summary]` falls back to the existing confirmation summary.
- [ ] Unit tests for the diff module cover: identical snapshots, single added/removed/changed fields, multi-field diffs, internal-field filtering, and clinical-label translation.
- [ ] Integration test: confirm upper limb → patch a fact → see diff chip → click → see diff with 1 line → click re-confirm.

## Blocked by

None — can start immediately.
