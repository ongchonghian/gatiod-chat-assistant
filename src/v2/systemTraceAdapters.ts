/**
 * System Trace Adapters — V2 chat-assistant
 *
 * Ported from angle-gauge-ui/src/components/shared/systemTraceAdapters.ts.
 * Builds a CalculationTrace from (toolArgs, toolResult) for each GATIOD system.
 *
 * Key differences from angle-gauge-ui:
 * - GatiodSystemKey replaces SystemKey.
 * - Spine tool results arrive pre-sanitized (labels instead of enum keys), so
 *   diagnosisCategory / severity fields are used directly without key lookup.
 */

import type { GatiodSystemKey } from "./contracts.js";
import type { CalculationTrace, TraceCap } from "./calculationTrace.js";
import {
  buildAdditiveTrace,
  buildCvcTrace,
  buildHighestTrace,
  buildNoneTrace,
} from "./calculationTraceBuilder.js";
import type { UpperLimbValue, UpperLimbResult } from "../engine/upperLimbData.js";
import type { LowerLimbValue, LowerLimbResult } from "../engine/lowerLimbData.js";
import type { SpineAssessmentResult } from "../engine/spineAssessmentData.js";
import type { RespiratoryValue, RespiratoryResult } from "../engine/respiratoryData.js";
import type { RenalValue, RenalResult } from "../engine/renalData.js";
import type { GastroDigestiveValue, GastroDigestiveResult } from "../engine/gastroDigestiveData.js";
import type { HearingValue, HearingResult } from "../engine/hearingData.js";
import type { CnsValue, CnsResult } from "../engine/cnsAssessmentData.js";
import type { VisualResult } from "../engine/visualAssessmentData.js";
import { PARALYSED_LIMB_OPTIONS } from "../engine/cnsAssessmentData.js";

const round1 = (v: number): number => Math.round(v * 10) / 10;

interface TraceContext {
  level?: "instance" | "spoke" | "system" | "global";
  instanceId?: string;
}

function parseCapNoteToCap(note: string): TraceCap | null {
  if (!/cap/i.test(note)) return null;
  const numbers = note.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length < 2) return null;
  const before = numbers[0];
  const cap = numbers[numbers.length - 1];
  const after = Math.min(before, cap);
  if (!(before > after)) return null;
  return { scope: note, before: round1(before), after: round1(after), cap: round1(cap), reason: note };
}

function extractCaps(notes: string[]): TraceCap[] {
  return notes.map(parseCapNoteToCap).filter((cap): cap is TraceCap => cap !== null);
}

type DbeRomConflict = { joint: string; romPercent: number; dbePercent: number; winner: string };

function buildConflictExcludedInputs(
  sideLabel: string,
  conflicts: DbeRomConflict[]
): Array<{ key: string; label: string; value: number; reason: string }> {
  return conflicts.map((conflict, index) => {
    const loserLabel = conflict.winner === "DBE" ? "ROM" : "Diagnosis-based estimates";
    const loserValue = conflict.winner === "DBE" ? conflict.romPercent : conflict.dbePercent;
    const winnerValue = Math.max(conflict.romPercent, conflict.dbePercent);
    const normalizedJoint = conflict.joint.replace(/\s+/g, "_").toLowerCase();
    return {
      key: `${sideLabel.toLowerCase()}-${normalizedJoint}-conflict-loser-${index}`,
      label: `${sideLabel} ${conflict.joint} ${loserLabel} (conflict loser)`,
      value: round1(loserValue),
      reason: `DBE/ROM conflict resolved at ${sideLabel.toLowerCase()} ${conflict.joint}: ${conflict.winner} retained (${round1(winnerValue)}%), lower value excluded.`,
    };
  });
}

