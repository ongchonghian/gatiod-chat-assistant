import type {
  GatiodSystemKey,
  PendingConfirmation,
  RouteDecision,
  SlotSignals,
  ToolPlanCall,
  V2SessionState,
  V2SystemState,
} from "./contracts.js";

const SYSTEM_KEYS: GatiodSystemKey[] = [
  "upper_limb",
  "lower_limb",
  "spine",
  "respiratory",
  "renal",
  "gastro_digestive",
  "hearing",
  "cns",
  "visual",
];

function nowIso(): string {
  return new Date().toISOString();
}

function emptySystemState(): V2SystemState {
  return {
    status: "idle",
    completeness: 0,
    pendingFields: [],
    slotSignals: {},
    extractedValues: {},
    piPercent: null,
    updatedAt: nowIso(),
  };
}

export function defaultV2SessionState(): V2SessionState {
  const systems = {} as Record<GatiodSystemKey, V2SystemState>;
  for (const key of SYSTEM_KEYS) systems[key] = emptySystemState();

  return {
    version: 1,
    systems,
    pendingClarification: null,
    pendingConfirmation: null,
  };
}

export function coerceV2State(raw: unknown): V2SessionState {
  if (!raw || typeof raw !== "object") return defaultV2SessionState();
  const asObj = raw as Record<string, unknown>;
  const candidate = asObj.v2 as V2SessionState | undefined;
  if (!candidate || candidate.version !== 1) return defaultV2SessionState();

  const merged = defaultV2SessionState();
  for (const key of SYSTEM_KEYS) {
    const current = candidate.systems?.[key];
    if (!current) continue;
    merged.systems[key] = {
      status: current.status,
      completeness: Number.isFinite(current.completeness) ? current.completeness : 0,
      pendingFields: Array.isArray(current.pendingFields) ? current.pendingFields : [],
      slotSignals: (current.slotSignals && typeof current.slotSignals === "object") ? current.slotSignals : {},
      extractedValues: (current.extractedValues && typeof current.extractedValues === "object") ? current.extractedValues as Record<string, string> : {},
      piPercent: typeof current.piPercent === "number" ? current.piPercent : null,
      updatedAt: current.updatedAt || nowIso(),
    };
  }

  merged.pendingClarification = candidate.pendingClarification ?? null;
  merged.pendingConfirmation = candidate.pendingConfirmation ?? null;
  return merged;
}

export function withRoute(state: V2SessionState, route: RouteDecision): V2SessionState {
  const next: V2SessionState = {
    ...state,
    systems: { ...state.systems },
    pendingClarification: route.operation === "clarify" ? state.pendingClarification : null,
  };

  for (const system of route.systems) {
    const prev = next.systems[system];
    next.systems[system] = {
      ...prev,
      status: prev.status === "calculated" ? "calculated" : "collecting",
      completeness: Math.max(prev.completeness, Math.min(0.75, route.confidence)),
      updatedAt: nowIso(),
    };
  }

  return next;
}

export function setPendingClarification(state: V2SessionState, question: string): V2SessionState {
  return {
    ...state,
    pendingClarification: question,
  };
}

export function setPendingConfirmation(state: V2SessionState, pending: PendingConfirmation | null): V2SessionState {
  return {
    ...state,
    pendingConfirmation: pending,
  };
}

export function applyToolResults(state: V2SessionState, executedCalls: ToolPlanCall[]): V2SessionState {
  const next: V2SessionState = {
    ...state,
    systems: { ...state.systems },
    pendingClarification: null,
  };

  for (const call of executedCalls) {
    if (call.status !== "executed" || !call.name.startsWith("assess_")) continue;

    if (call.name === "assess_global_cvc") continue;

    const key = call.name.replace("assess_", "") as GatiodSystemKey;
    if (!SYSTEM_KEYS.includes(key)) continue;

    const resultObj = (call.result ?? {}) as Record<string, unknown>;
    let piPercent: number | null = null;

    if (typeof resultObj.finalPercent === "number") piPercent = resultObj.finalPercent;
    else if (typeof resultObj.finalPi === "number") piPercent = resultObj.finalPi;
    else if (typeof resultObj.selectedPi === "number") piPercent = resultObj.selectedPi;

    const prev = next.systems[key];
    next.systems[key] = {
      ...prev,
      status: "calculated",
      completeness: 1,
      pendingFields: [],
      piPercent,
      updatedAt: nowIso(),
    };
  }

  return next;
}

export function updateSlotSignals(
  state: V2SessionState,
  system: GatiodSystemKey,
  signals: Partial<SlotSignals>
): V2SessionState {
  const prev = state.systems[system];
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        slotSignals: signals,
        updatedAt: nowIso(),
      },
    },
  };
}

export function updateExtractedValues(
  state: V2SessionState,
  system: GatiodSystemKey,
  values: Record<string, string>
): V2SessionState {
  const prev = state.systems[system];
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        // incoming values override existing — corrections deliberately replace
        extractedValues: { ...prev.extractedValues, ...values },
        updatedAt: nowIso(),
      },
    },
  };
}

export function toSystemStateEnvelope(state: V2SessionState, existingRaw: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(existingRaw ?? {}),
    v2: state,
  };
}

export function collectCalculatedSubtotals(state: V2SessionState): { system: string; piPercent: number }[] {
  const rows: { system: string; piPercent: number }[] = [];
  for (const key of SYSTEM_KEYS) {
    const system = state.systems[key];
    if (system.status === "calculated" && typeof system.piPercent === "number" && system.piPercent > 0) {
      rows.push({ system: key, piPercent: system.piPercent });
    }
  }
  return rows;
}
