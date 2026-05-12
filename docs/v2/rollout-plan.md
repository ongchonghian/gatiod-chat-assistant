# V2 Rollout Plan

The migration from legacy to V2 is staged. At any point, the rollout state is determined by:

1. The `mode` field on each entry of `V2_SYSTEM_REGISTRY` (`legacy | structured_shadow | structured_live`).
2. Whether `/api/chat` defaults to V2 or legacy.

This document describes the five rollout stages and the gate criteria each system must clear before mode flips.

---

## Current rollout status — 2026-05-11

**Active stage: Stage 3+ (partially into Stage 4)**

7 of 9 systems are `structured_live`. CNS and Visual remain `legacy` pending
ADR-0002 resolution. All four policy fixes are applied. ADR-0001 calibration
reports exist for all 7 live systems and all meet their promotion thresholds.

### Per-system ADR-0001 evidence

| System | Mode | Safe-outcome | Threshold | Exact-calc | Threshold | Gate |
|---|---|---:|---:|---:|---:|---|
| hearing | `structured_live` | 100.0% | ≥ 95% | 100.0% | ≥ 90% | **CLEARED** |
| spine | `structured_live` | 100.0% | ≥ 95% | 96.8% | ≥ 90% | **CLEARED** |
| renal | `structured_live` | 100.0% | ≥ 90% | 100.0% | ≥ 80% | **CLEARED** |
| respiratory | `structured_live` | 100.0% | ≥ 90% | N/A (0 exact rows) | ≥ 80% | **CLEARED** |
| gastro_digestive | `structured_live` | 100.0% | ≥ 85% | N/A (0 exact rows) | ≥ 70% | **CLEARED** |
| upper_limb | `structured_live` | 93.6% | ≥ 85% | 80.2% | ≥ 70% | **CLEARED** |
| lower_limb | `structured_live` | 85.7% | ≥ 85% | 72.4% | ≥ 70% | **CLEARED** (borderline) |
| cns | `legacy` | — | deferred | — | deferred | DEFERRED — ADR-0002 open |
| visual | `legacy` | — | deferred | — | deferred | DEFERRED — ADR-0002 open |

Sample sizes: upper\_limb n=1991, lower\_limb n=1164, spine n=132, gastro n=44,
hearing n=45, renal n=10, respiratory n=16.

**Note on `structured_shadow` runtime mode:** In practice, the per-system shadow
comparison phase (the `GATIOD_EXTRACTOR_SHADOW=true` runtime path) was skipped
for all 7 currently-live systems. Systems moved from `legacy` (components wired)
directly to `structured_live` backed by Excel calibration evidence. All 7 systems
remain on the `PROVISIONAL_STRUCTURED_LIVE` allowlist even though their
ADR-0001 evidence now meets the promotion thresholds. The runtime shadow
infrastructure stays available for CNS and Visual when ADR-0002 is resolved.

---

## Stages

| Stage | Status | Default route | Registry state | What doctors experience |
|---|---|---|---|---|
| 0 | ✓ COMPLETE | Legacy | All systems `legacy`; V2 runs as shadow only | Legacy responses; V2 logs only |
| 1 | — SKIPPED ¹ | Legacy | Upper limb `structured_shadow`; others `legacy` | Same as stage 0; V2 internal testing via `/api/chat/v2` |
| 2 | ✓ COMPLETE | V2 (upper limb only) | Upper limb `structured_live`; others `legacy` | V2 owns upper-limb assessments; other systems still legacy |
| 3 | ✓ COMPLETE | V2 (limbs + spine) | Upper, lower, spine `structured_live`; others `legacy` | V2 owns all musculoskeletal; others still legacy |
| 4 | ⬤ IN PROGRESS | V2 (all systems) | All systems `structured_live` | V2 owns all assessments |
| 5 | NOT STARTED | V2 only | All `structured_live`; legacy disabled except admin/fallback | Legacy is reachable only via explicit `/api/chat/legacy` admin route or doctor-selected fallback after V2 failure |

¹ Stage 1 was skipped. Systems moved from `legacy` (components wired) directly to
`structured_live` backed by Excel calibration evidence, bypassing the runtime
`structured_shadow` phase. CNS and Visual components are fully wired and ready
for a formal shadow run when ADR-0002 is resolved.

