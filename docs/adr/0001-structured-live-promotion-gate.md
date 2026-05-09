# 0001 — Structured-live promotion requires scenario evidence

## Status

Accepted (2026-05-09).

## Context

The V2 system registry treats `structured_live` as a wiring flag: a system is "live" iff it has an extractor, readiness validator, arg builder, and result renderer. This let seven systems become authoritative without proof that any clinical scenario actually flows through them safely. An audit against the GATIOD scenario catalogue (1,148 scenarios, 2,419 specific rows, 360 cross-system) showed several "live" systems would silently drop components, fail confirmation safely-but-uselessly, or skip the global CVC step.

## Decision

`structured_live` is a safety certification state, not a wiring state. A system may only be marked `structured_live` when **all three** of the following hold:

1. **Curated golden tests pass at 100%.** A small, hand-picked set of clinically critical scenarios per system (`tests/v2/<system>/*.golden.test.ts`).
2. **Excel scenario shadow runner meets the system's tier threshold.** Driven by `data/gatiod_injury_scenario_catalogue.xlsx` (the canonical 11-sheet workbook covering single-system catalogue, specific scenarios, and cross-system scenarios). Lives at `tests/v2/excelScenarios/*.shadow.test.ts`, opt-in via `GATIOD_RUN_EXCEL_SCENARIOS=true`. Workbook is parsed once into `tests/v2/excelScenarios/scenarios.generated.json` via `scripts/build-excel-fixtures.ts`; CI fails if `git diff` on the generated file is non-empty after a regeneration, ensuring workbook and fixture move together.
3. **Zero critical safety failures recorded.** Final PI% without successful `assess_*` evidence, confirmation shown with incomplete required facts, wrong system selected when explicit evidence exists, multi-system component silently dropped, `argBuilder` validation bypassed, or legacy fallback after V2 failure without explicit user choice — any of these against the curated or shadow set blocks promotion.

Each Excel scenario component is classified into one of five expected outcomes:

- `exact_calculation` — extract sufficient facts and produce expected PI%
- `clarification_required` — ask the correct missing-field question
- `unsupported_safe_fail` — refuse or defer safely
- `routing_only` — identify the correct system without calculating
- `legacy_deferred` — system is intentionally `legacy` (CNS, Visual today); component is routed correctly but not structurally calculated. Does not count toward any structured promotion gate. See [ADR-0002](0002-cns-visual-structured-migration.md).

Cross-system rows are graded **per component**, not row-as-atom. A `spine + CNS` row scores spine normally and the CNS component as `legacy_deferred`; a paired legacy system never blocks the structured system's gate.

Two metrics drive promotion:

- **`component_safe_outcome_rate`** (per system) — across rows where the component is graded against this system, the share whose outcome class matched. This is the system-level promotion metric. `legacy_deferred` components are excluded from this metric for the structured systems they appear with.
- **`exact_calculation_rate`** (per system) — restricted to `exact_calculation` components; share where the produced PI% matched the expected PI%.

A third, observational metric is recorded for context but does **not** drive promotion:

- **`cross_system_end_to_end_rate`** — share of cross-system rows where every component matched its outcome class *and* the row's combined PI% matched. Rows containing any `legacy_deferred` component are excluded from this metric. Rows containing only `legacy_deferred` components (e.g. CNS + Visual) are classified `legacy_deferred_cross_system` and excluded entirely.

### Per-system thresholds

| System | Safe-outcome ≥ | Exact-calculation ≥ |
|---|---:|---:|
| Hearing | 95% | 90% |
| Spine | 95% | 90% |
| Respiratory | 90% | 80% |
| Renal | 90% | 80% |
| Gastro-digestive | 85% | 70% |
| Upper limb | 85% | 70% |
| Lower limb | 85% | 70% |
| CNS | deferred | deferred |
| Visual | deferred | deferred |

CNS and visual remain `legacy` until they have a structured model.

### Registry implication

`validateSystemRegistry()` continues to enforce wiring at runtime startup. A separate CI-only `validateStructuredLivePromotion(system)` enforces the gate above. Engineers cannot flip `mode: "structured_live"` by hand without that check producing evidence.

## Considered alternatives

- **(a) Curated goldens only.** Cheap to author, easy to game — a system can pass 10 cherry-picked rows while real-world inputs fail. Rejected.
- **(b) Excel parametric only.** High confidence, but blocks the sprint on test-runner ergonomics and conflates row-level noise with promotion-blocking failures. Rejected.

## Non-goal

`structured_live` does **not** mean the extractor understands every possible clinical sentence. It means each known scenario class either calculates correctly, clarifies correctly, or fails safely.

## Consequences

- `structured_shadow` becomes useful infrastructure: wired and observable, generating the evidence that promotes a system back to `live`.
- The current registry (7 systems flagged `live` on wiring alone) is provisional — each must re-earn `live` status under this gate. See follow-up decision on demotion blast radius.
- The Excel workbook becomes a load-bearing test fixture. Schema changes to the workbook require a fixture-loader update.
- Inner-loop test speed is preserved: default `vitest run` excludes the shadow suite.
