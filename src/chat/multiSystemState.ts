/**
 * Multi-System Orchestrator
 *
 * Tracks assessment state across all 9 GATIOD systems within a session.
 * Computes global CVC when multiple systems have results.
 */

import { combineMultipleValuesChart } from "../engine/index.js";

export type SystemKey =
  | "upper_limb"
  | "lower_limb"
  | "spine"
  | "respiratory"
  | "renal"
  | "gastro_digestive"
  | "hearing"
  | "cns"
  | "visual";

export type SystemStatus = "idle" | "collecting" | "confirmed" | "calculated";

export type SubtotalMethod = "cvc" | "additive" | "none" | "highest";

export interface SystemState {
  key: SystemKey;
  label: string;
  chapter: number;
  status: SystemStatus;
  subtotalMethod: SubtotalMethod;
  piPercent: number | null;
  result: unknown | null;
}

export interface MultiSystemSession {
  systems: Record<SystemKey, SystemState>;
  globalPiPercent: number | null;
}

const SYSTEM_DEFINITIONS: { key: SystemKey; label: string; chapter: number; subtotalMethod: SubtotalMethod }[] = [
  { key: "upper_limb", label: "Upper Limb", chapter: 3, subtotalMethod: "cvc" },
  { key: "lower_limb", label: "Lower Limb", chapter: 4, subtotalMethod: "cvc" },
  { key: "spine", label: "Spine", chapter: 5, subtotalMethod: "cvc" },
  { key: "respiratory", label: "Respiratory", chapter: 6, subtotalMethod: "none" },
  { key: "renal", label: "Renal", chapter: 7, subtotalMethod: "none" },
  { key: "gastro_digestive", label: "Gastro/Digestive", chapter: 8, subtotalMethod: "cvc" },
  { key: "hearing", label: "Hearing", chapter: 9, subtotalMethod: "additive" },
  { key: "cns", label: "CNS", chapter: 10, subtotalMethod: "none" },
  { key: "visual", label: "Visual", chapter: 11, subtotalMethod: "additive" },
];

export function createMultiSystemSession(): MultiSystemSession {
  const systems = {} as Record<SystemKey, SystemState>;
  for (const def of SYSTEM_DEFINITIONS) {
    systems[def.key] = {
      key: def.key,
      label: def.label,
      chapter: def.chapter,
      status: "idle",
      subtotalMethod: def.subtotalMethod,
      piPercent: null,
      result: null,
    };
  }
  return { systems, globalPiPercent: null };
}

export function setSystemResult(
  session: MultiSystemSession,
  systemKey: SystemKey,
  piPercent: number,
  result: unknown
): MultiSystemSession {
  const updated = { ...session, systems: { ...session.systems } };
  updated.systems[systemKey] = {
    ...updated.systems[systemKey],
    status: "calculated",
    piPercent,
    result,
  };
  updated.globalPiPercent = computeGlobalCvc(updated);
  return updated;
}

export function computeGlobalCvc(session: MultiSystemSession): number {
  const subtotals = Object.values(session.systems)
    .filter((s) => s.status === "calculated" && s.piPercent !== null && s.piPercent > 0)
    .map((s) => s.piPercent!);

  if (subtotals.length === 0) return 0;
  if (subtotals.length === 1) return subtotals[0];

  return Math.min(combineMultipleValuesChart(subtotals), 100);
}

export function getSessionSummary(session: MultiSystemSession): {
  activeSystems: { key: SystemKey; label: string; piPercent: number | null; status: SystemStatus }[];
  globalPiPercent: number | null;
  cvcInputs: number[];
} {
  const activeSystems = Object.values(session.systems)
    .filter((s) => s.status !== "idle")
    .map((s) => ({ key: s.key, label: s.label, piPercent: s.piPercent, status: s.status }));

  const cvcInputs = Object.values(session.systems)
    .filter((s) => s.piPercent !== null && s.piPercent > 0)
    .map((s) => s.piPercent!);

  return { activeSystems, globalPiPercent: session.globalPiPercent, cvcInputs };
}
