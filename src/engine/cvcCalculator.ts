/**
 * Combined Values Chart (CVC) — GATIOD Standard Combination Formula
 *
 * Combines multiple independent incapacities into a single total using:
 *   a + b(1 - a/100)
 *
 * This prevents simple addition from exceeding 100% incorrectly.
 * All functions are pure and exported for unit testing.
 */

const round1 = (value: number): number => Math.round(value * 10) / 10;
const clamp100 = (value: number): number => Math.min(value, 100);

interface WholeFractionValue {
  whole: number;
  fraction: number;
}

function splitWholeFraction(value: number): WholeFractionValue {
  const whole = Math.floor(value);
  return { whole, fraction: round1(value - whole) };
}

function combineWholeChart(a: number, b: number): number {
  const sorted = a >= b ? [a, b] : [b, a];
  const result = sorted[0] + sorted[1] * (1 - sorted[0] / 100);
  return clamp100(Math.round(result));
}

/**
 * Combine two PI% values using the CVC formula.
 * Order doesn't matter mathematically, but convention is largest first.
 */
export function combineTwoValues(a: number, b: number): number {
  const sorted = a >= b ? [a, b] : [b, a];
  const result = sorted[0] + sorted[1] * (1 - sorted[0] / 100);
  return clamp100(round1(result));
}

/**
 * Combine two PI% values using Appendix CVC chart behavior:
 * whole-number chart cells are combined first, then fractional remainders are added back.
 */
export function combineTwoValuesChart(a: number, b: number): number {
  const sorted = a >= b ? [a, b] : [b, a];
  const higher = splitWholeFraction(sorted[0]);
  const lower = splitWholeFraction(sorted[1]);
  const combinedWhole = combineWholeChart(higher.whole, lower.whole);
  const withFractions = round1(combinedWhole + higher.fraction + lower.fraction);
  return clamp100(withFractions);
}

/**
 * Combine an array of PI% values using iterative CVC.
 * Values are sorted descending before combination (largest first).
 * Returns 0 for empty arrays, the single value for length 1.
 */
export function combineMultipleValues(values: number[]): number {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => b - a);
  if (nonZero.length === 0) return 0;
  if (nonZero.length === 1) return clamp100(round1(nonZero[0]));

  let combined = nonZero[0];
  for (let i = 1; i < nonZero.length; i++) {
    combined = combineTwoValues(combined, nonZero[i]);
  }
  return clamp100(round1(combined));
}

/**
 * Combine an array of PI% values using Appendix CVC chart behavior
 * (whole-number chart cells at each step).
 */
export function combineMultipleValuesChart(values: number[]): number {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => b - a);
  if (nonZero.length === 0) return 0;
  if (nonZero.length === 1) return clamp100(round1(nonZero[0]));

  const split = nonZero.map(splitWholeFraction);
  const fractionTotal = round1(split.reduce((total, part) => total + part.fraction, 0));

  let combinedWhole = split[0].whole;
  for (let i = 1; i < split.length; i++) {
    combinedWhole = combineWholeChart(combinedWhole, split[i].whole);
  }

  const withFractions = round1(combinedWhole + fractionTotal);
  return clamp100(withFractions);
}

/**
 * Combine values additively (simple sum), capped at a maximum.
 * Used for Hearing (Injury path) and Visual assessments.
 */
export function combineAdditive(values: number[], cap: number = 100): number {
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.min(Math.round(sum * 10) / 10, cap);
}

/**
 * Select the highest value (Highest Score Rule).
 * Used for CNS Cerebral and ankylosis within a joint.
 */
export function selectHighest(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}
