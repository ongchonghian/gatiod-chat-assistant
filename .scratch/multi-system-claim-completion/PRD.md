# Multi-System Claim Completion

Status: needs-triage
Category: enhancement

## Problem Statement

Doctors using the GATIOD chat assistant to assess multi-system work-injury claims abandon the conversation before producing a final PI%. The drop-off scales with system count: a 1-system claim completes reliably, but a 5–9 system polytrauma case routinely ends mid-flow with several systems in `collecting` and no final PI% rendered.

The pipeline as currently shipped optimises for *correctness* (factsHash snapshots, no-tool-no-PI guard, no silent inference of clinical fields). It does not optimise for *completion*. There is no:

- Visible anchor that shows the doctor "how much is left" across the 9 systems.
- Distinction between "session went idle because the doctor is done" and "session went idle because the doctor is stuck". Without that distinction, abandonment is invisible to telemetry.
- Doctor-affirmed terminal event. Today, the global CVC tool is implicitly terminal, but it executes whenever ≥2 systems are calculated — the doctor never *commits* to "this is my final claim".
- Deterministic path for navigation utterances like "where are we", "skip CNS", "we're done". These get classified by the LLM and risk drift.

The downstream effect is that a doctor who has spent 20 minutes resolving upper-limb ROM, spine ASIA grade, and hearing AHL has no incentive against quitting before the cross-system CVC runs — the work they did is locked in per-system, but the *claim* is not. The medical board then receives a half-done claim that requires rework.

The problem is most acute at N ≥ 5 systems (decision fatigue, progress invisibility) but the absence of a terminal Submit event affects every claim, including N=1, because the audit trail has no single event meaning "the doctor declared this complete".

## Solution

Introduce **multi-system claim completion** as a first-class concept in the V2 pipeline. Four cooperating pieces:

1. **Claim plan sub-header** — a persistent UI strip directly below the AppBar that shows one pill per detected system, each carrying status colour and subtotal. The sub-header is the doctor's always-visible anchor for "how much is left", and the surface on which the Submit chip and "+ add system" overflow live. It is empty at the start of a session and grows as systems are detected; it never shows all 9 by default.

2. **Doctor-affirmed Submit event** — a new `claim_submitted` state transition that is the only path to a final PI% reaching the audit log. For multi-system claims, clicking Submit triggers the existing global-CVC confirmation card; for single-system claims, Submit renders the per-system result as the claim's final. Either way, the Submit event fires once and is what the success metric is measured against.

3. **Meta-intents** — a deterministic, LLM-free routing class for navigation utterances ("status", "skip CNS", "go back to upper limb", "submit"). Triggered by a small regex set and by chip clicks; never enters the extraction pipeline. Falls through to normal routing on a miss.

4. **Plan-of-attack in semantic consensus** — extends the existing `PendingConsensus` message to include the system order inline ("I'll work through these as: 1) upper limb, 2) spine, 3) hearing"). No new turn; same chip set, with a "reorder" variant added.

From the doctor's perspective: when they describe a multi-system injury, the sub-header populates with detected systems in narrative order. They work through them at their own pace, clicking pills to jump if needed. When every detected system is calculated or explicitly skipped, a Submit chip appears. Clicking Submit walks them through the cross-system CVC confirmation, then renders the final PI% and records the claim as complete.

The change is invisible for the happy path of a single-system claim — the sub-header shows one pill, the Submit chip appears once the system is calculated, and clicking it produces the final result identical to today's behaviour. The full design only activates at N ≥ 2 systems.

Correctness invariants from the existing architecture (D2 inference boundary, D4 factsHash snapshot, D10 no-tool-no-PI guard, D11 fail-loud) are preserved unchanged. The new modules are additive.

## User Stories

1. As a doctor opening a new chat session, I want no sub-header chrome to appear until I have described an injury, so that the interface doesn't anticipate work I haven't committed to.

2. As a doctor describing one injury, I want a single system pill to appear in a sub-header below the AppBar, so that I see my work-in-progress acknowledged without it dominating the screen.

3. As a doctor describing several injuries in a single narrative, I want each detected system to appear as its own pill in the order I introduced them, so that the interface mirrors my own clinical narrative.

