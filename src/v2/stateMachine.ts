import { createHash } from "crypto";
import type {
  ClaimComponentOverride,
  ClaimOverrideStatus,
  GatiodSystemKey,
  GlobalCvcExclusion,
  PendingConfirmation,
  PendingConsensus,
  PendingExtractorComparison,
  PendingGlobalCvcConfirmation,
  PendingObservation,
  PendingSlotCorrection,
  RouteDecision,
  SlotSignals,
  StructuredExtractionResult,
  ToolPlanCall,
  V2AssessmentInstance,
  V2SessionState,
  V2SystemConfirmation,
  V2SystemFacts,
  V2SystemState,
} from "./contracts.js";
import { INSTANCE_RULES, parseInstanceId, v2AssessmentInstanceSchema } from "./assessmentInstanceRules.js";
import { combineAdditive, combineMultipleValuesChart, selectHighest } from "../engine/cvcCalculator.js";

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

function emptyConfirmation(): V2SystemConfirmation {
  return { status: "not_confirmed" };
}

function emptySystemState(): V2SystemState {
  return {
    status: "idle",
    completeness: 0,
    pendingFields: [],
    slotSignals: {},
    extractedValues: {},
    extractedFacts: {},
    pendingObservations: [],
    confirmation: emptyConfirmation(),
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
    instancesBySystem: {},
    pendingClarification: null,
    pendingConfirmation: null,
    pendingGlobalCvcConfirmation: null,
    pendingConsensus: null,
    claimComponentOverrides: {},
    globalCvcExclusions: {},
    pendingExtractorComparison: null,
    pendingSlotCorrection: null,
    bilateralQueue: null,
    detectionOrder: [],
  };
}

const VALID_OVERRIDE_STATUSES: readonly ClaimOverrideStatus[] = [
  "detected",
  "legacy_deferred",
  "unsupported",
  "skipped_by_user",
];

function coerceClaimComponentOverrides(
  raw: unknown,
): Partial<Record<GatiodSystemKey, ClaimComponentOverride>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<GatiodSystemKey, ClaimComponentOverride>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SYSTEM_KEYS.includes(key as GatiodSystemKey)) continue;
    if (!value || typeof value !== "object") continue;
    const obj = value as Record<string, unknown>;
    if (typeof obj.status !== "string") continue;
    if (!VALID_OVERRIDE_STATUSES.includes(obj.status as ClaimOverrideStatus)) continue;
    out[key as GatiodSystemKey] = {
      status: obj.status as ClaimOverrideStatus,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
      source:
        obj.source === "semantic_consensus" ||
        obj.source === "user_choice" ||
        obj.source === "safe_fail" ||
        obj.source === "legacy_policy"
          ? obj.source
          : undefined,
      sourceText: typeof obj.sourceText === "string" ? obj.sourceText : undefined,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : nowIso(),
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : nowIso(),
    };
  }
  return out;
}

function coerceGlobalCvcExclusions(
  raw: unknown,
): Partial<Record<GatiodSystemKey, GlobalCvcExclusion>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<GatiodSystemKey, GlobalCvcExclusion>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SYSTEM_KEYS.includes(key as GatiodSystemKey)) continue;
    if (!value || typeof value !== "object") continue;
    const obj = value as Record<string, unknown>;
    if (obj.source !== "user_choice") continue;
    out[key as GatiodSystemKey] = {
      excludedAt: typeof obj.excludedAt === "string" ? obj.excludedAt : nowIso(),
      excludedBy: typeof obj.excludedBy === "string" ? obj.excludedBy : undefined,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
      source: "user_choice",
    };
  }
  return out;
}

