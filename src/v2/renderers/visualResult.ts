import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { EyeResult, VisualResult } from "../../engine/visualAssessmentData.js";
import { factKeyLabel, factValueDisplay } from "../clinicalLabels.js";
import {
  SNELLEN_ACUITY, VISUAL_FIELD_LOSS,
  FUNCTIONAL_MODIFIERS, SPECIFIC_CONDITIONS, DIPLOPIA_OPTIONS,
} from "../../engine/visualAssessmentData.js";
import {
  VISUAL_FK_LEFT_ACUITY, VISUAL_FK_RIGHT_ACUITY,
  VISUAL_FK_LEFT_FIELD,  VISUAL_FK_RIGHT_FIELD,
  VISUAL_FK_LEFT_MODIFIERS,  VISUAL_FK_RIGHT_MODIFIERS,
  VISUAL_FK_LEFT_CONDITIONS, VISUAL_FK_RIGHT_CONDITIONS,
  VISUAL_FK_DIPLOPIA,
} from "../extractors/visual.js";

function pct(n: number): string { return `${n}%`; }

function acuityLabel(id: string):    string { return SNELLEN_ACUITY.find((s) => s.id === id)?.label    ?? id; }
function fieldLabel(id: string):     string { return VISUAL_FIELD_LOSS.find((f) => f.id === id)?.label  ?? id; }
function modifierLabel(id: string):  string { return FUNCTIONAL_MODIFIERS.find((m) => m.id === id)?.label ?? id; }
function conditionLabel(id: string): string { return SPECIFIC_CONDITIONS.find((c) => c.id === id)?.label  ?? id; }
function diplopiaLabel(id: string):  string { return DIPLOPIA_OPTIONS.find((d) => d.id === id)?.label     ?? id; }

function shouldAutoExpand(result: VisualResult): boolean {
  if (result.legalBlindness) return true;
  if (result.diplopiaPercent > 0) return true;
  if (result.leftEye.rawTotal  > result.leftEye.cappedTotal)  return true;
  if (result.rightEye.rawTotal > result.rightEye.cappedTotal) return true;
  return false;
}

function eyeSummaryLine(side: "Right" | "Left", eye: EyeResult): string {
  if (eye.rawTotal === 0) return `${side} eye: no impairment (0%)`;
  const capNote = eye.rawTotal > eye.cappedTotal ? ` [capped from ${pct(eye.rawTotal)} at 50%]` : "";
  return `${side} eye: ${pct(eye.cappedTotal)}${capNote}`;
}

function eyeBreakdownLines(
  side: "Right" | "Left",
  eye: EyeResult,
  acuityId: string,
  fieldId: string,
  modIds: string[],
  condIds: string[],
): string[] {
  const lines: string[] = [`${side} eye:`];
  if (acuityId) lines.push(`  Acuity ${acuityLabel(acuityId)}: ${pct(eye.acuityPercent)}`);
  if (fieldId)  lines.push(`  Field ${fieldLabel(fieldId)}: ${pct(eye.fieldPercent)}`);
  for (const m of modIds)  lines.push(`  ${modifierLabel(m)}: included`);
  for (const c of condIds) lines.push(`  ${conditionLabel(c)}: included`);
  if (eye.modifiersPercent > 0)  lines.push(`  Modifiers total: +${pct(eye.modifiersPercent)}`);
  if (eye.conditionsPercent > 0) lines.push(`  Conditions total: +${pct(eye.conditionsPercent)}`);
  lines.push(`  Raw total: ${pct(eye.rawTotal)} → Capped: ${pct(eye.cappedTotal)}`);
  return lines;
}