4. As a doctor at any point in a multi-system flow, I want to see at a glance how many systems are calculated, how many are still in `collecting`, and how many are explicitly skipped, so that I can decide whether to push on or pause.

5. As a doctor with a multi-system claim, I want each pill to show the per-system subtotal PI% once calculated, so that I can sanity-check accumulating values without opening a breakdown.

6. As a doctor working through a multi-system claim, I want to click any pill to jump back to that system, so that I can correct or re-confirm a finding without losing my place in the broader flow.

7. As a doctor reviewing a bilateral assessment, I want pills for bilateral systems (upper limb, lower limb, hearing, visual) to show a small "L+R" badge inline, with per-side breakdown visible on click, so that I see the bilateral structure without taking up additional pill slots.

8. As a doctor doing a polytrauma assessment, I want to be able to add a system I haven't mentioned yet via a "+ add system" overflow chip at the end of the row, so that I can extend my claim without having to manufacture a natural utterance for the system.

9. As a doctor who has finished a per-system assessment, I want the pill colour to change and a single short line to appear in chat ("Upper limb saved at 12% — 3 systems left"), so that I get a clean acknowledgment of progress without the interface celebrating at me.

10. As a doctor whose per-system facts have changed after I last confirmed them, I want the pill to mark as `stale` and a single chip to appear in chat showing only the changed fields, so that I can re-confirm with one click rather than re-reading the full confirmation summary.

11. As a doctor who has completed every system I care about, I want a Submit Claim chip to appear in the sub-header, so that I know the moment I have everything I need.

12. As a doctor on a single-system claim, I want clicking Submit to produce the final PI% directly, so that the experience for simple cases is no slower than today.

13. As a doctor on a multi-system claim, I want clicking Submit to walk me through the global-CVC confirmation card (preview of subtotals, exclusion chips, PTI bonus toggle), so that the one moment of medico-legal irreversibility has explicit friction.

14. As a doctor who has submitted a claim, I want the session to lock into a `claim_submitted` state where new utterances are gently redirected ("This claim is submitted; start a new one?"), so that I do not accidentally add findings to a closed claim.

15. As a doctor partway through a complex claim, I want to type "where are we" or "status" or "what's left" and get a deterministic plan summary back, so that I can reorient without re-reading the conversation.

16. As a doctor who decides a detected system isn't applicable, I want to type "skip CNS" or click a Skip chip on a pill's peek menu, so that the system is marked `skipped_by_user` and doesn't block Submit eligibility.

17. As a doctor who wants to revisit a calculated system, I want to type "go back to upper limb" or "edit shoulder", so that the next turn re-routes to that system's confirmation card without losing the rest of my state.

18. As a doctor who types "submit" or "finalise" or "we're done" mid-flow, I want the same deterministic path as clicking the Submit chip, so that the keyboard-driven path is equivalent to the chip-driven path.

19. As a doctor who describes multiple systems in one paste, I want the semantic consensus message to include an inline plan ("I'll work through these as: 1) upper limb, 2) spine, 3) hearing"), so that I see the agent's intended order before extraction commits.

20. As a doctor who disagrees with the proposed order, I want a Reorder chip on the consensus message, so that I can correct the sequence before any per-system work starts.

21. As a doctor whose claim touches CNS or Visual before those systems are migrated to `structured_live`, I want their pills to render with a distinct visual treatment indicating the legacy path, so that I understand why the experience for those pills is different from the others.

22. As a doctor working a single-system claim, I want the entire claim-plan sub-header to remain present but minimal (one pill), so that the visual language is consistent across N=1 and N=9 cases.

23. As a doctor who has not produced enough systems for the global CVC to run, I want the Submit chip to remain hidden (or visibly disabled with a tooltip), so that I don't click into a confirmation flow that can't complete.

24. As an audit reviewer reading a completed claim, I want a single `claim_submitted` event with a timestamp and the doctor's identity in the audit log, so that the moment of clinical sign-off is unambiguous.

25. As an audit reviewer, I want every final PI% rendered to the doctor to be preceded by a recorded Submit event, so that no number ever appears as "final" without an explicit doctor commitment.

