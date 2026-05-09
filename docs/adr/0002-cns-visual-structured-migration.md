# 0002 — CNS and Visual structured migration

## Status

Proposed (2026-05-09).

## Context

CNS and Visual appear frequently in the cross-system scenario catalogue (CNS: 119 components, Visual: 115 components out of 360 cross-system rows), but both remain `legacy` in the V2 system registry. Neither has a structured extractor, readiness validator, arg builder, result renderer, or instance-aware state model.

A structured CNS migration must implement the Section A "highest-score" rule, Section B neurological components with intra-section CVC, Section C paralysis mapping, and the specialist-gated exclusions that prevent CNS-B from absorbing bladder/bowel/spasm findings that belong elsewhere. A structured Visual migration must implement left-eye and right-eye instances, a diplopia instance, acuity / visual-field / diplopia-zone extraction, the monocular cap, and the additive subtotal across the three instances.

## Decision pending

Determine when and how CNS and Visual migrate from `legacy` to `structured_shadow`, and eventually to `structured_live` under [ADR-0001](0001-structured-live-promotion-gate.md).

## Current sprint decision

CNS and Visual remain `legacy`. The Excel shadow runner classifies CNS and Visual components inside cross-system rows as `legacy_deferred`. They do not block promotion evidence for paired structured systems (a `spine + CNS` row counts toward spine's gate; the CNS component does not count against any system's gate).

## Open questions

- Should Visual migrate before CNS because its instance model (eye + diplopia) is simpler than CNS's section-based structure?
- What is the curated golden set for CNS Section A / B / C, including the specialist-gating rules?
- What is the curated golden set for Visual covering left-eye, right-eye, diplopia, monocular cap, and the additive subtotal?
- How should `legacy_deferred` cross-system rows count in the `cross_system_end_to_end_rate` metric? (Excluded entirely vs. counted as deferred-success when both legacy systems are routed correctly.)

## Consequences

- The current sprint avoids partial extraction-only shadow implementations that would create half-trusted state.
- CNS / Visual rows provide *routing* and *legacy-deferred* evidence only — not structured calculation evidence.
- Full migration requires a dedicated follow-up sprint that completes extraction, readiness, arg builder, renderer, and instance model in one slice for each system.
