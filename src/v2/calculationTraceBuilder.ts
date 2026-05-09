/**
 * Calculation Trace Builders — V2 chat-assistant
 *
 * Ported from angle-gauge-ui/src/components/shared/calculationTraceBuilder.ts.
 * Pure functions — no external system dependencies.
 */

import type { GatiodSystemKey } from "./contracts.js";
import type {
  CalculationMethod,
  CalculationTrace,
  CalculationTraceLevel,
  TraceBuildInput,
  TraceCap,
  TraceInputItem,
  TraceStep,
} from "./calculationTrace.js";

const TRACE_VERSION = 1 as const;

interface BuildTraceOptions {
  level: CalculationTraceLevel;
  systemKey?: GatiodSystemKey;
  instanceId?: string;
  inputs: TraceBuildInput[];
  caps?: TraceCap[];
  ruleNotes?: string[];
  showZeroAsExcluded?: boolean;
  cvcChartRounding?: boolean;
}

export interface SystemSubtotalTraceOptions {
  systemKey: GatiodSystemKey;
  method: CalculationMethod;
  inputs: Array<{ key: string; label: string; value: number; reason?: string }>;
  ruleNotes?: string[];
  cvcChartRounding?: boolean;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

const combineTwo = (a: number, b: number, cvcChartRounding: boolean = false): number => {
  const higher = Math.max(a, b);
  const lower = Math.min(a, b);
  const raw = higher + lower * (1 - higher / 100);
  return cvcChartRounding ? Math.round(raw) : round1(raw);
};

const splitWholeFraction = (value: number): { whole: number; fraction: number } => {
  const whole = Math.floor(value);
  return { whole, fraction: round1(value - whole) };
};

const makeInput = (input: TraceBuildInput, included: boolean, fallbackReason?: string): TraceInputItem => ({
  key: input.key,
  label: input.label,
  value: round1(input.value),
  included,
  reason: included ? undefined : input.reason ?? fallbackReason,
  source: input.source,
});

function splitInputs(
  inputs: TraceBuildInput[],
  showZeroAsExcluded: boolean
): { included: TraceInputItem[]; excluded: TraceInputItem[] } {
  const included: TraceInputItem[] = [];
  const excluded: TraceInputItem[] = [];

  for (const input of inputs) {
    if (input.reason) {
      excluded.push(makeInput(input, false));
      continue;
    }
    if (input.value > 0) {
      included.push(makeInput(input, true));
      continue;
    }
    if (showZeroAsExcluded) {
      excluded.push(makeInput(input, false, "0% input (not included in combination)"));
    }
  }

  return { included, excluded };
}

function applyCaps(
  baseValue: number,
  caps: TraceCap[] | undefined
): { final: number; normalizedCaps: TraceCap[] } {
  const normalizedCaps: TraceCap[] = [];
  let running = round1(baseValue);

  for (const cap of caps ?? []) {
    if (running <= cap.cap && cap.after >= running) continue;

    const before = cap.before > 0 ? cap.before : running;
    const after = cap.after > 0 ? cap.after : Math.min(before, cap.cap);

    if (after >= before) continue;

    normalizedCaps.push({
      scope: cap.scope,
      before: round1(before),
      after: round1(after),
      cap: round1(cap.cap),
      reason: cap.reason,
    });

    running = round1(after);
  }

  if (running > 100) {
    normalizedCaps.push({ scope: "Global", before: running, after: 100, cap: 100, reason: "Hard cap at 100%" });
    running = 100;
  }

  return { final: running, normalizedCaps };
}

function finalizeTrace(
  method: CalculationMethod,
  opts: BuildTraceOptions,
  steps: TraceStep[],
  finalBeforeCap: number
): CalculationTrace {
  const { included, excluded } = splitInputs(opts.inputs, Boolean(opts.showZeroAsExcluded));
  const { final, normalizedCaps } = applyCaps(finalBeforeCap, opts.caps);

  return {
    traceVersion: TRACE_VERSION,
    level: opts.level,
    systemKey: opts.systemKey,
    instanceId: opts.instanceId,
    method,
    inputsIncluded: included,
    inputsExcluded: excluded,
    steps,
    caps: normalizedCaps,
    finalBeforeCap: round1(finalBeforeCap),
    final,
    ruleNotes: opts.ruleNotes ?? [],
  };
}

export function buildCvcTrace(opts: BuildTraceOptions): CalculationTrace {
  const { included } = splitInputs(opts.inputs, Boolean(opts.showZeroAsExcluded));
  const steps: TraceStep[] = [];
  const useChartRounding = Boolean(opts.cvcChartRounding);

  const hasDecimals = included.some((input) => !Number.isInteger(input.value));
  if (hasDecimals) {
    steps.push({
      id: "fraction-note",
      title: "Fraction / decimal handling",
      description: useChartRounding
        ? "Whole-number components are combined first with Appendix CVC chart cells; fractional remainders are then added back."
        : "Decimal percentages are retained for output consistency.",
    });
  }

  if (included.length === 0) {
    steps.push({ id: "no-inputs", title: "No positive inputs", description: "No included percentages were available to combine.", value: 0 });
    return finalizeTrace("cvc", opts, steps, 0);
  }

  const sorted = [...included].sort((a, b) => b.value - a.value);

  if (sorted.length === 1) {
    const singleValue = useChartRounding ? round1(sorted[0].value) : sorted[0].value;
    steps.push({
      id: "single-input",
      title: "Single included value",
      description: "Only one included percentage exists; CVC pairwise combination is not required.",
      value: singleValue,
      items: [{ label: sorted[0].label, value: singleValue }],
    });
    return finalizeTrace("cvc", opts, steps, singleValue);
  }

  steps.push({
    id: "order",
    title: "CVC ordering",
    description: useChartRounding
      ? "Combine highest values first using Appendix CVC chart whole-number cells at each step."
      : "Combine the two highest values first, then iteratively combine with the next highest value.",
    items: sorted.map((item, index) => ({ label: `${index + 1}. ${item.label}`, value: item.value })),
  });

  if (useChartRounding) {
    let runningWhole = Math.floor(sorted[0].value);
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const nextWhole = Math.floor(next.value);
      const higher = Math.max(runningWhole, nextWhole);
      const lower = Math.min(runningWhole, nextWhole);
      const combinedWhole = combineTwo(runningWhole, nextWhole, true);
      steps.push({
        id: `pair-${i}`,
        title: `Pairwise CVC step ${i}`,
        description: "Whole-number components are combined by Appendix CVC chart row/column convention.",
        equation: `${higher} + ${lower} × (1 - ${higher}/100) ≈ ${combinedWhole} (chart cell)`,
        value: combinedWhole,
        items: [
          { label: "Running whole-number total", value: runningWhole },
          { label: `${next.label} (whole component)`, value: nextWhole },
        ],
      });
      runningWhole = combinedWhole;
    }
    const fractionTotal = round1(sorted.reduce((t, item) => t + splitWholeFraction(item.value).fraction, 0));
    const withFractions = round1(runningWhole + fractionTotal);
    if (fractionTotal > 0) {
      steps.push({
        id: "fraction-addback",
        title: "Fractional add-back",
        description: "After whole-number chart combination, fractional remainders are added back.",
        equation: `${runningWhole} + ${fractionTotal} = ${withFractions}`,
        value: withFractions,
      });
    }
    return finalizeTrace("cvc", opts, steps, withFractions);
  }

