/**
 * Tool Handlers — bridge between Gemini function calls and the calculation engine.
 * Supports all 9 GATIOD systems + global CVC + lookup tools.
 */

import { z } from "zod";
import {
  // Upper Limb
  calculateUpperLimb, lookupRom, getRomLookupTable,
  ROM_JOINTS, ARM_AMPUTATION_LEVELS, FINGER_AMPUTATION_LEVELS,
  UPPER_LIMB_NERVES, DBE_CONDITIONS, UPPER_ANATOMICAL_LABELS,
  getAmputationSuppressedJoints,
  UpperLimbValueSchema,
  type FingerKey,
  // Lower Limb
  calculateLowerLimb,
  LEG_AMPUTATION_LEVELS, TOE_AMPUTATION_LEVELS,
  LOWER_LIMB_NERVES, lookupShortening,
  LOWER_DBE_CONDITIONS, LOWER_ANATOMICAL_LABELS,
  TOE_LABELS,
  LowerLimbValueSchema,
  type ToeKey,
  // Spine
  calculateSpineAssessment, type SpinalRegion, type SpineCategoryEntry,
  SpineToolInputSchema,
  // Respiratory
  calculateRespiratoryAssessment,
  RespiratoryValueSchema,
  // Renal
  calculateRenalAssessment,
  RenalValueSchema,
  // Gastro
  calculateGastroDigestiveAssessment,
  GastroDigestiveValueSchema,
  // Hearing
  calculateHearing,
  hearingValueSchema,
  // CNS
  calculateCns, defaultCnsValue, cnsValueSchema, type CnsValue,
  // Visual
  calculateVisual, visualValueSchema,
  // CVC
  combineMultipleValuesChart,
} from "../engine/index.js";
import { searchDictionary } from "../rag/dictionaryIndex.js";
import { saveInvestigation, type InvestigationType } from "../db/investigationLog.js";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function handleToolCall(name: string, args: Record<string, unknown>, sessionId?: string): ToolResult {
  try {
    switch (name) {
      // ─── Assessment tools (one per system) ─────────────────────────
      case "assess_upper_limb":
        return validateAndCalc(UpperLimbValueSchema, args, calculateUpperLimb, "upper_limb");
      case "assess_lower_limb":
        return validateAndCalc(LowerLimbValueSchema, args, calculateLowerLimb, "lower_limb");
      case "assess_spine":
        return handleAssessSpine(args);
      case "assess_respiratory":
        return validateAndCalc(RespiratoryValueSchema, args, calculateRespiratoryAssessment, "respiratory");
      case "assess_renal":
        return validateAndCalc(RenalValueSchema, args, calculateRenalAssessment, "renal");
      case "assess_gastro":
        return validateAndCalc(GastroDigestiveValueSchema, args, calculateGastroDigestiveAssessment, "gastro_digestive");
      case "assess_hearing":
        return validateAndCalc(hearingValueSchema, args, calculateHearing, "hearing");
      case "assess_cns":
        return handleAssessCns(args);
      case "assess_visual":
        return handleAssessVisual(args);

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

      // ─── Lower limb lookup tools ────────────────────────────────
      case "lookup_lower_amputation":
        return handleLookupLowerAmputation(args);
      case "lookup_lower_nerve":
        return handleLookupLowerNerve(args);
      case "lookup_shortening":
        return handleLookupShortening(args);
      case "lookup_lower_dbe_condition":
        return handleLookupLowerDbe(args);

      case "register_investigation":
        return handleRegisterInvestigation(args, sessionId);

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

/**
 * Validate the LLM-supplied args against the engine's Zod schema before
 * calling the deterministic calculator. This is the function-call boundary
 * guard: if the LLM hallucinates a field shape the engine will refuse the
 * call with a structured error rather than computing on garbage.
 */
function validateAndCalc<T>(
  schema: z.ZodTypeAny,
  args: Record<string, unknown>,
  calc: (value: T) => unknown,
  systemKey: string,
): ToolResult {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: formatValidationError(systemKey, parsed.error) };
  }
  return wrapCalc(() => calc(parsed.data as T), systemKey);
}

function formatValidationError(systemKey: string, error: z.ZodError): string {
  const issues = error.errors.slice(0, 8).map((e) => {
    const path = e.path.length === 0 ? "(root)" : e.path.join(".");
    return `${path}: ${e.message}`;
  });
  const more = error.errors.length > issues.length ? ` (+${error.errors.length - issues.length} more)` : "";
  return `Invalid input for ${systemKey}: ${issues.join("; ")}${more}`;
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
  const parsed = SpineToolInputSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: formatValidationError("spine", parsed.error) };
  }
  const { region, categoryEntries: rawEntries } = parsed.data;

  // The tool schema uses severityKey/monoparesisHalving (LLM-facing); the
  // engine uses severity/isMonoparesis. Map here, after validation.
  const entries = rawEntries.map((e) => ({
    diagnosisCategory: e.diagnosisCategory,
    severity: e.severityKey ?? e.severity ?? "",
    isMonoparesis: Boolean(e.monoparesisHalving ?? e.isMonoparesis ?? false),
    bladderBowelSeverity: e.bladderBowelSeverity ?? "none",
    discCordInvolvement: Boolean(e.discCordInvolvement ?? false),
    spondylolysisPathway: e.spondylolysisPathway ?? "acute_traumatic",
  })) as SpineCategoryEntry[];

  const result = calculateSpineAssessment(region as SpinalRegion, entries);
  return { success: true, data: { ...result, systemKey: "spine" } };
}