---

## Per-system promotion gate

A system must clear all of these before its registry mode flips to `"structured_live"`:

| Gate | Verified by |
|---|---|
| `extractor` exists and produces `StructuredExtractionResult` | Unit tests on the extractor module |
| `readinessValidator` exists and returns ready/blocking-questions correctly | Unit tests on the validator |
| `argBuilder` exists and validates against the engine's Zod schema (`safeParse`) | Unit tests + property tests on schema invariants |
| `resultRenderer` exists, is deterministic, and handles all exception cases (DBE/ROM conflicts, amputation suppression, multi-stream CVC, caps, doctor PI deviation) | Unit tests covering each exception |
| Golden tests pass | 15–25 conversation-level tests in `tests/v2/<system>/` |
| No-tool-no-PI guard wired and tested | Tests covering `V2RenderedResponse` validator |
| Audit trail records confirmed facts, tool args (with provenance), and result | Audit log inspection on a representative shadow run |
| `validateSystemRegistry()` passes at server startup | CI startup smoke test |

The `structured_shadow` mode is mandatory for at least one release cycle before a system goes `structured_live`. Compare shadow output against the legacy result in audit logs. Any divergence above an agreed threshold blocks promotion.

---

## Stage promotion gate

In addition to per-system gates, each stage requires:

| Transition | Status | Additional gate |
|---|---|---|
| 1 → 2 | ✓ COMPLETE ¹ | Shadow comparison shows ≥99% agreement on PI% for upper limb across last N sessions; no `v2_failure` events of severity > advisory in the last release window. |
| 2 → 3 | ✓ COMPLETE | Lower limb and spine clear per-system gates; legacy fallback rate for upper limb in stage 2 is below an agreed threshold (e.g. <2% of confirmed assessments). |
| 3 → 4 | ⬤ PARTIAL | Remaining systems clear per-system gates; all policy fixes applied. **Cleared:** respiratory, renal, gastro, hearing (all ADR-0001 evidence meets thresholds; all policy fixes applied). **Blocking:** CNS and visual deferred per ADR-0002 — components wired, mode stays `legacy`. |
| 4 → 5 | NOT STARTED | All systems running `structured_live` for at least one full release cycle; legacy fallback rate aggregated across all systems is below the agreed threshold; admin override route (`/api/chat/legacy`) ready for cases where legacy is genuinely needed. |

¹ The specific 99% shadow-comparison metric was not tracked via runtime shadow logs.
Upper limb promotion was evidenced by ADR-0001 calibration (93.6% safe-outcome,
80.2% exact-calc on n=1991 rows), which met the 85%/70% per-system threshold.

---

## Rollback

If a system shows elevated `v2_failure` rates or doctor complaints after promotion:

1. Flip its registry mode back to `"structured_shadow"` (one-line change). `validateSystemRegistry()` will pass because the four components still exist.
2. Record the rollback reason in an audit event `v2_system_rolled_back`.
3. Investigate via shadow logs and the failure audit trail.
4. Fix the issue, re-verify gates, and re-promote.

**Do not** delete the four capability components on rollback. The shadow path keeps them exercised.

---

## Shadow-mode invariants

While a system is in `structured_shadow`:

- Structured extractor runs alongside the legacy path.
- **Only legacy state updates `V2SystemState`.** Structured output is captured for logs only.
- Audit event `v2_extractor_shadow` records both legacy and structured summaries for divergence analysis.
- Gate on `process.env.GATIOD_EXTRACTOR_SHADOW === "true"` so shadow can be toggled without code changes.

This is the only sanctioned form of parallel extraction. Do not let shadow output influence policy or live state — see [architecture-decisions.md](architecture-decisions.md) D5.

---

## What "legacy disabled" means in stage 5

- `/api/chat` no longer accepts requests that route to legacy.
- `policyEngine.ts` `delegate_legacy` branch is unreachable for `structured_live` systems (which is all of them at stage 5).
- `processChat()` from the legacy module is invoked only by:
  1. Explicit doctor selection after a V2 failure (D11), with full audit logging.
  2. Admin requests via `/api/chat/legacy`.
- Legacy code is not removed at stage 5. Removal is a separate decision after stage 5 has run for a full release cycle without significant fallback usage.