function coercePendingConsensus(raw: unknown): PendingConsensus | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.interpretationId !== "string" ||
    typeof obj.interpretationHash !== "string" ||
    typeof obj.sourceHash !== "string" ||
    typeof obj.sourceText !== "string" ||
    typeof obj.message !== "string" ||
    !Array.isArray(obj.candidateSystems) ||
    typeof obj.createdAt !== "string"
  ) {
    return null;
  }
  const candidateSystems = (obj.candidateSystems as unknown[]).filter(
    (s): s is GatiodSystemKey => typeof s === "string" && SYSTEM_KEYS.includes(s as GatiodSystemKey),
  );
  const awaiting = obj.awaiting === "edit_instruction" ? "edit_instruction" : "decision";
  const candidateFindings = Array.isArray(obj.candidateFindings)
    ? (obj.candidateFindings as PendingConsensus["candidateFindings"])
    : undefined;
  return {
    interpretationId: obj.interpretationId,
    interpretationHash: obj.interpretationHash,
    sourceHash: obj.sourceHash,
    sourceText: obj.sourceText,
    message: obj.message,
    candidateSystems,
    ...(candidateFindings ? { candidateFindings } : {}),
    createdAt: obj.createdAt,
    awaiting,
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

    // Migration-safe: treat missing V2-001 fields as empty defaults.
    const extractedFacts: V2SystemFacts =
      current.extractedFacts && typeof current.extractedFacts === "object"
        ? (current.extractedFacts as V2SystemFacts)
        : {};

    const pendingObservations: PendingObservation[] =
      Array.isArray(current.pendingObservations) ? (current.pendingObservations as PendingObservation[]) : [];

    const rawConfirmation = current.confirmation as V2SystemConfirmation | undefined;
    const confirmation: V2SystemConfirmation =
      rawConfirmation && typeof rawConfirmation === "object" && rawConfirmation.status
        ? rawConfirmation
        : { status: "not_confirmed" };

    merged.systems[key] = {
      status: current.status,
      completeness: Number.isFinite(current.completeness) ? current.completeness : 0,
      pendingFields: Array.isArray(current.pendingFields) ? current.pendingFields : [],
      slotSignals: (current.slotSignals && typeof current.slotSignals === "object") ? current.slotSignals : {},
      extractedValues: (current.extractedValues && typeof current.extractedValues === "object") ? current.extractedValues as Record<string, string> : {},
      extractedFacts,
      pendingObservations,
      confirmation,
      piPercent: typeof current.piPercent === "number" ? current.piPercent : null,
      updatedAt: current.updatedAt || nowIso(),
    };
  }

  merged.pendingClarification = candidate.pendingClarification ?? null;
  merged.pendingConfirmation = candidate.pendingConfirmation ?? null;
  merged.pendingGlobalCvcConfirmation = candidate.pendingGlobalCvcConfirmation ?? null;

  // Semantic consensus + claim orchestration (ADR-0003) — additive fields,
  // hydrated to safe defaults when absent in older persisted state.
  merged.pendingConsensus = coercePendingConsensus(
    (candidate as unknown as Record<string, unknown>).pendingConsensus,
  );
  merged.claimComponentOverrides = coerceClaimComponentOverrides(
    (candidate as unknown as Record<string, unknown>).claimComponentOverrides,
  );
  merged.globalCvcExclusions = coerceGlobalCvcExclusions(
    (candidate as unknown as Record<string, unknown>).globalCvcExclusions,
  );

  // ADR-0004 extractor comparison UI — hydrate from persisted state so chip
  // selections ("Use A (live)" / "Use B (LLM)") resolve correctly on the next
  // HTTP turn. Shape-check before casting; malformed entries fall back to null.
  const rawComparison = (candidate as unknown as Record<string, unknown>).pendingExtractorComparison;
  merged.pendingExtractorComparison =
    rawComparison &&
    typeof rawComparison === "object" &&
    typeof (rawComparison as Record<string, unknown>).id === "string" &&
    typeof (rawComparison as Record<string, unknown>).message === "string" &&
    Array.isArray((rawComparison as Record<string, unknown>).chips)
      ? (rawComparison as PendingExtractorComparison)
      : null;

  const rawSlotCorrection = (candidate as unknown as Record<string, unknown>).pendingSlotCorrection;
  merged.pendingSlotCorrection =
    rawSlotCorrection &&
    typeof rawSlotCorrection === "object" &&
    typeof (rawSlotCorrection as Record<string, unknown>).id === "string" &&
    typeof (rawSlotCorrection as Record<string, unknown>).message === "string"
      ? (rawSlotCorrection as PendingSlotCorrection)
      : null;

  // Coerce bilateralQueue
  const rawBilateral = (candidate as unknown as Record<string, unknown>).bilateralQueue;
  if (
    rawBilateral &&
    typeof rawBilateral === "object" &&
    typeof (rawBilateral as Record<string, unknown>).system === "string" &&
    typeof (rawBilateral as Record<string, unknown>).mode === "string" &&
    typeof (rawBilateral as Record<string, unknown>).pendingSide === "string"
  ) {
    const bq = rawBilateral as Record<string, unknown>;
    merged.bilateralQueue = {
      system: bq.system as GatiodSystemKey,
      mode: bq.mode as "same" | "separate",
      pendingSide: bq.pendingSide as "left" | "right",
      completedSide: (bq.completedSide as "left" | "right" | null) ?? null,
      completedPiPercent: typeof bq.completedPiPercent === "number" ? bq.completedPiPercent : null,
    };
  }

  // Coerce instancesBySystem
  const rawInstances = candidate.instancesBySystem as Record<string, unknown[]> | undefined;
  if (rawInstances && typeof rawInstances === "object") {
    for (const [key, rawArr] of Object.entries(rawInstances)) {
      if (!SYSTEM_KEYS.includes(key as GatiodSystemKey)) continue;
      if (!Array.isArray(rawArr)) continue;
      const validated: V2AssessmentInstance[] = [];
      for (const raw of rawArr) {
        const result = v2AssessmentInstanceSchema.safeParse(raw);
        if (result.success) validated.push(result.data as V2AssessmentInstance);
      }
      if (validated.length > 0) {
        merged.instancesBySystem[key as GatiodSystemKey] = validated;
      }
    }
  }

  return merged;
}

