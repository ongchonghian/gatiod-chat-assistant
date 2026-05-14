# Transitional visual class for CNS and Visual pills (legacy mode)

Status: done
Type: AFK

## Parent

[.scratch/multi-system-claim-completion/PRD.md](../PRD.md)

## What to build

While CNS and Visual remain on the `legacy` migration mode (per REQ-A1–A6 in `docs/v2/requirements-known-issues.md`), their pills in the claim plan sub-header render with a distinct visual treatment so doctors understand why those systems behave differently from the others.

The `isLegacyMode` flag on `SystemPillView` is already populated by the projection (it reads `V2_SYSTEM_REGISTRY[system].mode !== "structured_live"`). This slice only adds the frontend visual treatment.

The visual treatment is a dashed-border pill style with a tooltip on hover: *"This system is being assessed in legacy mode. Migration in progress."* When CNS and Visual reach `structured_live` (REQ-A3 and REQ-A6 respectively), the flag flips automatically and the dashed border disappears with no code change to this slice.

Legacy-mode pills still participate in the sub-header layout, status colours, and click-to-peek behaviour — they only differ in the border and tooltip.

## Acceptance criteria

- [ ] `SystemPill` component reads `isLegacyMode` and applies a dashed-border variant when `true`.
- [ ] Hover on a legacy-mode pill shows tooltip explaining the transitional state.
- [ ] Projection unit test asserts `isLegacyMode: true` for CNS and Visual while their registry mode is `legacy`.
- [ ] Projection unit test asserts `isLegacyMode: false` once their registry mode flips to `structured_live` (using a registry override in the test).
- [ ] Frontend snapshot test for a legacy-mode pill confirms the dashed-border class is applied.

## Blocked by

- [#03 Multi-pill sub-header with detection order, subtotals, and bilateral badge](./03-multi-pill-detection-order.md)