26. As a doctor whose narrative falls outside the meta-intent regex (e.g. "I think I'm probably done now"), I want the utterance to fall through to normal routing without ambiguity, so that the meta path being deterministic doesn't cost me ambiguous misclassifications.

27. As a doctor mid-confirmation for a system, I want chip-driven and free-text answers to be treated as equivalent (no re-prompt for a fact already in `extractedFacts`), so that the conversation does not double-ask me for things I've already provided.

28. As a doctor on a narrow screen (laptop on the move), I want the sub-header to gracefully overflow extra pills into a horizontal scroll or compact menu, so that the chat surface itself isn't pushed off-screen.

29. As a doctor returning to a session after a break, I want the sub-header to reflect the exact state I left in (which systems are calculated, which still in `collecting`, whether Submit was visible), so that re-entry doesn't require re-reading the whole conversation.

30. As a doctor whose multi-system narrative includes a system that the LLM hasn't been told to assess (e.g. described as "panic attacks" when CNS Section 4 emotional disorders applies), I want the assistant to either map it correctly or surface it as an unsupported finding — never silently produce a PI% number for an inferred field.

## Implementation Decisions

### New deep modules

- **`claim-submission` module** — the single source of truth for "is this claim ready to submit?" and "execute submission". Pure functions over `V2SessionState`. Encapsulates the eligibility check (all detected systems are `calculated` or `skipped_by_user`), the state transition (sets `claimSubmittedAt`, fires the audit event), and the idempotency guard (cannot re-submit). Consumed by `policyEngine.ts` on the `finalise_claim` operation, by the meta-intent handler on a "submit" utterance, and by the projection module to compute the Submit chip's visible state.

- **`meta-intents` module** — deterministic regex recogniser + typed dispatcher. Pure function `classifyMetaIntent(utterance) → MetaIntent | null`. Returns a discriminated union covering `status`, `skip_system`, `jump_to_system`, and `finalise_claim`. Run by `router.ts` before existing route logic; a non-null result short-circuits the rest of the routing pipeline. A null result means "fall through to normal routing".

- **`claim-plan-projection` module** — pure transform `projectClaimPlan(state) → ClaimPlanView`. Computes the sub-header shape (pill list, statuses, subtotals, submit button state, "next system" hint) from the canonical session state. The frontend consumes the view; no business logic lives in React.

- **`stale-confirmation-diff` module** — pure transform `diffFacts(oldFacts, newFacts) → DiffLine[]`. Produces clinically-readable lines describing what changed since the last confirmed snapshot. Reuses the existing clinical display layer (from the prior `clinical-display-layer` PRD) for field labels and enum translation. Consumed by the stale-confirmation diff chip's `onClick` handler.

### Contracts / state-machine changes

- Extend `RouteOperation` from `"lookup" | "assessment" | "global_cvc" | "clarify"` to `"lookup" | "assessment" | "global_cvc" | "clarify" | "meta" | "finalise_claim"`. The new variants are short-circuit routes that bypass extraction.

- Add `MetaIntent` discriminated union to `contracts.ts`: `{ kind: "status" } | { kind: "skip_system"; system } | { kind: "jump_to_system"; system } | { kind: "finalise_claim" }`.

- Add `V2SessionState.claimSubmittedAt?: string` — an ISO timestamp. Presence is the boolean "is this claim closed?". Coerced by `stateMachine.ts:coerceV2State` for migration safety.

- Add `ClaimPlanView` type — the projection consumed by the frontend. Fields: `systems: SystemPillView[]`, `submitState: { visible: boolean; reason?: string }`, `nextSystem?: GatiodSystemKey`. Each `SystemPillView` carries `{ system, label, status, subtotalPercent?, sideBreakdown?, isLegacyMode }`.

### Pipeline modifications

- `policyEngine.ts` handles two new operations:
  - `RouteOperation = "meta"` — dispatches to the per-intent handler based on the `MetaIntent.kind`. Status intents return a deterministic plan-render response (no LLM); skip intents set `claimComponentOverrides[X] = { status: "skipped_by_user", source: "user_choice" }`; jump_to intents set `pendingClarification` to re-route the next turn.
  - `RouteOperation = "finalise_claim"` — calls `claim-submission.canSubmit`. If blocked, returns a clarification listing the blocking systems. If ready: for multi-system claims, returns the existing `assess_global_cvc` confirmation flow; for single-system claims, returns a `claim_submitted` decision that renders the per-system result as final and fires the audit event.