export function withRoute(state: V2SessionState, route: RouteDecision): V2SessionState {
  const next: V2SessionState = {
    ...state,
    systems: { ...state.systems },
    pendingClarification: route.operation === "clarify" ? state.pendingClarification : null,
  };

  let detectionOrder = next.detectionOrder;
  for (const system of route.systems) {
    const prev = next.systems[system];
    next.systems[system] = {
      ...prev,
      status: prev.status === "calculated" ? "calculated" : "collecting",
      completeness: Math.max(prev.completeness, Math.min(0.75, route.confidence)),
      updatedAt: nowIso(),
    };
    if (!detectionOrder.includes(system)) {
      detectionOrder = [...detectionOrder, system];
    }
  }
  next.detectionOrder = detectionOrder;

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
    // Confirmation supersedes clarification routing hint.
    activeClarificationSystem: undefined,
  };
}

export function setActiveClarificationSystem(
  state: V2SessionState,
  system: GatiodSystemKey | undefined,
): V2SessionState {
  return { ...state, activeClarificationSystem: system };
}

export function setPendingGlobalCvcConfirmation(
  state: V2SessionState,
  pending: PendingGlobalCvcConfirmation | null,
): V2SessionState {
  return {
    ...state,
    pendingGlobalCvcConfirmation: pending,
  };
}

export function setPendingConsensus(
  state: V2SessionState,
  pending: PendingConsensus | null,
): V2SessionState {
  return {
    ...state,
    pendingConsensus: pending,
  };
}

export function setClaimComponentOverride(
  state: V2SessionState,
  system: GatiodSystemKey,
  override: ClaimComponentOverride | null,
): V2SessionState {
  const next = { ...state.claimComponentOverrides };
  if (override === null) {
    delete next[system];
  } else {
    next[system] = override;
  }
  return { ...state, claimComponentOverrides: next };
}