export function renderVisualResult(
  toolResult: unknown,
  systemState: V2SystemState,
): AssessmentRenderResult {
  const result = toolResult as VisualResult;
  const ef = systemState.extractedFacts;
  const autoExpand = shouldAutoExpand(result);

  const dipId = ef[VISUAL_FK_DIPLOPIA]?.value as string ?? "";

  // ── Summary lines ──────────────────────────────────────────────────────────
  const summaryLines: string[] = [
    `System-generated GATIOD PI%: ${pct(result.finalPercent)}`,
    ``,
    `Visual Assessment:`,
    eyeSummaryLine("Right", result.rightEye),
    eyeSummaryLine("Left",  result.leftEye),
  ];

  if (result.legalBlindness) {
    summaryLines.push(`Legal blindness (both eyes < 6/60) → 100% PI`);
  } else {
    summaryLines.push(`Binocular subtotal: ${pct(result.binocularSubtotal)}`);
    if (result.diplopiaPercent > 0) {
      summaryLines.push(`Diplopia (${diplopiaLabel(dipId)}): +${pct(result.diplopiaPercent)}`);
    }
  }

  summaryLines.push(``, `Final PI%: ${pct(result.finalPercent)}`);

  // ── Auto-expanded breakdown ────────────────────────────────────────────────
  const expandedLines: string[] = [];
  if (autoExpand) {
    expandedLines.push(``, `**Calculation breakdown:**`);

    const rAcuity = ef[VISUAL_FK_RIGHT_ACUITY]?.value as string ?? "";
    const lAcuity = ef[VISUAL_FK_LEFT_ACUITY]?.value  as string ?? "";
    const rField  = ef[VISUAL_FK_RIGHT_FIELD]?.value  as string ?? "";
    const lField  = ef[VISUAL_FK_LEFT_FIELD]?.value   as string ?? "";
    const rMods   = ef[VISUAL_FK_RIGHT_MODIFIERS]?.value as string[] ?? [];
    const lMods   = ef[VISUAL_FK_LEFT_MODIFIERS]?.value  as string[] ?? [];
    const rConds  = ef[VISUAL_FK_RIGHT_CONDITIONS]?.value as string[] ?? [];
    const lConds  = ef[VISUAL_FK_LEFT_CONDITIONS]?.value  as string[] ?? [];

    expandedLines.push(...eyeBreakdownLines("Right", result.rightEye, rAcuity, rField, rMods, rConds));
    expandedLines.push(...eyeBreakdownLines("Left",  result.leftEye,  lAcuity, lField, lMods, lConds));

    if (result.diplopiaPercent > 0) {
      expandedLines.push(`Diplopia (${diplopiaLabel(dipId)}): ${pct(result.diplopiaPercent)}`);
    }

    if (result.legalBlindness) {
      expandedLines.push(`Legal blindness → 100%`);
    } else {
      expandedLines.push(
        `Binocular [${pct(result.rightEye.cappedTotal)} + ${pct(result.leftEye.cappedTotal)}] + diplopia ${pct(result.diplopiaPercent)} → ${pct(result.finalPercent)}`,
      );
    }
  }

  const message = [...summaryLines, ...expandedLines].join("\n").replace(/\n{3,}/g, "\n\n");

  // ── Full breakdown ─────────────────────────────────────────────────────────
  const inputFacts: string[] = [];
  for (const [k, fact] of Object.entries(ef)) {
    if (fact) inputFacts.push(`${factKeyLabel("visual", k)}: ${factValueDisplay("visual", k, fact.value)}`);
  }

  const eyeNotes = (eye: EyeResult): string[] => [
    eye.acuityPercent > 0     ? `Acuity: ${pct(eye.acuityPercent)}`        : "",
    eye.fieldPercent > 0      ? `Field: ${pct(eye.fieldPercent)}`           : "",
    eye.modifiersPercent > 0  ? `Modifiers: +${pct(eye.modifiersPercent)}`  : "",
    eye.conditionsPercent > 0 ? `Conditions: +${pct(eye.conditionsPercent)}` : "",
    eye.rawTotal > eye.cappedTotal ? `Capped at 50% (raw: ${pct(eye.rawTotal)})` : "",
  ].filter(Boolean);

  const categoryResults: AssessmentRenderResult["fullBreakdown"]["categoryResults"] = [
    ...(result.rightEye.cappedTotal > 0 ? [{ label: "Right eye", rawPercent: result.rightEye.cappedTotal, notes: eyeNotes(result.rightEye) }] : []),
    ...(result.leftEye.cappedTotal  > 0 ? [{ label: "Left eye",  rawPercent: result.leftEye.cappedTotal,  notes: eyeNotes(result.leftEye)  }] : []),
    ...(result.diplopiaPercent      > 0 ? [{ label: "Diplopia",  rawPercent: result.diplopiaPercent,      notes: []                        }] : []),
  ];

  const rulesApplied: string[] = ["50% monocular cap per eye", "Additive binocular combination"];
  if (result.legalBlindness) rulesApplied.push("Legal blindness: both eyes < 6/60 → 100%");
  if (result.rightEye.rawTotal > result.rightEye.cappedTotal) rulesApplied.push("Right eye 50% cap applied");
  if (result.leftEye.rawTotal  > result.leftEye.cappedTotal)  rulesApplied.push("Left eye 50% cap applied");
  if (result.diplopiaPercent > 0) rulesApplied.push("Diplopia added to binocular total");
  if (result.finalPercent === 100) rulesApplied.push("100% total cap applied");

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "visual",
      finalPercent: result.finalPercent,
      categoryPercents: {
        rightEye: result.rightEye.cappedTotal,
        leftEye:  result.leftEye.cappedTotal,
        diplopia: result.diplopiaPercent,
      },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults,
      dbeRomConflicts: [],
      cvcInputs: [result.rightEye.cappedTotal, result.leftEye.cappedTotal].filter((v) => v > 0),
      cvcTrace: result.legalBlindness
        ? ["Legal blindness → 100%"]
        : [`${pct(result.rightEye.cappedTotal)} + ${pct(result.leftEye.cappedTotal)} + ${pct(result.diplopiaPercent)} → ${pct(result.finalPercent)}`],
      capsApplied: [
        ...(result.rightEye.rawTotal > result.rightEye.cappedTotal ? ["Right eye 50% cap"] : []),
        ...(result.leftEye.rawTotal  > result.leftEye.cappedTotal  ? ["Left eye 50% cap"]  : []),
        ...(result.finalPercent === 100 ? ["100% total cap"] : []),
      ],
      rulesApplied,
      finalPercent: result.finalPercent,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