- `router.ts` runs `classifyMetaIntent` before existing route logic. Non-null result emits a `RouteDecision { operation: "meta", metaIntent }`. Chip clicks for the Submit chip emit `operation: "finalise_claim"` directly (chip handlers in the frontend translate UI events to route decisions).

- `policyEngine.ts` post-Submit guard: when `state.claimSubmittedAt` is set, every operation except `lookup` and `meta:status` returns a soft-redirect: "This claim is submitted; start a new one?" with a chip to reset.

- Semantic consensus message renderer (where `PendingConsensus.message` is composed) is extended to include a plan-of-attack block when `candidateSystems.length >= 2`. The block lists systems in detection order with their labels. A `Reorder` chip is added alongside the existing `Proceed | Edit | Choose system first | Reject` chips.

### Frontend

- A new `ClaimPlanSubHeader` React component slots between `AppBar` and `ChatPanel` in `web/src/App.tsx`. Its props are the `ClaimPlanView` projection.

- Sub-components: `SystemPill` (status colour, label, subtotal, bilateral badge), `SystemPeek` (popover with per-side breakdown, jump/skip/edit chips), `SubmitChip` (visible per `submitState`), `AddSystemMenu` (overflow chip + menu of remaining systems).

- The sub-header is hidden when `detectionOrder.length === 0` and `claimSubmittedAt` is unset. A submitted claim shows the sub-header in a locked visual state with a "Submitted at <timestamp>" badge.

- Narrow-viewport behaviour: the pill row uses horizontal overflow with momentum scroll. The Submit chip and Add overflow are pinned to the right.

- CNS and Visual systems (while in `legacy` mode) render with a distinct visual class (e.g. dashed border + a "legacy mode" tooltip on hover). They do not participate in the Submit eligibility check until they reach `calculated` via the legacy path.

### System prompt hardening

- Add a "do not produce" constraint block to the chat layer's system prompt. Explicit prohibitions: no PI% numbers, no severity inferences, no ASIA grade assignment, no diplopia zone classification, no final/total/system-generated PI language. These are the same fields D2 forbids at extraction time; the prompt now also forbids the LLM from generating them in its narrative text. D10's regex guard remains the post-hoc catch.

### Audit events

- New event `claim_submitted` with payload `{ sessionId, doctorId, submittedAt, systemSubtotals, finalPiPercent, claimShape: { detected[], skipped[], calculated[] } }`. Emitted exactly once per session.

- Existing events (`v2_failure`, `v2_legacy_fallback_*`, per-system confirmation events) are unchanged.

### ADRs to be created alongside implementation

- **ADR-0006: Claim submission as a first-class state transition** — captures the trade-off between strict / pragmatic / doctor-affirmed completion definitions and records why doctor-affirmed was chosen.
- **ADR-0007: Meta-intents as a deterministic, LLM-free routing class** — captures the trade-off between deterministic regex, chip-only, and LLM-classify approaches.

### CONTEXT.md additions

- Root `CONTEXT.md`: add "Submit event" / "claim submission" / "claim_submitted" as domain terms.
- `src/v2/CONTEXT.md`: add "Meta intent" / "Meta routing" under Pipeline gates; add "Claim plan sub-header" as a UI primitive with a one-paragraph entry under Pipeline gates noting it visualises the proactive system queue.

## Testing Decisions

Tests cover external behaviour through public module interfaces, not internal helpers. State fixtures are used in preference to ad-hoc state construction, following the precedent set by existing per-system extractor and readiness tests.

### `claim-submission` module tests

- `canSubmit` returns `ok: true` only when every system in `state.detectionOrder` is `calculated` or `skipped_by_user`. Tested across single-system, 3-system, 9-system, and all-skipped scenarios.
- `canSubmit` returns `ok: false` with `blockingSystems` populated whenever any detected system is `idle` or `collecting`. Tested across each possible blocking-status combination.
- `submitClaim` sets `claimSubmittedAt` exactly once; idempotency check rejects a second call with a recognisable error result.
- `submitClaim` is a no-op when `canSubmit` returns `ok: false`.
- After submission, mutation helpers (`applyStructuredExtraction`, `setConfirmationPending`, etc.) leave `claimSubmittedAt` untouched — submission is sticky.