export function setGlobalCvcExclusion(
  state: V2SessionState,
  system: GatiodSystemKey,
  exclusion: GlobalCvcExclusion | null,
): V2SessionState {
  const next = { ...state.globalCvcExclusions };
  if (exclusion === null) {
    delete next[system];
  } else {
    next[system] = exclusion;
  }
  return { ...state, globalCvcExclusions: next };
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

/**
 * Aggregate PI% values from all calculated instances for a system using the
 * system's combinationMethod defined in INSTANCE_RULES.
 *
 * Returns null when no calculated instances exist.
 * "none" systems (respiratory, renal, CNS) pass through the single instance value.
 */
export function computeSystemSubtotal(
  systemKey: GatiodSystemKey,
  instances: V2AssessmentInstance[]
): number | null {
  const rule = INSTANCE_RULES[systemKey];
  const values = instances
    .filter((i) => i.status === "calculated" && typeof i.piPercent === "number")
    .map((i) => i.piPercent as number);

  if (values.length === 0) return null;

  switch (rule.combinationMethod) {
    case "cvc":
      return combineMultipleValuesChart(values);
    case "additive":
      return combineAdditive(values);
    case "highest":
      return selectHighest(values);
    case "none":
      return values[0];
    default:
      return values[0];
  }
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

// ── V2-001 / V2-004 helpers ───────────────────────────────────────────────────

export function hashExtractedFacts(facts: V2SystemFacts): string {
  const sorted = Object.fromEntries(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

export function applyStructuredExtraction(
  state: V2SessionState,
  system: GatiodSystemKey,
  result: StructuredExtractionResult
): V2SessionState {
  const prev = state.systems[system];

  // Merge ROM joints fact instead of replacing — new direction measurements accumulate
  const mergedFactsPatch = { ...result.extractedFactsPatch };
  if (mergedFactsPatch["rom_joints"] && prev.extractedFacts["rom_joints"]) {
    const existing = prev.extractedFacts["rom_joints"].value as Record<string, unknown>;
    const incoming = mergedFactsPatch["rom_joints"].value as Record<string, unknown>;
    mergedFactsPatch["rom_joints"] = {
      ...mergedFactsPatch["rom_joints"],
      value: { ...existing, ...incoming },
    };
  }
  if (mergedFactsPatch["nerve_selections"] && prev.extractedFacts["nerve_selections"]) {
    // Incoming already deduplicated by extractor; use incoming as authoritative
  }

  const newFacts: V2SystemFacts = { ...prev.extractedFacts, ...mergedFactsPatch };

  // Add new pending observations (de-dup by ID is not needed; IDs are fresh UUIDs)
  const keepObs = prev.pendingObservations.filter(
    (o) => !result.pendingObservationsToResolve.includes(o.id)
  );
  const newPending: PendingObservation[] = [...keepObs, ...result.pendingObservationsToAdd];

  // Any fact change makes confirmation stale
  const hasFacts = Object.keys(mergedFactsPatch).length > 0;
  const newConfirmation: V2SystemConfirmation =
    hasFacts && prev.confirmation.status !== "not_confirmed"
      ? { ...prev.confirmation, status: "stale" }
      : prev.confirmation;

  const piPercent = hasFacts && newConfirmation.status === "stale" ? null : prev.piPercent;

  const mergedSignals = { ...prev.slotSignals, ...result.slotSignalsPatch };
  const mergedValues = { ...prev.extractedValues, ...result.displayValuesPatch };

  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        extractedFacts: newFacts,
        pendingObservations: newPending,
        confirmation: newConfirmation,
        slotSignals: mergedSignals,
        extractedValues: mergedValues,
        piPercent,
        updatedAt: nowIso(),
      },
    },
  };
}

export function invalidateConfirmation(state: V2SessionState, system: GatiodSystemKey): V2SessionState {
  const prev = state.systems[system];
  if (prev.confirmation.status === "not_confirmed") return state;
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        confirmation: { ...prev.confirmation, status: "stale" },
        piPercent: null,
        updatedAt: nowIso(),
      },
    },
  };
}

