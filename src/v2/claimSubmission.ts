/**
 * Claim submission — the single source of truth for "is this claim ready
 * to submit?" and "execute submission". Pure functions over V2SessionState.
 *
 * Slice #07 of the multi-system claim completion PRD. Implements the
 * eligibility rule and idempotent state transition from ADR-0006.
 *
 * Consumed by:
 *   - policyEngine.ts on RouteOperation = "finalise_claim"
 *   - claimPlanProjection.ts (computes submitState.visible via canSubmit)
 *   - meta-intent handler in slice #10 on the "finalise" intent
 *
 * See:
 *   - docs/adr/0006-claim-submission-state-transition.md §3 (Eligibility rule)
 *   - docs/adr/0006-claim-submission-state-transition.md §8 (Idempotency)
 */

import type { GatiodSystemKey, V2SessionState } from "./contracts.js";

export interface CanSubmitOk {
  ok: true;
  blockingSystems: never[];
}

export interface CanSubmitBlocked {
  ok: false;
  blockingSystems: GatiodSystemKey[];
  /** True when the blocker is "already submitted", not "system in progress". */
  alreadySubmitted?: boolean;
}

export type CanSubmitResult = CanSubmitOk | CanSubmitBlocked;

/**
 * A system is "terminal" — and therefore does not block submission — when
 * it has reached `status: "calculated"` or been marked
 * `skipped_by_user` via a claim component override. Matches ADR-0006 §3.
 */
function isTerminalForSubmit(state: V2SessionState, system: GatiodSystemKey): boolean {
  if (state.claimComponentOverrides[system]?.status === "skipped_by_user") return true;
  return state.systems[system]?.status === "calculated";
}

/**
 * Determines whether the claim is eligible for submission.
 *
 * Returns ok=true only when every detected system is in a terminal state
 * (calculated or skipped_by_user). Otherwise returns ok=false with the
 * list of systems still blocking submission, in detection order.
 *
 * Once a claim is already submitted (claimSubmittedAt set), returns
 * ok=false with alreadySubmitted=true so callers can produce the
 * "already submitted" soft redirect rather than re-firing the audit event.
 */
export function canSubmit(state: V2SessionState): CanSubmitResult {
  if (isClaimSubmitted(state)) {
    return { ok: false, blockingSystems: [], alreadySubmitted: true };
  }
  const blockingSystems = state.detectionOrder.filter(
    (system) => !isTerminalForSubmit(state, system),
  );
  if (blockingSystems.length > 0) return { ok: false, blockingSystems };
  if (state.detectionOrder.length === 0) {
    return { ok: false, blockingSystems: [] };
  }
  return { ok: true, blockingSystems: [] };
}

/**
 * Atomically marks the claim as submitted by setting claimSubmittedAt.
 *
 * - When canSubmit returns ok=false, returns the original state unchanged
 *   (reference-equal, no audit, no state churn).
 * - When the claim is already submitted, returns the original state
 *   unchanged (idempotent — second call is a no-op preserving the
 *   original timestamp).
 *
 * Does not emit the claim_submitted audit event itself; that is the
 * caller's responsibility (kept here for pure-function-ness).
 */
export function submitClaim(state: V2SessionState): V2SessionState {
  if (isClaimSubmitted(state)) return state;
  const guard = canSubmit(state);
  if (!guard.ok) return state;
  return { ...state, claimSubmittedAt: new Date().toISOString() };
}

/** True when the session is in the submitted (closed) state. */
export function isClaimSubmitted(state: V2SessionState): boolean {
  return Boolean(state.claimSubmittedAt && state.claimSubmittedAt.length > 0);
}

export interface ReopenClaimResult {
  state: V2SessionState;
  /**
   * Timestamp the claim was at when the reopen was requested. Empty string
   * when reopen was called on an already-open claim (no-op path).
   */
  originalSubmittedAt: string;
}

/**
 * ADR-0006 §7 — true-reversal reopen. Clears `claimSubmittedAt` so the
 * post-submit lock disengages and the doctor can edit the claim again.
 * Returns the previous submission timestamp so the caller can record it
 * in the `claim_reopened` audit event payload.
 *
 * Idempotent: calling on an already-open claim is a no-op that returns
 * `originalSubmittedAt: ""`.
 */
export function reopenClaim(state: V2SessionState): ReopenClaimResult {
  if (!isClaimSubmitted(state)) {
    return { state, originalSubmittedAt: "" };
  }
  const originalSubmittedAt = state.claimSubmittedAt ?? "";
  const { claimSubmittedAt: _drop, ...rest } = state;
  return { state: rest as V2SessionState, originalSubmittedAt };
}