export function buildUpperLimbTrace(
  value: UpperLimbValue,
  result: UpperLimbResult,
  context: TraceContext = {}
): CalculationTrace {
  const notes = [
    ...result.amputation.notes,
    ...result.rom.notes,
    ...result.neurological.notes,
    ...result.dbe.notes,
  ];
  const romSuppression = result.rom.notes.find((note) => /suppressed|excluded/i.test(note));
  const dbeSuppression = result.dbe.notes.find((note) => /suppressed|excluded/i.test(note));
  const conflictNotes = result.dbeRomConflicts.map(
    (c) => `${c.joint}: ${c.winner} retained (${Math.max(c.romPercent, c.dbePercent)}%), lower value excluded.`
  );
  const conflictExcludedInputs = buildConflictExcludedInputs(value.side, result.dbeRomConflicts);
  const conflictCount = result.dbeRomConflicts.length;

  const inputs = [
    { key: "amputation",    label: "Amputations",                value: result.amputation.rawPercent },
    { key: "rom",           label: "ROM (Restriction/Ankylosis)", value: result.rom.rawPercent, reason: result.rom.rawPercent <= 0 ? romSuppression : undefined },
    { key: "neurological",  label: "Neurological",               value: result.neurological.rawPercent },
    { key: "dbe",           label: "Diagnosis-based estimates",  value: result.dbe.rawPercent, reason: result.dbe.rawPercent <= 0 ? dbeSuppression : undefined },
    ...conflictExcludedInputs,
  ];

  if (value.neurological.romFromNerve) {
    const romByJointRaw = result.rom.notes
      .filter((n) => !n.includes("CVC") && !n.includes("suppressed"))
      .map((n) => {
        const match = n.match(/^(.*):\s*.*\s*=\s*(\d+)%/);
        if (match) return { label: match[1], value: Number(match[2]) };
        return null;
      })
      .filter((v): v is { label: string; value: number } => v !== null && v.value > 0);
    for (const item of romByJointRaw) {
      inputs.push({ key: `excluded-rom-${item.label}`, label: `${item.label} ROM (excluded)`, value: item.value, reason: "ROM excluded: restrictions attributed to nerve lesion per Rule R0017." });
    }
  }

  return buildCvcTrace({
    level: context.level ?? "spoke",
    systemKey: "upper_limb",
    instanceId: context.instanceId,
    inputs,
    caps: extractCaps(notes),
    ruleNotes: [
      `Assessed side: ${value.side}`,
      conflictCount > 0 ? `DBE/ROM conflicts resolved: higher values retained across ${conflictCount} joint${conflictCount === 1 ? "" : "s"}.` : "",
      ...conflictNotes,
      ...notes.filter((note) => /cap/i.test(note)),
    ].filter(Boolean),
    cvcChartRounding: true,
  });
}

export function buildLowerLimbTrace(
  value: LowerLimbValue,
  result: LowerLimbResult,
  context: TraceContext = {}
): CalculationTrace {
  const notes = [
    ...result.amputation.notes,
    ...result.rom.notes,
    ...result.neurological.notes,
    ...result.shortening.notes,
    ...result.dbe.notes,
  ];
  const romSuppression = result.rom.notes.find((note) => /suppressed|excluded/i.test(note));
  const dbeSuppression = result.dbe.notes.find((note) => /suppressed|excluded/i.test(note));
  const conflictNotes = result.dbeRomConflicts.map(
    (c) => `${c.joint}: ${c.winner} retained (${Math.max(c.romPercent, c.dbePercent)}%), lower value excluded.`
  );
  const conflictExcludedInputs = buildConflictExcludedInputs(value.side, result.dbeRomConflicts);
  const conflictCount = result.dbeRomConflicts.length;

  const inputs = [
    { key: "amputation",    label: "Amputations",                value: result.amputation.rawPercent },
    { key: "rom",           label: "ROM (Restriction/Ankylosis)", value: result.rom.rawPercent, reason: result.rom.rawPercent <= 0 ? romSuppression : undefined },
    { key: "neurological",  label: "Neurological",               value: result.neurological.rawPercent },
    { key: "shortening",    label: "Limb shortening",            value: result.shortening.rawPercent },
    { key: "dbe",           label: "Diagnosis-based estimates",  value: result.dbe.rawPercent, reason: result.dbe.rawPercent <= 0 ? dbeSuppression : undefined },
    ...conflictExcludedInputs,
  ];

  if (value.neurological?.romFromNerve) {
    const romByJointRaw = result.rom.notes
      .filter((n) => !n.includes("CVC") && !n.includes("suppressed"))
      .map((n) => {
        const match = n.match(/^(.*):\s*.*\s*=\s*(\d+)%/);
        if (match) return { label: match[1], value: Number(match[2]) };
        return null;
      })
      .filter((v): v is { label: string; value: number } => v !== null && v.value > 0);
    for (const item of romByJointRaw) {
      inputs.push({ key: `excluded-rom-${item.label}`, label: `${item.label} ROM (excluded)`, value: item.value, reason: "ROM excluded: restrictions attributed to nerve lesion per Rule R0022." });
    }
  }

  return buildCvcTrace({
    level: context.level ?? "spoke",
    systemKey: "lower_limb",
    instanceId: context.instanceId,
    inputs,
    caps: extractCaps(notes),
    ruleNotes: [
      `Assessed side: ${value.side}`,
      conflictCount > 0 ? `DBE/ROM conflicts resolved: higher values retained across ${conflictCount} joint${conflictCount === 1 ? "" : "s"}.` : "",
      ...conflictNotes,
      ...notes.filter((note) => /cap/i.test(note)),
    ].filter(Boolean),
    cvcChartRounding: true,
  });
}