// ─── CNS (merge with defaults to guard against missing optional fields) ───────

function handleAssessCns(args: Record<string, unknown>): ToolResult {
  const merged: CnsValue = {
    ...defaultCnsValue(),
    ...args,
    paralysedLimbs: Array.isArray(args.paralysedLimbs)
      ? (args.paralysedLimbs as string[])
      : [],
  };

  // The engine gates these three fields to 0 when the corresponding confirmation
  // boolean is false. In this system the doctor IS the specialist — if they supply
  // a non-zero value the finding is already confirmed. Auto-confirm so the LLM
  // never receives a silent 0 back when it submitted a value.
  const sel = (k: keyof CnsValue) => (merged[k] as { value?: number })?.value ?? 0;
  if (sel("equilibrium") > 0 && !merged.equilibriumEntConfirmed) merged.equilibriumEntConfirmed = true;
  if (sel("group2") > 0 && !merged.group2NeuropsychologistConfirmed) merged.group2NeuropsychologistConfirmed = true;
  if (sel("group4") > 0 && !merged.group4PsychiatristConfirmed) merged.group4PsychiatristConfirmed = true;

  const parsed = cnsValueSchema.safeParse(merged);
  if (!parsed.success) {
    return { success: false, error: formatValidationError("cns", parsed.error) };
  }
  return wrapCalc(() => calculateCns(parsed.data as CnsValue), "cns");
}

// ─── Visual (guard functionalModifiers/specificConditions against null) ───────

function normaliseEye(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    functionalModifiers: Array.isArray(raw.functionalModifiers) ? raw.functionalModifiers : [],
    specificConditions: Array.isArray(raw.specificConditions) ? raw.specificConditions : [],
  };
}