  let running = sorted[0].value;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const higher = Math.max(running, next.value);
    const lower = Math.min(running, next.value);
    const combined = combineTwo(running, next.value, false);
    steps.push({
      id: `pair-${i}`,
      title: `Pairwise CVC step ${i}`,
      description: "Larger value is used on the side row convention; smaller value on the bottom column convention.",
      equation: `${round1(higher)} + ${round1(lower)} × (1 - ${round1(higher)}/100) = ${combined}`,
      value: combined,
      items: [
        { label: "Running total", value: round1(running) },
        { label: next.label, value: next.value },
      ],
    });
    running = combined;
  }
  return finalizeTrace("cvc", opts, steps, running);
}

export function buildAdditiveTrace(opts: BuildTraceOptions): CalculationTrace {
  const { included } = splitInputs(opts.inputs, Boolean(opts.showZeroAsExcluded));
  const steps: TraceStep[] = [];

  if (included.length === 0) {
    steps.push({ id: "no-inputs", title: "No positive inputs", description: "No included percentages were available to add.", value: 0 });
    return finalizeTrace("additive", opts, steps, 0);
  }

  const sum = round1(included.reduce((acc, cur) => acc + cur.value, 0));
  steps.push({
    id: "sum",
    title: "Additive combination",
    description: "Inputs are summed directly (no CVC transformation).",
    equation: `${included.map((item) => item.value).join(" + ")} = ${sum}`,
    value: sum,
    items: included.map((item) => ({ label: item.label, value: item.value })),
  });
  return finalizeTrace("additive", opts, steps, sum);
}