export function buildSpineTrace(
  result: SpineAssessmentResult,
  context: TraceContext = {}
): CalculationTrace {
  // Note: spine tool results arrive pre-sanitized — entry.diagnosisCategory and
  // entry.severity are already human-readable labels, not enum keys.
  const caps: TraceCap[] = [];

  const inputs = result.evaluatedEntries.map((entry, index) => {
    if (entry.preCapPercent > entry.computedPercent) {
      caps.push({
        scope: `Category ${index + 1}`,
        before: round1(entry.preCapPercent),
        after: round1(entry.computedPercent),
        cap: 100,
        reason: "Hard cap at 100%",
      });
    }

    const modifierSummary = [
      `base ${round1(entry.basePercent)}%`,
      entry.isMonoparesis
        ? `monoparesis -> ${round1(entry.adjustedPercent)}%`
        : `adjusted ${round1(entry.adjustedPercent)}%`,
      entry.bladderBowelAddOn > 0 ? `B/B +${round1(entry.bladderBowelAddOn)}%` : "B/B +0%",
      entry.preCapPercent > entry.computedPercent
        ? `capped ${round1(entry.preCapPercent)}% -> ${round1(entry.computedPercent)}%`
        : `final ${round1(entry.computedPercent)}%`,
    ].join(", ");

    return {
      key: `category-${index + 1}`,
      label: `Category ${index + 1}: ${entry.diagnosisCategory} — ${entry.severity} (${modifierSummary})`,
      value: entry.computedPercent,
      reason: entry.suppressed ? entry.suppressionReason : undefined,
    };
  });

  return buildHighestTrace({
    level: context.level ?? "instance",
    systemKey: "spine",
    instanceId: context.instanceId,
    inputs,
    caps,
    ruleNotes: [
      `Region: ${result.spinalRegion}`,
      "Highest award override applied across completed diagnosis categories.",
      "Per-entry flow: base -> monoparesis (ASIA C/D only) -> bladder/bowel add-on (rows a-d only) -> cap at 100%.",
      result.firstScheduleFlag ? "First Schedule bonus condition met (100% permanent total incapacity)." : "",
    ].filter(Boolean),
    showZeroAsExcluded: true,
  });
}

export function buildRespiratoryTrace(
  value: RespiratoryValue,
  result: RespiratoryResult,
  context: TraceContext = {}
): CalculationTrace {
  const metricRows = ([
    ["FVC",    result.testClassifications.fvc],
    ["FEV1",   result.testClassifications.fev1],
    ["DLCO",   result.testClassifications.dlco],
    ["VO2 Max",result.testClassifications.vo2Max],
  ] as const).map(
    ([label, metric]) =>
      `${label}: ${metric.value ?? "not provided"} (${metric.matchedClassDefinition ? metric.classLabel : "Boundary / no class match"})`
  );

  return buildNoneTrace({
    level: context.level ?? "spoke",
    systemKey: "respiratory",
    instanceId: context.instanceId,
    inputs: [{ key: "selected", label: "Selected PI%", value: result.selectedPi }],
    caps: result.hardCapApplied
      ? [{ scope: "Respiratory final PI", before: result.selectionAdjustedFrom ?? result.selectedPi, after: result.selectedPi, cap: 100, reason: "Hard cap at 100%" }]
      : [],
    ruleNotes: [
      `Diagnosis path: ${value.diagnosis}`,
      `Base class path: ${result.baseSeverityLabel} (${result.basePiRangeMin}-${result.basePiRangeMax}%).`,
      ...metricRows,
      `Final class path: ${result.severityLabel} (${result.piRangeMin}-${result.piRangeMax}%).`,
      result.isAsthmaOverride ? "Precedence: occupational asthma medication override used." : "",
      result.isAsbestosisFloor ? "Precedence: asbestosis/silicosis minimum 10% floor applied." : "",
      result.selectionAdjustedFrom !== null
        ? `Nearest-5 handling: ${result.selectionAdjustedFrom}% -> ${result.selectedPi}% (${result.selectionAdjustmentReason}).`
        : "",
      result.hardCapApplied ? "Cap handling: hard cap at 100% applied." : "Cap handling: no cap applied.",
      result.firstScheduleFlag ? "First Schedule annotation flag: true." : "First Schedule annotation flag: false.",
    ].filter(Boolean),
  });
}