function handleAssessVisual(args: Record<string, unknown>): ToolResult {
  const safe = {
    ...args,
    leftEye: normaliseEye((args.leftEye ?? {}) as Record<string, unknown>),
    rightEye: normaliseEye((args.rightEye ?? {}) as Record<string, unknown>),
  };
  return validateAndCalc(visualValueSchema, safe as Record<string, unknown>, calculateVisual, "visual");
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

// ─── Lower limb lookup tools ─────────────────────────────────────────────────

function handleLookupLowerAmputation(args: Record<string, unknown>): ToolResult {
  const type = args.type as string;
  const level = args.level as string;

  if (type === "leg") {
    const entry = LEG_AMPUTATION_LEVELS.find((l) => l.id === level);
    if (!entry) {
      return {
        success: false,
        error: `Unknown leg amputation level: ${level}. Valid levels: ${LEG_AMPUTATION_LEVELS.map((l) => `${l.id} (${l.percent}%)`).join(", ")}`,
      };
    }
    return { success: true, data: { type: "leg", label: entry.label, percent: entry.percent, disablesBelow: entry.disablesBelow } };
  }

  if (type === "toe") {
    const toe = (args.toe as ToeKey) ?? "fourth";
    const levels = TOE_AMPUTATION_LEVELS[toe];
    if (!levels) {
      return { success: false, error: `Unknown toe: ${toe}. Valid toes: great, second, third, fourth, fifth` };
    }
    const entry = levels.find((l) => l.id === level);
    if (!entry) {
      return {
        success: false,
        error: `Unknown amputation level '${level}' for ${TOE_LABELS[toe]}. Valid levels: ${levels.map((l) => `${l.id} (${l.percent}%)`).join(", ")}`,
      };
    }
    return { success: true, data: { type: "toe", toe: TOE_LABELS[toe], label: entry.label, percent: entry.percent } };
  }

  return { success: false, error: `Unknown amputation type: ${type}. Use 'leg' or 'toe'.` };
}

function handleLookupLowerNerve(args: Record<string, unknown>): ToolResult {
  const nerveKey = args.nerveKey as string;
  const deficitType = args.deficitType as string;
  const lossType = args.lossType as string;

  const nerve = LOWER_LIMB_NERVES.find((n) => n.key === nerveKey);
  if (!nerve) {
    return {
      success: false,
      error: `Unknown lower limb nerve: ${nerveKey}. Valid nerves: ${LOWER_LIMB_NERVES.map((n) => n.key).join(", ")}`,
    };
  }

  let maxPct = 0;
  if (deficitType === "sensory") maxPct = nerve.sensoryMax ?? 0;
  else if (deficitType === "motor") maxPct = nerve.motorMax ?? 0;
  else maxPct = nerve.combinedMax ?? 0;

  const pct = lossType === "partial" ? maxPct / 2 : maxPct;
  return { success: true, data: { nerve: nerve.label, group: nerve.group, deficitType, lossType, maxPercent: maxPct, adjustedPercent: pct } };
}

function handleLookupShortening(args: Record<string, unknown>): ToolResult {
  const cm = args.discrepancyCm as number;
  if (cm === undefined || cm === null) {
    return { success: false, error: "discrepancyCm is required. This is the measured limb length difference in cm, NOT toe amputation." };
  }
  const pct = lookupShortening(cm);
  return {
    success: true,
    data: {
      discrepancyCm: cm,
      percent: pct,
      note: "Shortening is ONLY for measured limb length discrepancy. Toe amputations are assessed under the amputations category, not shortening.",
    },
  };
}

function handleLookupLowerDbe(args: Record<string, unknown>): ToolResult {
  const conditionId = args.conditionId as string;
  const cond = LOWER_DBE_CONDITIONS.find((c) => c.id === conditionId);
  if (!cond) {
    const query = conditionId.toLowerCase();
    const matches = LOWER_DBE_CONDITIONS.filter(
      (c) => c.label.toLowerCase().includes(query) || c.description.toLowerCase().includes(query)
    ).slice(0, 5);
    if (matches.length > 0) {
      return {
        success: true,
        data: {
          exactMatch: false,
          suggestions: matches.map((m) => ({
            id: m.id,
            label: m.label,
            range: `${m.minPercent}–${m.maxPercent}%`,
            anatomicalKeys: m.anatomicalKeys,
          })),
        },
      };
    }
    return { success: false, error: `Unknown lower limb DBE condition: ${conditionId}` };
  }
  return {
    success: true,
    data: {
      exactMatch: true,
      id: cond.id,
      label: cond.label,
      category: cond.category,
      minPercent: cond.minPercent,
      maxPercent: cond.maxPercent,
      description: cond.description,
      applicableJoints: cond.anatomicalKeys.map((k) => LOWER_ANATOMICAL_LABELS[k] ?? k),
    },
  };
}

function handleRegisterInvestigation(args: Record<string, unknown>, sessionId?: string): ToolResult {
  if (!sessionId) return { success: false, error: "Session ID unavailable — cannot register investigation." };

  const investigation = saveInvestigation({
    sessionId,
    stepId: args.stepId as string,
    stepTitle: args.stepTitle as string,
    doctorConcern: args.doctorConcern as string,
    clinicalContext: args.clinicalContext as string,
    investigationType: args.investigationType as InvestigationType,
  });

  return {
    success: true,
    data: {
      investigationId: investigation.id,
      message: `Investigation registered with reference ${investigation.id}. A clinical expert will review this case.`,
    },
  };
}
