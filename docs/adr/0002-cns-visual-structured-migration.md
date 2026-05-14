---
id: ADR-0002
status: Superseded
sprint_sections:
  - "../v2/sprints.md#sprint-6--cns--visual--%E2%97%A4-final-step"
superseded_by: null
---

# 0002 — CNS and Visual structured migration

## Status

Superseded (2026-05-14). All open questions resolved by Sprint 6 work (V2-501–V2-508). CNS and Visual are now `structured_live`. See V2-507/V2-508 in [sprints.md](../v2/sprints.md).

## Context

CNS and Visual appear frequently in the cross-system scenario catalogue (CNS: 119 components, Visual: 115 components out of 360 cross-system rows), but both remained `legacy` in the V2 system registry pending structured implementation.

A structured CNS migration implements the Section A "highest-score" rule, Section B neurological components with intra-section CVC, Section C paralysis mapping, and the specialist-gated exclusions that prevent CNS-B from absorbing bladder/bowel/spasm findings. A structured Visual migration implements left-eye and right-eye instances, a diplopia instance, acuity / visual-field / diplopia-zone extraction, the monocular cap, and the additive subtotal across the three instances.

## Decision

Resolved by Sprint 6. All four components (extractor, readiness validator, arg builder, result renderer) were wired for both systems as V2-501–V2-506. V2-507 ran the Excel shadow runner and confirmed ADR-0001 thresholds. Both systems promoted to `structured_live`.

## Open questions — resolved

**Migration order:** Both CNS and Visual migrate together. Visual-first was considered but the sections of CNS were not materially harder to wire simultaneously, and moving together reduces the window of cross-system mismatch in the shadow grader.

**CNS curated golden set:** Signed off as part of V2-506 — 71 conversation-level cases covering Section A (epilepsy, dementia, psychiatric), Section B (olfaction, facial nerve, equilibrium, swallowing, station-gait, respiration), and Section C (paralysis brackets with bilateral and monoparesis variants).

**Visual curated golden set:** Signed off as part of V2-506 — 58 conversation-level cases covering left-eye and right-eye acuity, visual field, diplopia zones (uncorrectable / central 30° / 30–60° / beyond 60° / none), and the monocular cap.

**`legacy_deferred` cross-system counting:** Resolved by [ADR-0001](0001-structured-live-promotion-gate.md) — `legacy_deferred` components are excluded from `cross_system_end_to_end_rate`. Rows containing only `legacy_deferred` components are classified `legacy_deferred_cross_system` and excluded entirely. Now that CNS and Visual are `structured_live`, all cross-system rows are graded normally.

## Consequences

- All CNS and Visual scenario rows in `scenarios.generated.json` are reclassified from `legacy_deferred` to their actual expected outcome classes.
- `gradeShadowOutcome.ts` no longer special-cases CNS/Visual as legacy.
- `ADR_0001_REGISTRY_THRESHOLDS` carries real thresholds for both systems (90% safe-outcome, 80% exact-calculation).
- Cross-system rows involving CNS or Visual now count toward the `cross_system_end_to_end_rate`.
