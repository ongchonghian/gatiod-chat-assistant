/**
 * Calculation Trace — V2 chat-assistant
 *
 * Ported from angle-gauge-ui/src/components/shared/calculationTrace.ts.
 * GatiodSystemKey replaces SystemKey throughout.
 */

import type { GatiodSystemKey } from "./contracts.js";

export type CalculationMethod = "cvc" | "additive" | "highest" | "none";
export type CalculationTraceLevel = "instance" | "spoke" | "system" | "global";

export interface TraceInputSource {
  systemKey?: GatiodSystemKey;
  instanceId?: string;
  category?: string;
  key?: string;
}

export interface TraceInputItem {
  key: string;
  label: string;
  value: number;
  included: boolean;
  reason?: string;
  source?: TraceInputSource;
}

export interface TraceCap {
  scope: string;
  before: number;
  after: number;
  cap: number;
  reason: string;
}

export interface TraceStepItem {
  label: string;
  value?: number;
  note?: string;
}

export interface TraceStep {
  id: string;
  title: string;
  description?: string;
  equation?: string;
  value?: number;
  items?: TraceStepItem[];
}

export interface CalculationTrace {
  traceVersion: 1;
  level: CalculationTraceLevel;
  systemKey?: GatiodSystemKey;
  instanceId?: string;
  method: CalculationMethod;
  inputsIncluded: TraceInputItem[];
  inputsExcluded: TraceInputItem[];
  steps: TraceStep[];
  caps: TraceCap[];
  finalBeforeCap: number;
  final: number;
  ruleNotes: string[];
}

export interface TraceBuildInput {
  key: string;
  label: string;
  value: number;
  reason?: string;
  source?: TraceInputSource;
}