export function setConfirmationPending(
  state: V2SessionState,
  system: GatiodSystemKey,
  summary: string
): V2SessionState {
  const prev = state.systems[system];
  const factsHash = hashExtractedFacts(prev.extractedFacts);
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        confirmation: {
          status: "pending",
          confirmationSummary: summary,
          factsHash,
        },
        updatedAt: nowIso(),
      },
    },
  };
}

export function setConfirmationConfirmed(
  state: V2SessionState,
  system: GatiodSystemKey,
  confirmedBy?: string
): V2SessionState {
  const prev = state.systems[system];
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        confirmation: {
          ...prev.confirmation,
          status: "confirmed",
          confirmedAt: nowIso(),
          confirmedBy,
          factsHash: hashExtractedFacts(prev.extractedFacts),
        },
        updatedAt: nowIso(),
      },
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instance-aware state helpers (Step 2)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getInstances(
  state: V2SessionState,
  system: GatiodSystemKey
): V2AssessmentInstance[] {
  return state.instancesBySystem[system] ?? [];
}

export function getInstanceById(
  state: V2SessionState,
  instanceId: string
): V2AssessmentInstance | undefined {
  const { systemKey } = parseInstanceId(instanceId);
  return (state.instancesBySystem[systemKey] ?? []).find((i) => i.instanceId === instanceId);
}

export function upsertInstance(
  state: V2SessionState,
  instance: V2AssessmentInstance
): V2SessionState {
  const existing = state.instancesBySystem[instance.system] ?? [];
  const idx = existing.findIndex((i) => i.instanceId === instance.instanceId);
  const next =
    idx >= 0
      ? [...existing.slice(0, idx), instance, ...existing.slice(idx + 1)]
      : [...existing, instance];
  return {
    ...state,
    instancesBySystem: { ...state.instancesBySystem, [instance.system]: next },
  };
}

export function removeInstance(
  state: V2SessionState,
  instanceId: string
): V2SessionState {
  const { systemKey } = parseInstanceId(instanceId);
  const next = (state.instancesBySystem[systemKey] ?? []).filter(
    (i) => i.instanceId !== instanceId
  );
  return {
    ...state,
    instancesBySystem: { ...state.instancesBySystem, [systemKey]: next },
  };
}

/** Apply a structured extraction result to a specific instance's facts. */
export function applyInstanceFactsPatch(
  state: V2SessionState,
  instanceId: string,
  result: StructuredExtractionResult
): V2SessionState {
  const instance = getInstanceById(state, instanceId);
  if (!instance) return state;

  // Merge rom_joints: new direction measurements accumulate (same as system-level path)
  const mergedFactsPatch = { ...result.extractedFactsPatch };
  if (mergedFactsPatch["rom_joints"] && instance.facts["rom_joints"]) {
    const existing = instance.facts["rom_joints"].value as Record<string, unknown>;
    const incoming = mergedFactsPatch["rom_joints"].value as Record<string, unknown>;
    mergedFactsPatch["rom_joints"] = {
      ...mergedFactsPatch["rom_joints"],
      value: { ...existing, ...incoming },
    };
  }

  const newFacts: V2SystemFacts = { ...instance.facts, ...mergedFactsPatch };
  const keepObs = instance.pendingObservations.filter(
    (o) => !result.pendingObservationsToResolve.includes(o.id)
  );
  const newPending: PendingObservation[] = [...keepObs, ...result.pendingObservationsToAdd];

  const hasFacts = Object.keys(mergedFactsPatch).length > 0;
  const newConfirmation: V2SystemConfirmation =
    hasFacts && instance.confirmation.status !== "not_confirmed"
      ? { ...instance.confirmation, status: "stale" }
      : instance.confirmation;

  return upsertInstance(state, {
    ...instance,
    facts: newFacts,
    pendingObservations: newPending,
    confirmation: newConfirmation,
    status:
      instance.status === "calculated" && newConfirmation.status === "stale"
        ? "collecting"
        : instance.status,
    piPercent: hasFacts && newConfirmation.status === "stale" ? null : instance.piPercent,
    updatedAt: nowIso(),
  });
}

