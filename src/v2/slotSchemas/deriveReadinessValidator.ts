/**
 * deriveReadinessValidator — ADR-0004.
 *
 * Evaluates a SlotDefinition[] against extractedFacts and returns a
 * ReadinessResult. Reads only extractedFacts — never PresenceSignals.
 *
 * Cross-slot constraints ("at least one of [A, B, C] must be present")
 * cannot be expressed as per-slot required_when conditions. Wrap this
 * function in a thin per-system validator to add those checks.
 */

import type { ReadinessResult, V2SystemFacts } from "../contracts.js";
import type { SlotCondition, SlotDefinition } from "./types.js";

// ── Presence helpers ──────────────────────────────────────────────────────────

/**
 * A fact is "present and non-empty" when:
 *   - The factKey exists in extractedFacts, AND
 *   - Its value is not null / undefined / "" / [] / {}
 *
 * Empty arrays and empty objects count as absent — the extractor initialises
 * them as zero-state holders before any content is added.
 */
function isFactPresent(facts: V2SystemFacts, factKey: string): boolean {
  const fact = facts[factKey];
  if (!fact) return false;
  const v = fact.value;
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true; // boolean, number — presence = defined
}

function getFactValue(facts: V2SystemFacts, factKey: string): unknown {
  return facts[factKey]?.value;
}

// ── Condition evaluator ───────────────────────────────────────────────────────

function evaluateCondition<TKey extends string>(
  condition: SlotCondition<TKey>,
  facts: V2SystemFacts
): boolean {
  if (condition === "always") return true;
  if (condition === "never") return false;

  if ("and" in condition) {
    return condition.and.every((c) => evaluateCondition(c, facts));
  }

  if ("present" in condition) {
    return isFactPresent(facts, condition.fact);
  }

  if ("eq" in condition) {
    return getFactValue(facts, condition.fact) === condition.eq;
  }

  if ("in" in condition) {
    const v = getFactValue(facts, condition.fact);
    return condition.in.includes(v);
  }

  return false;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Evaluates each slot's required_when against extractedFacts.
 * Returns the first unmet required slot as a ReadinessResult with ready: false,
 * or { ready: true } when all required slots are satisfied.
 *
 * Ordering matters: slots are evaluated in the order they appear in `defs`.
 * Put higher-priority slots (e.g. "side") first.
 */
export function deriveReadinessValidator<TKey extends string>(
  defs: SlotDefinition<TKey>[],
  facts: V2SystemFacts
): ReadinessResult {
  for (const def of defs) {
    const required = evaluateCondition(def.required_when, facts);
    if (!required) continue;

    const present = isFactPresent(facts, def.factKey);
    if (present) continue;

    // Required but missing — build ReadinessResult from the slot definition.
    const result: ReadinessResult = {
      ready: false,
      reason: `missing_${def.factKey}`,
      missingFields: [def.factKey],
    };

    if (def.clarification) {
      result.clarificationQuestion = def.clarification.question;
      result.candidateAnswers =
        def.clarification.candidateAnswers.length > 0
          ? def.clarification.candidateAnswers
          : undefined;
      result.expectedAnswer = def.clarification.expectedAnswer;
    }

    return result;
  }

  return { ready: true };
}
