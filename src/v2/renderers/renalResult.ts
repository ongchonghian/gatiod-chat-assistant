import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { RenalResult } from "../../engine/renalData.js";
import { CLINICAL_SEVERITY_LABELS, CKD_STAGE_LABELS } from "../../engine/renalData.js";
import {
  RENAL_FK_SEX,
  RENAL_FK_SERUM_CREATININE,
  RENAL_FK_CREATININE_CLEARANCE,
  RENAL_FK_CKD_STAGE,
  RENAL_FK_CLINICAL_SEVERITY,
} from "../extractors/renal.js";

function pct(n: number): string { return `${n}%`; }

function shouldAutoExpand(result: RenalResult): boolean {
  if (result.isSolitaryKidneyBase) return true;
  if (result.hardCapApplied)       return true;
  // Multiple classifying inputs present and they disagree on class → explain
  const classes = [result.serumCreatinineClass, result.creatinineClearanceClass, result.ckdClass, result.clinicalClass];
  const uniqueNonZero = new Set(classes.filter((c) => c > 0));
  if (uniqueNonZero.size > 1) return true;
  return false;
}

export function renderRenalResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result  = toolResult as RenalResult;
  const ef      = systemState.extractedFacts;
  const autoExpand = shouldAutoExpand(result);

  // ── Input lines ────────────────────────────────────────────────────────────
  const inputLines: string[] = [];
  if (ef[RENAL_FK_SERUM_CREATININE]) {
    inputLines.push(`- Serum creatinine: ${ef[RENAL_FK_SERUM_CREATININE].value} µmol/L → Class ${result.serumCreatinineClass}`);
  }
  if (ef[RENAL_FK_CREATININE_CLEARANCE]) {
    inputLines.push(`- Creatinine clearance: ${ef[RENAL_FK_CREATININE_CLEARANCE].value} mL/min → Class ${result.creatinineClearanceClass}`);
  }
  if (ef[RENAL_FK_CKD_STAGE]) {
    const stage = ef[RENAL_FK_CKD_STAGE].value as number;
    inputLines.push(`- ${CKD_STAGE_LABELS[stage as keyof typeof CKD_STAGE_LABELS] ?? `Stage ${stage}`} → Class ${result.ckdClass}`);
  }
  if (ef[RENAL_FK_CLINICAL_SEVERITY]) {
    const sev = ef[RENAL_FK_CLINICAL_SEVERITY].value as string;
    inputLines.push(`- Clinical: ${CLINICAL_SEVERITY_LABELS[sev as keyof typeof CLINICAL_SEVERITY_LABELS] ?? sev} → Class ${result.clinicalClass}`);
  }

  const sexLabel = ef[RENAL_FK_SEX]?.value === "female" ? "Female" : "Male";
  const provNote = result.isProvisional ? " (provisional)" : "";

  const summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.finalPi)}${provNote}`,
    ``,
    `Renal — ${sexLabel}:`,
    ...(inputLines.length > 0 ? inputLines : ["- No classifying input provided"]),
    ``,
    `Highest class: ${result.severityLabel} (${result.piRangeMin === result.piRangeMax ? pct(result.piRangeMin) : `${result.piRangeMin}–${result.piRangeMax}%`})`,
    `Recommended PI%: ${pct(result.recommendedPi)}`,
    `Final PI%: ${pct(result.finalPi)}${provNote}`,
  ];

  // ── Auto-expanded breakdown ────────────────────────────────────────────────
  const expandedLines: string[] = [];
  if (autoExpand) {
    expandedLines.push(``, `**Calculation notes:**`);
    if (result.isSolitaryKidneyBase) {
      expandedLines.push(
        `Solitary kidney: +${pct(result.solitaryKidneyPi)} combined via CVC with base ${pct(result.baseSelectedPi)} → ${pct(result.finalPi)}`,
      );
    }
    if (result.selectionAdjustedFrom !== null) {
      expandedLines.push(`PI% adjusted from ${result.selectionAdjustedFrom}% to ${pct(result.selectedPi)}: ${result.selectionAdjustmentReason}`);
    }
  }

  const message = [...summaryLines, ...expandedLines].join("\n").replace(/\n{3,}/g, "\n\n");

  // ── Full breakdown ─────────────────────────────────────────────────────────
  const inputFacts: string[] = [];
  for (const [k, fact] of Object.entries(ef)) {
    if (fact) inputFacts.push(`${k}: ${JSON.stringify(fact.value)}`);
  }

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "renal",
      finalPercent: result.finalPi,
      categoryPercents: { renal: result.finalPi },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults: [{
        label: result.severityLabel,
        rawPercent: result.finalPi,
        notes: [
          ...(result.isSolitaryKidneyBase ? [`Solitary kidney +${pct(result.solitaryKidneyPi)} (CVC)`] : []),
          ...(result.isProvisional ? ["Provisional award"] : []),
        ],
      }],
      dbeRomConflicts: [],
      cvcInputs: result.isSolitaryKidneyBase ? [result.baseSelectedPi, result.solitaryKidneyPi] : [],
      cvcTrace: result.isSolitaryKidneyBase
        ? [`${pct(result.baseSelectedPi)} + ${pct(result.solitaryKidneyPi)} (solitary) = ${pct(result.finalPi)}`]
        : [],
      capsApplied: result.hardCapApplied ? ["Hard cap at 100%"] : [],
      rulesApplied: [
        ...(result.isSolitaryKidneyBase ? ["Solitary kidney 10% CVC modifier"] : []),
        "Highest-class-override rule",
      ],
      finalPercent: result.finalPi,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