export function buildHighestTrace(opts: BuildTraceOptions): CalculationTrace {
  const { included } = splitInputs(opts.inputs, Boolean(opts.showZeroAsExcluded));
  const steps: TraceStep[] = [];

  const candidates = included.length > 0 ? included : opts.inputs.map((input) => makeInput(input, true));

  if (candidates.length === 0) {
    steps.push({ id: "no-candidates", title: "No candidate values", description: "No values were available for highest-score selection.", value: 0 });
    return finalizeTrace("highest", opts, steps, 0);
  }

  const winner = candidates.reduce((best, cur) => (cur.value > best.value ? cur : best), candidates[0]);
  steps.push({
    id: "highest",
    title: "Highest-score selection",
    description: "Only the highest candidate is retained; other values are not added.",
    value: winner.value,
    items: candidates.map((candidate) => ({
      label: candidate.label,
      value: candidate.value,
      note: candidate.key === winner.key ? "Selected" : "Ignored",
    })),
  });
  return finalizeTrace("highest", opts, steps, winner.value);
}

export function buildNoneTrace(opts: BuildTraceOptions): CalculationTrace {
  const { included } = splitInputs(opts.inputs, Boolean(opts.showZeroAsExcluded));
  const steps: TraceStep[] = [];

  const selected = included[0] ?? (opts.inputs[0] ? makeInput(opts.inputs[0], true) : null);

  if (!selected) {
    steps.push({ id: "none-empty", title: "No selected value", description: "No value has been selected in this pathway yet.", value: 0 });
    return finalizeTrace("none", opts, steps, 0);
  }

  steps.push({
    id: "none-single",
    title: "Single selected value",
    description: "This pathway uses one selected PI% value directly.",
    value: selected.value,
    items: [{ label: selected.label, value: selected.value }],
  });
  return finalizeTrace("none", opts, steps, selected.value);
}

export function buildSystemSubtotalTrace(opts: SystemSubtotalTraceOptions): CalculationTrace {
  const buildOptions: BuildTraceOptions = {
    level: "system",
    systemKey: opts.systemKey,
    inputs: opts.inputs,
    ruleNotes: opts.ruleNotes,
    showZeroAsExcluded: false,
    cvcChartRounding: opts.cvcChartRounding ?? opts.method === "cvc",
  };

  switch (opts.method) {
    case "cvc":      return buildCvcTrace(buildOptions);
    case "additive": return buildAdditiveTrace(buildOptions);
    case "highest":  return buildHighestTrace(buildOptions);
    case "none":     return buildNoneTrace(buildOptions);
    default:         return buildNoneTrace(buildOptions);
  }
}
