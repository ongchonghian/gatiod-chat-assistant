/**
 * Tool Handlers — bridge between Gemini function calls and the calculation engine.
 * Supports all 9 GATIOD systems + global CVC + lookup tools.
 */

import {
  // Upper Limb
  calculateUpperLimb, lookupRom, getRomLookupTable,
  ROM_JOINTS, ARM_AMPUTATION_LEVELS, FINGER_AMPUTATION_LEVELS,
  UPPER_LIMB_NERVES, DBE_CONDITIONS, UPPER_ANATOMICAL_LABELS,
  getAmputationSuppressedJoints,
  type UpperLimbValue, type FingerKey,
  // Lower Limb
  calculateLowerLimb, type LowerLimbValue,
  // Spine
  calculateSpineAssessment, type SpinalRegion, type SpineCategoryEntry,
  // Respiratory
  calculateRespiratoryAssessment, type RespiratoryValue,
  // Renal
  calculateRenalAssessment, type RenalValue,
  // Gastro
  calculateGastroDigestiveAssessment, type GastroDigestiveValue,
  // Hearing
  calculateHearing, type HearingValue,
  // CNS
  calculateCns, type CnsValue,
  // Visual
  calculateVisual, type VisualValue,
  // CVC
  combineMultipleValuesChart,
} from "../engine/index.js";
import { searchDictionary } from "../rag/dictionaryIndex.js";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function handleToolCall(name: string, args: Record<string, unknown>): ToolResult {
  try {
    switch (name) {
      // ─── Assessment tools (one per system) ─────────────────────────
      case "assess_upper_limb":
        return wrapCalc(() => calculateUpperLimb(args as unknown as UpperLimbValue), "upper_limb");
      case "assess_lower_limb":
        return wrapCalc(() => calculateLowerLimb(args as unknown as LowerLimbValue), "lower_limb");
      case "assess_spine":
        return handleAssessSpine(args);
      case "assess_respiratory":
        return wrapCalc(() => calculateRespiratoryAssessment(args as unknown as RespiratoryValue), "respiratory");
      case "assess_renal":
        return wrapCalc(() => calculateRenalAssessment(args as unknown as RenalValue), "renal");
      case "assess_gastro":
        return wrapCalc(() => calculateGastroDigestiveAssessment(args as unknown as GastroDigestiveValue), "gastro_digestive");
      case "assess_hearing":
        return wrapCalc(() => calculateHearing(args as unknown as HearingValue), "hearing");
      case "assess_cns":
        return wrapCalc(() => calculateCns(args as unknown as CnsValue), "cns");
      case "assess_visual":
        return wrapCalc(() => calculateVisual(args as unknown as VisualValue), "visual");

      // ─── Global CVC ────────────────────────────────────────────────
      case "assess_global_cvc":
        return handleGlobalCvc(args);

      // ─── Lookup tools ──────────────────────────────────────────────
      case "lookup_rom_table":
        return handleLookupRom(args);
      case "lookup_amputation_level":
        return handleLookupAmputation(args);
      case "lookup_nerve":
        return handleLookupNerve(args);
      case "lookup_dbe_condition":
        return handleLookupDbe(args);
      case "search_dictionary":
        return handleSearchDictionary(args);

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Generic calc wrapper ────────────────────────────────────────────────────

function wrapCalc(fn: () => unknown, systemKey: string): ToolResult {
  const result = fn() as Record<string, unknown>;
  const pi = extractFinalPercent(result);
  return {
    success: true,
    data: { ...result, systemKey, finalPercent: pi },
  };
}

function extractFinalPercent(result: Record<string, unknown>): number {
  if ("finalPercent" in result) return result.finalPercent as number;
  if ("finalPi" in result) return result.finalPi as number;
  if ("selectedPi" in result) return result.selectedPi as number;
  if ("piPercent" in result) return (result.piPercent as number) ?? 0;
  return 0;
}

// ─── Spine (needs region + entries) ──────────────────────────────────────────

function handleAssessSpine(args: Record<string, unknown>): ToolResult {
  const region = args.region as SpinalRegion;
  const entries = args.categoryEntries as SpineCategoryEntry[];
  const result = calculateSpineAssessment(region, entries);
  return { success: true, data: { ...result, systemKey: "spine" } };
}

// ─── Global CVC ──────────────────────────────────────────────────────────────

function handleGlobalCvc(args: Record<string, unknown>): ToolResult {
  const subtotals = args.systemSubtotals as { system: string; piPercent: number }[];
  if (!subtotals || !Array.isArray(subtotals)) {
    return { success: false, error: "systemSubtotals array is required" };
  }

  const positive = subtotals.filter((s) => s.piPercent > 0);
  if (positive.length === 0) return { success: true, data: { globalPiPercent: 0, cvcInputs: [], details: [] } };

  const sorted = positive.sort((a, b) => b.piPercent - a.piPercent);
  const values = sorted.map((s) => s.piPercent);
  const globalPi = Math.min(combineMultipleValuesChart(values), 100);

  return {
    success: true,
    data: {
      globalPiPercent: globalPi,
      cvcInputs: values,
      details: sorted.map((s) => ({ system: s.system, piPercent: s.piPercent })),
    },
  };
}

// ─── Lookup tools (unchanged from MVP) ───────────────────────────────────────

function handleLookupRom(args: Record<string, unknown>): ToolResult {
  const jointKey = args.joint as string;
  const dirKey = args.direction as string;
  const angle = args.angle as number;
  const isAnkylosed = args.isAnkylosed as boolean;
  const finger = args.finger as FingerKey | undefined;

  const joint = ROM_JOINTS.find((j) => j.key === jointKey);
  if (!joint) return { success: false, error: `Unknown joint: ${jointKey}` };

  const isRingLittle = finger === "ring" || finger === "little";
  const dirs = (joint.perFinger && isRingLittle && joint.directionsRingLittle)
    ? joint.directionsRingLittle : joint.directions;

  const direction = dirs.find((d) => d.key === dirKey);
  if (!direction) return { success: false, error: `Unknown direction '${dirKey}' for joint '${jointKey}'` };

  const table = getRomLookupTable(direction, isAnkylosed);
  const percent = lookupRom(table, angle);

  return { success: true, data: { joint: joint.label, direction: direction.label, angle, isAnkylosed, percent, normalRom: direction.normalRom } };
}

function handleLookupAmputation(args: Record<string, unknown>): ToolResult {
  const type = args.type as string;
  const level = args.level as string;

  if (type === "arm") {
    const entry = ARM_AMPUTATION_LEVELS.find((l) => l.id === level);
    if (!entry) return { success: false, error: `Unknown arm amputation level: ${level}` };
    const suppressed = getAmputationSuppressedJoints({
      armLevel: level, fingers: { thumb: "none", index: "none", middle: "none", ring: "none", little: "none" },
    });
    return { success: true, data: { label: entry.label, percent: entry.percent, suppressedStructures: [...suppressed] } };
  }

  if (type === "finger") {
    const finger = (args.finger as FingerKey) ?? "index";
    const levels = FINGER_AMPUTATION_LEVELS[finger];
    if (!levels) return { success: false, error: `Unknown finger: ${finger}` };
    const entry = levels.find((l) => l.id === level);
    if (!entry) return { success: false, error: `Unknown amputation level '${level}' for finger '${finger}'` };
    return { success: true, data: { finger, label: entry.label, percent: entry.percent } };
  }

  return { success: false, error: `Unknown amputation type: ${type}` };
}

function handleLookupNerve(args: Record<string, unknown>): ToolResult {
  const nerveKey = args.nerveKey as string;
  const deficitType = args.deficitType as string;
  const lossType = args.lossType as string;
  const severityId = args.severityId as string | undefined;

  const nerve = UPPER_LIMB_NERVES.find((n) => n.key === nerveKey);
  if (!nerve) return { success: false, error: `Unknown nerve: ${nerveKey}` };

  if (nerve.group === "entrapment" && nerve.severityLevels) {
    const sev = nerve.severityLevels.find((s) => s.id === severityId);
    return { success: true, data: { nerve: nerve.label, group: nerve.group, percent: sev?.percent ?? 0, severity: sev?.label ?? "unknown" } };
  }

  let maxPct = 0;
  if (deficitType === "sensory") maxPct = nerve.sensoryMax ?? 0;
  else if (deficitType === "motor") maxPct = nerve.motorMax ?? 0;
  else maxPct = nerve.combinedMax ?? 0;

  const pct = lossType === "partial" ? maxPct / 2 : maxPct;
  return { success: true, data: { nerve: nerve.label, group: nerve.group, deficitType, lossType, maxPercent: maxPct, adjustedPercent: pct } };
}

function handleLookupDbe(args: Record<string, unknown>): ToolResult {
  const conditionId = args.conditionId as string;
  const cond = DBE_CONDITIONS.find((c) => c.id === conditionId);
  if (!cond) {
    const query = conditionId.toLowerCase();
    const matches = DBE_CONDITIONS.filter((c) => c.label.toLowerCase().includes(query) || c.description.toLowerCase().includes(query)).slice(0, 5);
    if (matches.length > 0) {
      return { success: true, data: { exactMatch: false, suggestions: matches.map((m) => ({ id: m.id, label: m.label, range: `${m.minPercent}–${m.maxPercent}%` })) } };
    }
    return { success: false, error: `Unknown DBE condition: ${conditionId}` };
  }
  return { success: true, data: { exactMatch: true, id: cond.id, label: cond.label, category: cond.category, minPercent: cond.minPercent, maxPercent: cond.maxPercent, description: cond.description, applicableJoints: cond.anatomicalKeys.map((k) => UPPER_ANATOMICAL_LABELS[k] ?? k) } };
}

function handleSearchDictionary(args: Record<string, unknown>): ToolResult {
  const query = args.query as string;
  const results = searchDictionary(query);
  return { success: true, data: { query, results: results.slice(0, 5), totalMatches: results.length } };
}