export function invalidateInstanceConfirmation(
  state: V2SessionState,
  instanceId: string
): V2SessionState {
  const instance = getInstanceById(state, instanceId);
  if (!instance || instance.confirmation.status === "not_confirmed") return state;
  return upsertInstance(state, {
    ...instance,
    confirmation: { ...instance.confirmation, status: "stale" },
    piPercent: null,
    updatedAt: nowIso(),
  });
}

export function setInstanceConfirmationPending(
  state: V2SessionState,
  instanceId: string,
  summary: string
): V2SessionState {
  const instance = getInstanceById(state, instanceId);
  if (!instance) return state;
  const factsHash = hashExtractedFacts(instance.facts);
  return upsertInstance(state, {
    ...instance,
    confirmation: { status: "pending", confirmationSummary: summary, factsHash },
    updatedAt: nowIso(),
  });
}

export function setInstanceConfirmationConfirmed(
  state: V2SessionState,
  instanceId: string,
  confirmedBy?: string
): V2SessionState {
  const instance = getInstanceById(state, instanceId);
  if (!instance) return state;
  return upsertInstance(state, {
    ...instance,
    status: "confirmed",
    confirmation: {
      ...instance.confirmation,
      status: "confirmed",
      confirmedAt: nowIso(),
      confirmedBy,
      factsHash: hashExtractedFacts(instance.facts),
    },
    updatedAt: nowIso(),
  });
}

export function graduateInstanceObservation(
  state: V2SessionState,
  instanceId: string,
  observationId: string,
  factsPatch: V2SystemFacts
): V2SessionState {
  const instance = getInstanceById(state, instanceId);
  if (!instance) return state;
  const newPending = instance.pendingObservations.filter((o) => o.id !== observationId);
  const newFacts = { ...instance.facts, ...factsPatch };
  const hasFacts = Object.keys(factsPatch).length > 0;
  const newConfirmation: V2SystemConfirmation =
    hasFacts && instance.confirmation.status !== "not_confirmed"
      ? { ...instance.confirmation, status: "stale" }
      : instance.confirmation;
  return upsertInstance(state, {
    ...instance,
    facts: newFacts,
    pendingObservations: newPending,
    confirmation: newConfirmation,
    piPercent: hasFacts && newConfirmation.status === "stale" ? null : instance.piPercent,
    updatedAt: nowIso(),
  });
}

/**
 * Record a tool result (PI%) against a specific instance, mark it calculated,
 * then recompute the system-level subtotal from all calculated instances and
 * write it back to systems[key].piPercent so collectCalculatedSubtotals
 * (and global CVC) see the correct aggregated value.
 */
export function applyInstanceToolResult(
  state: V2SessionState,
  instanceId: string,
  piPercent: number,
  trace?: import("./calculationTrace.js").CalculationTrace | null
): V2SessionState {
  const instance = getInstanceById(state, instanceId);
  if (!instance) return state;

  let next = upsertInstance(state, {
    ...instance,
    status: "calculated",
    piPercent,
    trace: trace ?? null,
    updatedAt: nowIso(),
  });

  const { systemKey } = parseInstanceId(instanceId);
  const subtotal = computeSystemSubtotal(systemKey, getInstances(next, systemKey));
  if (subtotal !== null) {
    const prev = next.systems[systemKey];
    next = {
      ...next,
      systems: {
        ...next.systems,
        [systemKey]: {
          ...prev,
          status: "calculated",
          piPercent: subtotal,
          updatedAt: nowIso(),
        },
      },
    };
  }

  return next;
}

