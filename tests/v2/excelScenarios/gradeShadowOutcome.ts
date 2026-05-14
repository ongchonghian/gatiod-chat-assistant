// Grade what actually happened when a scenario was run through processChatV2,
// then compare to the expected outcome class. Used by per-system *.shadow.test.ts.
//
// Mapping rules:
//   - assess_<system> executed successfully → "exact_calculation"
//     (further refined to "exact_calculation_match" when the PI also matches)
//   - response asks for clarification + routed to expected system → "clarification_required"
//   - response message indicates safe-fail (multi-region guard, etc.) → "unsupported_safe_fail"
//   - routed correctly but no other action → "routing_only"
//   - system is legacy (CNS/visual) and routed there → "legacy_deferred"
//   - none of the above → "wrong_route" (counts as a failure for any class)

import type { ChatV2Response, GatiodSystemKey } from "../../../src/v2/contracts.js";
import type { ExpectedOutcomeClass, ExcelScenarioComponent } from "./scenarioTypes.js";

export type ObservedOutcome =
  | "exact_calculation"
  | "clarification_required"
  | "unsupported_safe_fail"
  | "routing_only"
  | "legacy_deferred"
  | "wrong_route";

export interface OutcomeGrade {
  observed: ObservedOutcome;
  /** True iff observed matches the expected outcome class for the row. */
  matches: boolean;
  /** For exact_calculation rows only: did the produced PI also match? */
  piMatches?: boolean;
  /** Brief notes for debugging mismatches in the calibration report. */
  notes: string;
}

const SAFE_FAIL_RE = /not yet supported|please assess one (spine )?region|complete or clear the current/i;

export function gradeOutcome(
  response: ChatV2Response,
  component: ExcelScenarioComponent,
): OutcomeGrade {
  const expected = component.outcomeClass;
  const expectedSystem = component.system;

  // Tool execution success — strongest signal.
  const assessCall = response.toolPlan.actual.find(
    (c) =>
      c.name === `assess_${expectedSystem}` &&
      c.status === "executed" &&
      c.validation.ok,
  );

  if (assessCall) {
    const result = (assessCall.result ?? {}) as Record<string, unknown>;
    const observedPi =
      typeof result.finalPercent === "number" ? result.finalPercent
      : typeof result.finalPi === "number" ? result.finalPi
      : typeof result.selectedPi === "number" ? result.selectedPi
      : null;
    // Slice-16 — accept either an exact PI or a workbook range. Gastro and
    // renal rows expose ranges (e.g. "0-10%", "11-30%") because the doctor
    // selects a value within the bracket; an observed PI within the range
    // is a calculation match.
    let piMatches = false;
    if (observedPi !== null) {
      if (typeof component.expectedPiPercent === "number") {
        piMatches = Math.abs(observedPi - component.expectedPiPercent) < 0.5;
      } else if (component.expectedPiRange) {
        const [lo, hi] = component.expectedPiRange;
        piMatches = observedPi >= lo - 0.5 && observedPi <= hi + 0.5;
      }
    }
    const expectedDisplay =
      typeof component.expectedPiPercent === "number"
        ? String(component.expectedPiPercent)
        : component.expectedPiRange
        ? `${component.expectedPiRange[0]}-${component.expectedPiRange[1]}`
        : "?";
    return {
      observed: "exact_calculation",
      matches: expected === "exact_calculation",
      piMatches,
      notes: `assess_${expectedSystem} executed; observed=${observedPi ?? "?"}, expected=${expectedDisplay}`,
    };
  }

  // Safe-fail signal in the message.
  if (SAFE_FAIL_RE.test(response.message)) {
    return {
      observed: "unsupported_safe_fail",
      matches: expected === "unsupported_safe_fail",
      notes: "message contained safe-fail phrasing",
    };
  }

  const routedToExpected = response.route.systems.includes(expectedSystem);

  // Clarification asked + routed correctly.
  // `clarification_required` is treated as "at least" routing_only — the system
  // correctly identified the area AND asked for more input, which exceeds the
  // routing_only expectation. This covers the semantic-consensus card path where
  // the orchestrator proposes a system and asks the doctor to confirm/proceed.
  if (response.needsClarification && routedToExpected) {
    const matches =
      expected === "clarification_required" || expected === "routing_only";
    return {
      observed: "clarification_required",
      matches,
      notes: response.clarificationQuestion ? `asked: "${response.clarificationQuestion.slice(0, 80)}…"` : "needsClarification=true",
    };
  }

  // Routed correctly but nothing else.
  if (routedToExpected) {
    return {
      observed: "routing_only",
      matches: expected === "routing_only",
      notes: "routed to expected system; no extraction or clarification",
    };
  }

  return {
    observed: "wrong_route",
    matches: false,
    notes: `expected ${expectedSystem}; routed to [${response.route.systems.join(", ") || "none"}]`,
  };
}

export interface SystemCalibrationReport {
  system: GatiodSystemKey;
  sampleSize: number;
  byExpected: Record<ExpectedOutcomeClass, { total: number; matched: number; observedDist: Record<ObservedOutcome, number> }>;
  /** Component-level safe-outcome rate (matches / sampleSize). */
  componentSafeOutcomeRate: number;
  /** PI-match rate among exact_calculation components (matches / total). */
  exactCalculationRate: number;
  /** Per-row mismatches, capped — fuel for outcomeClassOverrides.json. */
  mismatchSamples: Array<{
    rowId: string;
    inputText: string;
    expected: ExpectedOutcomeClass;
    observed: ObservedOutcome;
    notes: string;
  }>;
}

const ALL_OUTCOME_CLASSES: ExpectedOutcomeClass[] = [
  "exact_calculation",
  "clarification_required",
  "unsupported_safe_fail",
  "routing_only",
  "legacy_deferred",
];
const ALL_OBSERVED: ObservedOutcome[] = [
  "exact_calculation",
  "clarification_required",
  "unsupported_safe_fail",
  "routing_only",
  "legacy_deferred",
  "wrong_route",
];

export function emptyCalibrationReport(system: GatiodSystemKey): SystemCalibrationReport {
  const byExpected = {} as SystemCalibrationReport["byExpected"];
  for (const cls of ALL_OUTCOME_CLASSES) {
    const observedDist = {} as Record<ObservedOutcome, number>;
    for (const o of ALL_OBSERVED) observedDist[o] = 0;
    byExpected[cls] = { total: 0, matched: 0, observedDist };
  }
  return {
    system,
    sampleSize: 0,
    byExpected,
    componentSafeOutcomeRate: 0,
    exactCalculationRate: 0,
    mismatchSamples: [],
  };
}