export function buildRenalTrace(
  value: RenalValue,
  result: RenalResult,
  context: TraceContext = {}
): CalculationTrace {
  return buildNoneTrace({
    level: context.level ?? "spoke",
    systemKey: "renal",
    instanceId: context.instanceId,
    inputs: [{ key: "final", label: "Final renal PI%", value: result.finalPi }],
    ruleNotes: [
      `Highest-class base path: ${result.severityLabel} (${result.piRangeMin}-${result.piRangeMax}%). Base selected PI = ${result.baseSelectedPi}%.`,
      `Input class indices — serum creatinine ${result.serumCreatinineClass}, creatinine clearance ${result.creatinineClearanceClass}, CKD ${result.ckdClass}, clinical ${result.clinicalClass}.`,
      result.selectionAdjustedFrom !== null
        ? `Nearest-5 handling: ${result.selectionAdjustedFrom}% -> ${result.baseSelectedPi}% (${result.selectionAdjustmentReason}).`
        : "Nearest-5 handling: no adjustment applied.",
      value.solitaryKidney
        ? `Solitary-kidney path: CVC(${result.baseSelectedPi}%, 10%) -> ${result.finalPi}%.`
        : "Solitary-kidney path: not applied.",
      result.isProvisional ? "Provisional status: provisional award active." : "Provisional status: final award path.",
      result.hardCapApplied ? "Cap handling: hard cap at 100% applied." : "Cap handling: no cap applied.",
      result.hasClassifyingInput ? "Class-routing inputs provided." : "No class-routing inputs provided; base PI defaults to 0%.",
    ].filter(Boolean),
  });
}

export function buildGastroTrace(
  value: GastroDigestiveValue,
  result: GastroDigestiveResult,
  context: TraceContext = {}
): CalculationTrace {
  const subPathLabel =
    value.subSystem === "colonicRectalAnal"
      ? value.colonalSubPath === "anal" ? "Anal" : "Colonic/Rectal"
      : value.subSystem === "liverBiliary"
        ? value.liverBiliarySubPath === "biliary" ? "Biliary" : "Liver"
        : null;

  const bracketRange =
    result.bracket && typeof result.bracket.min === "number" && typeof result.bracket.max === "number"
      ? `${result.bracket.min}-${result.bracket.max}%`
      : null;

  return buildNoneTrace({
    level: context.level ?? "instance",
    systemKey: "gastro_digestive",
    instanceId: context.instanceId,
    inputs: [{
      key: "selected",
      label: result.bracket
        ? `${result.subSystemLabel}${subPathLabel ? ` (${subPathLabel})` : ""} — ${result.bracket.label}${bracketRange ? ` [${bracketRange}]` : ""}`
        : `${result.subSystemLabel || "Sub-system"}${subPathLabel ? ` (${subPathLabel})` : ""} PI%`,
      value: result.piPercent ?? 0,
      reason: result.piPercent === null ? "No PI% selected yet." : undefined,
    }],
    ruleNotes: [
      value.subSystem ? `Sub-system path: ${value.subSystem}.` : "",
      subPathLabel ? `Sub-path: ${subPathLabel}.` : "",
      result.bracket ? `Bracket path: ${result.bracket.label}${bracketRange ? ` (${bracketRange})` : ""}.` : "No bracket selected yet.",
      value.clinicalJustification ? `Clinical justification: ${value.clinicalJustification}` : "",
      result.isOutOfRange ? "Selected PI% is outside the selected bracket range." : "",
    ].filter(Boolean),
    showZeroAsExcluded: true,
  });
}

