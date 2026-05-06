/**
 * Tool Handlers — bridge between Gemini function calls and the calculation engine.
 * Each handler takes the LLM's structured arguments and returns a JSON result.
 */

import {
  calculateUpperLimb,
  lookupRom,
  getRomLookupTable,
  ROM_JOINTS,
  ARM_AMPUTATION_LEVELS,
  FINGER_AMPUTATION_LEVELS,
  UPPER_LIMB_NERVES,
  DBE_CONDITIONS,
  UPPER_ANATOMICAL_LABELS,
  getAmputationSuppressedJoints,
  type UpperLimbValue,
  type FingerKey,
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
      case "assess_upper_limb":
        return handleAssessUpperLimb(args);
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

function handleAssessUpperLimb(args: Record<string, unknown>): ToolResult {
  const value = args as unknown as UpperLimbValue;
  const result = calculateUpperLimb(value);
  return {
    success: true,
    data: {
      finalPercent: result.finalPercent,
      amputation: result.amputation,
      rom: result.rom,
      neurological: result.neurological,
      dbe: result.dbe,
      dbeRomConflicts: result.dbeRomConflicts,
      cvcInputs: result.cvcInputs,
      summary: formatBreakdownSummary(result),
    },
  };
}

function formatBreakdownSummary(result: ReturnType<typeof calculateUpperLimb>): string {
  const lines: string[] = [];
  lines.push(`## Upper Limb Assessment Result: ${result.finalPercent}% PI`);
  lines.push("");

  const categories = [
    { label: "Amputations", data: result.amputation },
    { label: "ROM", data: result.rom },
    { label: "Neurological", data: result.neurological },
    { label: "DBE", data: result.dbe },
  ];

  for (const cat of categories) {
    if (cat.data.rawPercent > 0 || cat.data.notes.length > 0) {
      lines.push(`### ${cat.label}: ${cat.data.rawPercent}%`);
      for (const note of cat.data.notes) {
        lines.push(`- ${note}`);
      }
      lines.push("");
    }
  }

  if (result.dbeRomConflicts.length > 0) {
    lines.push("### Conflict Resolution (DBE vs ROM)");
    for (const c of result.dbeRomConflicts) {
      const jointLabel = UPPER_ANATOMICAL_LABELS[c.joint as keyof typeof UPPER_ANATOMICAL_LABELS] ?? c.joint;
      lines.push(`- ${jointLabel}: ROM ${c.romPercent}% vs DBE ${c.dbePercent}% → **${c.winner}** retained`);
    }
    lines.push("");
  }

  if (result.cvcInputs.length > 1) {
    lines.push("### CVC Combination");
    lines.push(`- Inputs: ${result.cvcInputs.join("%, ")}%`);
    lines.push(`- Combined: **${result.finalPercent}%**`);
  }

  return lines.join("\n");
}

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
    ? joint.directionsRingLittle
    : joint.directions;

  const direction = dirs.find((d) => d.key === dirKey);
  if (!direction) return { success: false, error: `Unknown direction '${dirKey}' for joint '${jointKey}'` };

  const table = getRomLookupTable(direction, isAnkylosed);
  const percent = lookupRom(table, angle);

  return {
    success: true,
    data: {
      joint: joint.label,
      direction: direction.label,
      angle,
      isAnkylosed,
      percent,
      normalRom: direction.normalRom,
    },
  };
}

function handleLookupAmputation(args: Record<string, unknown>): ToolResult {
  const type = args.type as string;
  const level = args.level as string;

  if (type === "arm") {
    const entry = ARM_AMPUTATION_LEVELS.find((l) => l.id === level);
    if (!entry) return { success: false, error: `Unknown arm amputation level: ${level}` };

    const suppressed = getAmputationSuppressedJoints({
      armLevel: level,
      fingers: { thumb: "none", index: "none", middle: "none", ring: "none", little: "none" },
    });

    return {
      success: true,
      data: {
        label: entry.label,
        percent: entry.percent,
        suppressedStructures: [...suppressed],
      },
    };
  }

  if (type === "finger") {
    const finger = (args.finger as FingerKey) ?? "index";
    const levels = FINGER_AMPUTATION_LEVELS[finger];
    if (!levels) return { success: false, error: `Unknown finger: ${finger}` };
    const entry = levels.find((l) => l.id === level);
    if (!entry) return { success: false, error: `Unknown amputation level '${level}' for finger '${finger}'` };

    return {
      success: true,
      data: {
        finger,
        label: entry.label,
        percent: entry.percent,
      },
    };
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
    return {
      success: true,
      data: {
        nerve: nerve.label,
        group: nerve.group,
        percent: sev?.percent ?? 0,
        severity: sev?.label ?? "unknown",
        availableSeverities: nerve.severityLevels.map((s) => ({ id: s.id, label: s.label, percent: s.percent })),
      },
    };
  }

  let maxPct = 0;
  if (deficitType === "sensory") maxPct = nerve.sensoryMax ?? 0;
  else if (deficitType === "motor") maxPct = nerve.motorMax ?? 0;
  else maxPct = nerve.combinedMax ?? 0;

  const pct = lossType === "partial" ? maxPct / 2 : maxPct;

  return {
    success: true,
    data: {
      nerve: nerve.label,
      group: nerve.group,
      deficitType,
      lossType,
      maxPercent: maxPct,
      adjustedPercent: pct,
      availableDeficits: {
        sensory: nerve.sensoryMax,
        motor: nerve.motorMax,
        combined: nerve.combinedMax,
      },
    },
  };
}

function handleLookupDbe(args: Record<string, unknown>): ToolResult {
  const conditionId = args.conditionId as string;
  const cond = DBE_CONDITIONS.find((c) => c.id === conditionId);
  if (!cond) {
    // Fuzzy search by label
    const query = conditionId.toLowerCase();
    const matches = DBE_CONDITIONS.filter((c) =>
      c.label.toLowerCase().includes(query) || c.description.toLowerCase().includes(query)
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
            joints: m.anatomicalKeys.map((k) => UPPER_ANATOMICAL_LABELS[k] ?? k),
          })),
        },
      };
    }

    return { success: false, error: `Unknown DBE condition: ${conditionId}` };
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
      entryType: cond.entryType,
      description: cond.description,
      applicableJoints: cond.anatomicalKeys.map((k) => UPPER_ANATOMICAL_LABELS[k] ?? k),
    },
  };
}

function handleSearchDictionary(args: Record<string, unknown>): ToolResult {
  const query = args.query as string;
  const results = searchDictionary(query);
  return {
    success: true,
    data: {
      query,
      results: results.slice(0, 5),
      totalMatches: results.length,
    },
  };
}