Prior art: `tests/v2/policyEngine.test.ts` for state-fixture-driven tests over policy decisions.

### `meta-intents` module tests

- Every regex pattern: positive cases ("where are we" / "what's left" / "summary" / "status" → `{ kind: "status" }`), negative cases ("I'm wondering where the patient was" → null).
- `skip_system` pattern matches `"skip CNS"`, `"drop hearing"`, `"we don't need spine"` and resolves the system token to the canonical `GatiodSystemKey`. Mismatched or ambiguous system tokens return null (fall through to normal routing).
- `jump_to_system` pattern matches `"go back to upper limb"`, `"edit shoulder"` and resolves the system from synonym table aliases.
- `finalise_claim` pattern matches `"submit"`, `"finalise"`, `"we're done"`, `"that's everything"`.
- Empty input and pure-noise input return null without error.

Prior art: `src/v2/textNormalizer.ts` and its tests for regex-based deterministic recognisers.

### `claim-plan-projection` module tests

- Single-system fixture → one pill, no Submit chip when system is `collecting`, Submit chip visible when system is `calculated`.
- 3-system fixture, all `calculated` → Submit chip visible; `nextSystem` is null.
- 5-system fixture, 3 calculated + 2 collecting → Submit chip hidden; `nextSystem` set to the earliest-detected collecting system.
- Bilateral fixture (upper limb with two sides) → one pill with `sideBreakdown: { left, right }`.
- CNS in `legacy` mode → pill rendered with `isLegacyMode: true`.
- Post-submit fixture (`claimSubmittedAt` set) → pill row locked; Submit chip replaced with a "Submitted" badge.
- All-skipped-by-user edge case → Submit chip visible (skip is a valid terminal state).

Prior art: `tests/v2/claimPlan.test.ts` (the existing internal projection used for handoff decisions).

### `stale-confirmation-diff` module tests

- Diff between identical snapshots → empty `DiffLine[]`.
- Diff with one changed scalar fact (e.g. ROM angle) → one line with the clinical label and old/new values.
- Diff with one added fact (e.g. previously absent nerve selection) → one "added" line.
- Diff with one removed fact → one "removed" line.
- Multi-field diff (e.g. spine region + ASIA grade both changed) → lines in stable order.
- Diff respects the clinical-display-layer's enum translations (e.g. `lumbo_sacral` → "Lumbo-Sacral").
- Diff of fact types not exposed to the doctor (internal-only fields) → those fields are filtered out.

Prior art: the clinical-display-layer module's existing tests for translation correctness.

### Integration tests

- End-to-end multi-system claim: open session → describe 5 systems → resolve each → click Submit → confirm GCVC → final PI% rendered → `claim_submitted` event emitted exactly once.
- Meta-intent integration: mid-flow "where are we" → status response renders without invoking the LLM (verified via spy on the chat layer).
- Post-submit guard: utterance after submission → soft-redirect response, no extraction.

Prior art: `tests/v2/router.test.ts` and `tests/v2/policyEngine.test.ts` for full-pipeline routing assertions.

### Frontend tests

Out of scope for this PRD. The frontend is a dumb consumer of `ClaimPlanView`; correctness of the view is server-side. Visual regression tests for the sub-header layout are a follow-on ticket.

## Out of Scope

- **Per-system improvements** — chip reduction, default leverage, just-in-time questioning *within* a system. These are valuable but separate workstreams handled per-system (REQ-A1–A6 for CNS/Visual, slot-schema migration for others). This PRD makes the *cross-system* orchestration work and assumes per-system improvements continue in parallel.

- **Smart system reordering** — automatic re-ordering of `detectionOrder` based on per-system "effort score". Explicitly rejected during planning; the codebase has no effort model and adding one introduces an unaudited heuristic. The doctor's click-to-jump on a pill is the manual escape hatch.