export function buildHearingTrace(
  value: HearingValue,
  result: HearingResult,
  context: TraceContext = {}
): CalculationTrace {
  if (value.path === "injury" && "leftPercent" in result && "rightPercent" in result) {
    const affectedEarLabel = value.affectedEars === "left" ? "left ear" : "right ear";
    return buildAdditiveTrace({
      level: context.level ?? "spoke",
      systemKey: "hearing",
      instanceId: context.instanceId,
      inputs: [
        {
          key: "left",
          label: "Left ear",
          value: result.leftPercent,
          reason: value.affectedEars === "right" ? "Left ear not selected in affected ears." : undefined,
        },
        {
          key: "right",
          label: "Right ear",
          value: result.rightPercent,
          reason: value.affectedEars === "left" ? "Right ear not selected in affected ears." : undefined,
        },
      ],
      ruleNotes: [
        `Injury/accident instance is scoped to ${affectedEarLabel}.`,
        "Injury/accident pathway uses additive rule (no CVC).",
        `Final instance PI: ${round1(result.finalPercent)}%.`,
      ],
      showZeroAsExcluded: true,
    });
  }

  const betterEar       = "betterEar"           in result ? result.betterEar           : undefined;
  const betterEarAhl    = "betterEarAhl"         in result ? result.betterEarAhl         : undefined;
  const isEarlyNid      = "isEarlyNid"           in result ? result.isEarlyNid           : false;
  const base            = "basePercent"          in result ? result.basePercent          : result.finalPercent;
  const deduction       = "presbycusisDeduction" in result ? result.presbycusisDeduction : 0;

  return buildNoneTrace({
    level: context.level ?? "spoke",
    systemKey: "hearing",
    instanceId: context.instanceId,
    inputs: [{ key: "selected", label: "NID final PI%", value: result.finalPercent }],
    ruleNotes: [
      betterEar
        ? `Better-ear rationale: left ${(value as { leftEarAhl?: number }).leftEarAhl} dB vs right ${(value as { rightEarAhl?: number }).rightEarAhl} dB; selected ${betterEar}${betterEarAhl !== undefined ? ` (${betterEarAhl} dB)` : ""}.`
        : "",
      isEarlyNid ? "NID gating: better ear AHL < 50 dB => non-compensable (0%)." : `NID table base PI: ${round1(base)}%.`,
      deduction > 0 ? `Presbycusis deduction: ${round1(deduction)}%.` : "",
      `Final PI: ${round1(result.finalPercent)}%.`,
    ].filter(Boolean),
  });
}

export function buildCnsTrace(
  value: CnsValue,
  result: CnsResult,
  context: TraceContext = {}
): CalculationTrace {
  const sectionBInputs = [
    { label: "Olfaction",                                value: value.olfaction.value },
    { label: "Facial nerves",                            value: value.facialNerve.value },
    { label: "Equilibrium",                              value: value.equilibrium.value },
    { label: "Cranial nerves IX/X/XII (swallowing/speech)", value: value.swallowing.value },
    { label: "Station and gait",                         value: value.stationGait.value },
    { label: "Neurological respiration",                 value: value.respiration.value },
  ];
  const sectionBIncluded = sectionBInputs.filter((e) => e.value > 0);
  const sectionBExcluded = sectionBInputs.filter((e) => e.value <= 0);
  const sectionCLabels = result.sectionCLimbIds
    .map((id) => PARALYSED_LIMB_OPTIONS.find((option) => option.id === id)?.label)
    .filter((label): label is string => Boolean(label));

  const tieNote = result.sectionATieGroups.length > 1
    ? `Tie at ${result.sectionAHighest}% across ${result.sectionATieGroups.join(", ")}; first-listed group retained.`
    : "";

  const sectionAInputs = result.sectionAScores.map((score, idx) => ({
    key: `section-a-group-${idx}`,
    label: score.label,
    value: score.value,
    reason: !score.winner && score.value > 0
      ? `Excluded: Chapter 10 Section A highest-score rule (${result.sectionAHighestGroup} won).`
      : undefined,
  }));

  return buildCvcTrace({
    level: context.level ?? "spoke",
    systemKey: "cns",
    instanceId: context.instanceId,
    inputs: [
      ...sectionAInputs,
      { key: "section-b", label: "Chapter 10 Section B (Other neurological)", value: result.sectionBCombined },
      { key: "section-c", label: "Chapter 10 Section C (Paralysed limbs)",    value: result.sectionCTotal },
    ],
    ruleNotes: [
      `Chapter 10 Section A winner: ${result.sectionAHighestGroup}.`,
      `Group 1 highest subcategory: ${result.group1WinnerSubcategory}.`,
      value.group2.value > 0 && !value.group2NeuropsychologistConfirmed
        ? "Group 2 selected but excluded pending neuropsychologist confirmation." : "",
      value.group4.value > 0 && !value.group4PsychiatristConfirmed
        ? "Group 4 selected but excluded pending psychiatrist confirmation." : "",
      tieNote,
      sectionBIncluded.length > 0
        ? `Chapter 10 Section B included findings: ${sectionBIncluded.map((e) => `${e.label} ${round1(e.value)}%`).join("; ")}.`
        : "Chapter 10 Section B included findings: none.",
      sectionBExcluded.length > 0
        ? `Chapter 10 Section B excluded findings (0%): ${sectionBExcluded.map((e) => e.label).join("; ")}.`
        : "",
      sectionCLabels.length > 0
        ? `Chapter 10 Section C selected limbs: ${sectionCLabels.join("; ")}.`
        : "Chapter 10 Section C selected limbs: none.",
      result.firstScheduleBonus
        ? "First Schedule annotation: both upper limbs at 100% triggers external +25% compensation note."
        : "First Schedule annotation: not triggered.",
      result.finalBeforeCap > 100
        ? `Cap handling: ${round1(result.finalBeforeCap)}% capped to 100%.`
        : `Cap handling: no cap applied (${round1(result.finalPercent)}%).`,
    ].filter(Boolean),
    showZeroAsExcluded: true,
    cvcChartRounding: true,
  });
}