// ── ADR-0004 extractor comparison state setters ───────────────────────────────

/** Store or clear a pending extractor comparison (ADR-0004 comparison UI). */
export function setPendingExtractorComparison(
  state: V2SessionState,
  comparison: PendingExtractorComparison | null,
): V2SessionState {
  return { ...state, pendingExtractorComparison: comparison };
}

/** Store or clear a pending slot correction (ADR-0004 "both wrong" path). */
export function setPendingSlotCorrection(
  state: V2SessionState,
  correction: PendingSlotCorrection | null,
): V2SessionState {
  return { ...state, pendingSlotCorrection: correction };
}

// ── Legacy system-level helpers below (unchanged) ─────────────────────────────

// ── Bilateral queue helpers ───────────────────────────────────────────────────

/** Set or replace the active bilateral assessment queue. */
export function setBilateralQueue(
  state: V2SessionState,
  queue: V2SessionState["bilateralQueue"],
): V2SessionState {
  return { ...state, bilateralQueue: queue };
}

/** Clear the bilateral queue (both sides done). */
export function clearBilateralQueue(state: V2SessionState): V2SessionState {
  return { ...state, bilateralQueue: null };
}

/**
 * Pivot a bilateral "separate" assessment from the completed side to the next.
 * Resets system extractedFacts to just {bilateral_mode, side: newSide} so the
 * doctor can describe the second leg/arm without stale facts from the first.
 */
export function pivotBilateralToNextSide(
  state: V2SessionState,
  system: GatiodSystemKey,
  newSide: "left" | "right",
  completedPiPercent: number,
): V2SessionState {
  const now = nowIso();
  const bq = state.bilateralQueue;
  if (!bq || bq.system !== system) return state;

  const currentFacts = state.systems[system].extractedFacts;
  const resetFacts: V2SystemFacts = {
    ...(currentFacts["bilateral_mode"] ? { bilateral_mode: currentFacts["bilateral_mode"] } : {}),
    side: {
      value: newSide,
      sourceText: `bilateral_pivot:${newSide}`,
      confidence: 1.0,
      extractionMethod: "user_selected",
      createdAt: now,
      updatedAt: now,
    },
  };

  return {
    ...state,
    bilateralQueue: {
      ...bq,
      pendingSide: newSide,
      completedSide: newSide === "right" ? "left" : "right",
      completedPiPercent,
    },
    systems: {
      ...state.systems,
      [system]: {
        ...state.systems[system],
        extractedFacts: resetFacts,
        pendingObservations: [],
        status: "collecting" as const,
        piPercent: null,
        confirmation: { status: "not_confirmed" },
        updatedAt: now,
      },
    },
  };
}

export function graduateObservation(
  state: V2SessionState,
  system: GatiodSystemKey,
  observationId: string,
  factsPatch: V2SystemFacts
): V2SessionState {
  const prev = state.systems[system];
  const newPending = prev.pendingObservations.filter((o) => o.id !== observationId);
  const newFacts = { ...prev.extractedFacts, ...factsPatch };
  const hasFacts = Object.keys(factsPatch).length > 0;
  const newConfirmation: V2SystemConfirmation =
    hasFacts && prev.confirmation.status !== "not_confirmed"
      ? { ...prev.confirmation, status: "stale" }
      : prev.confirmation;
  return {
    ...state,
    systems: {
      ...state.systems,
      [system]: {
        ...prev,
        extractedFacts: newFacts,
        pendingObservations: newPending,
        confirmation: newConfirmation,
        piPercent: hasFacts && newConfirmation.status === "stale" ? null : prev.piPercent,
        updatedAt: nowIso(),
      },
    },
  };
}