- **LLM-classified meta-intents** — explicitly rejected in favour of deterministic regex + chips. If misses become a problem post-launch, an LLM fallback can be re-evaluated as its own ADR.

- **Quantitative success thresholds** — the PRD defines *what* completion means but not *target rates* (e.g. "completion rate ≥ 85%"). The first ship establishes a baseline; thresholds get set after one cycle of telemetry.

- **Visual design treatment for transitional CNS/Visual** — the PRD names the requirement ("distinct visual class for legacy pills") but the actual visual design (dashed border vs. striped fill vs. badge) is a design decision that follows.

- **Doctor preferences / configuration** — no settings for "ceremony level", "auto-skip system X", or similar. The PRD ships one opinionated default.

- **Animation / motion design** — explicitly rejected at the lifecycle-signals decision. Pill colour changes are CSS-driven, not animated.

- **Drag-to-reorder pills** — rejected in favour of strict detection-order + click-to-jump.

- **Bulk-narrative pre-extraction confirmation as a separate turn** — rejected in favour of inline plan-of-attack in the existing semantic consensus message.

- **Session export, claim resume across HTTP boundaries beyond what exists today** — out of scope; this PRD assumes existing session persistence.

- **Frontend visual regression tests** — follow-on ticket once the sub-header design is settled.

## Further Notes

### Behavioural design framing

The PRD is anchored on **completion without correctness loss**. The existing pipeline already enforces correctness (D2, D4, D10, D11). The new modules add a *completion* primitive that the codebase did not previously have, and a *visible anchor* (the sub-header) that the doctor relies on to navigate at high N.

Loss aversion underpins the design at three points:

- The endowed-progress effect of accumulating calculated pills creates a sunk cost the doctor doesn't want to abandon.
- Save-point feedback ("Upper limb saved at 12% — 3 systems left") makes that endowment legible after each system.
- The post-Submit lock prevents accidental loss of the submitted claim.

Friction is deliberately asymmetric: per-system loops have friction removed (just-in-time chips, never re-ask, diff chips for stale confirmations), while the single moment of medico-legal irreversibility (the global-CVC confirmation gated behind Submit) has friction explicitly added.

### Dependencies on existing work

- The clinical display layer (prior `clinical-display-layer` PRD) provides the field-label and enum-translation infrastructure that `stale-confirmation-diff` and the sub-header both consume.
- REQ-A1–A6 (CNS and Visual migration to `structured_live`) is the natural completion of this work; until those land, two of the nine pills render in the transitional visual class. The PRD ships without waiting for them.
- ADR-0003 (semantic consensus) and ADR-0005 (pending clarification context) are the foundation the inline plan-of-attack extends.

### Risks

- **Regex false negatives** on meta-intents could leave doctors typing "where are we?" and falling into normal extraction, producing a confused response. Mitigation: the regex set ships with a generous coverage and gets tightened post-launch from real utterances. Misses degrade gracefully.

- **Sub-header competing for attention with the chat surface**. Mitigation: the sub-header is restrained MUI (single line, no animation, no toasts), and the existing chat panel layout is unchanged. Doctor's primary attention stays on chat.

- **Submit chip discoverability**. The chip only appears once all systems are done. Doctors who don't notice it may continue describing things they don't realise are out of scope for their current claim. Mitigation: when all systems are calculated and 30 seconds pass without action, the proactive system queue surfaces a final-turn message "Ready to submit?" with the Submit chip echoed inline.

- **The post-submit lock could feel rude**. If a doctor types a follow-up question intending to refine, getting "This claim is submitted; start a new one?" might frustrate them. Mitigation: the soft-redirect includes a chip `[Reopen this claim]` that reverses the submission (clears `claimSubmittedAt`, undoes the audit event idempotently). The lock is intent-respecting, not coercive.

### Open questions for triage

- The exact `MetaIntent` regex set — listed in the implementation issues, not in this PRD.
- The visual design of the transitional CNS/Visual pill class — handed off to design.
- The text of the "no PI%" system prompt addition — drafted alongside the chat-layer change.
- Whether the "Reopen this claim" chip should re-set `claimSubmittedAt` to null (true reversal) or store an `unlocked: true` side flag (preserve audit trail of the original submission). Worth its own short ADR.

## Comments