export function buildVisualTrace(
  result: VisualResult,
  context: TraceContext = {}
): CalculationTrace {
  const caps: TraceCap[] = [];
  const eyeCapNotes: string[] = [];

  if (result.rightEye.rawTotal > result.rightEye.cappedTotal) {
    eyeCapNotes.push(`Right eye capped: ${round1(result.rightEye.rawTotal)}% to ${round1(result.rightEye.cappedTotal)}% (50% monocular cap).`);
  }
  if (result.leftEye.rawTotal > result.leftEye.cappedTotal) {
    eyeCapNotes.push(`Left eye capped: ${round1(result.leftEye.rawTotal)}% to ${round1(result.leftEye.cappedTotal)}% (50% monocular cap).`);
  }

  const additiveBefore = round1(result.binocularSubtotal + result.diplopiaPercent);
  if (additiveBefore > result.finalPercent) {
    caps.push({
      scope: "Total visual cap",
      before: additiveBefore,
      after: round1(result.finalPercent),
      cap: 100,
      reason: result.legalBlindness ? "Legal blindness rule enforces 100%." : "Hard cap at 100%",
    });
  }

  return buildAdditiveTrace({
    level: context.level ?? "spoke",
    systemKey: "visual",
    instanceId: context.instanceId,
    inputs: [
      { key: "right",    label: "Right eye (capped)", value: result.rightEye.cappedTotal },
      { key: "left",     label: "Left eye (capped)",  value: result.leftEye.cappedTotal },
      { key: "diplopia", label: "Diplopia",            value: result.diplopiaPercent },
    ],
    caps,
    ruleNotes: [
      "Additive binocular rule: right eye cap + left eye cap + diplopia.",
      ...eyeCapNotes,
      result.legalBlindness ? "Legal blindness condition met (both eyes >= 6/60)." : "",
    ].filter(Boolean),
  });
}

/**
 * Dispatch to the correct per-system trace builder.
 * `toolArgs` and `toolResult` are the raw objects from the tool call.
 * Returns null for unknown systems or if types don't match.
 */
export function buildTraceForSystem(
  systemKey: GatiodSystemKey,
  toolArgs: unknown,
  toolResult: unknown,
  context: TraceContext = {}
): CalculationTrace | null {
  try {
    switch (systemKey) {
      case "upper_limb":
        return buildUpperLimbTrace(toolArgs as UpperLimbValue, toolResult as UpperLimbResult, context);
      case "lower_limb":
        return buildLowerLimbTrace(toolArgs as LowerLimbValue, toolResult as LowerLimbResult, context);
      case "spine":
        return buildSpineTrace(toolResult as SpineAssessmentResult, context);
      case "respiratory":
        return buildRespiratoryTrace(toolArgs as RespiratoryValue, toolResult as RespiratoryResult, context);
      case "renal":
        return buildRenalTrace(toolArgs as RenalValue, toolResult as RenalResult, context);
      case "gastro_digestive":
        return buildGastroTrace(toolArgs as GastroDigestiveValue, toolResult as GastroDigestiveResult, context);
      case "hearing":
        return buildHearingTrace(toolArgs as HearingValue, toolResult as HearingResult, context);
      case "cns":
        return buildCnsTrace(toolArgs as CnsValue, toolResult as CnsResult, context);
      case "visual":
        return buildVisualTrace(toolResult as VisualResult, context);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
