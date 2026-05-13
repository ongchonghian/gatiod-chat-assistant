import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { RespiratoryResult, RespiratoryMetricKey } from "../../engine/respiratoryData.js";
import { DIAGNOSIS_LABELS, DYSPNOEA_LABELS, ASTHMA_MEDICATION_LABELS } from "../../engine/respiratoryData.js";
import { RESP_FK_DIAGNOSIS, RESP_FK_DYSPNOEA, RESP_FK_ASTHMA_MED } from "../extractors/respiratory.js";
import { factKeyLabel, factValueDisplay } from "../clinicalLabels.js";

function pct(n: number): string { return `${n}%`; }

const METRIC_LABELS: Record<RespiratoryMetricKey, string> = {
  fvc:    "FVC",
  fev1:   "FEV1",
  dlco:   "DLCO",
  vo2Max: "VO2 Max",
};

const METRIC_UNITS: Record<RespiratoryMetricKey, string> = {
  fvc:    "% predicted",
  fev1:   "% predicted",
  dlco:   "% predicted",
  vo2Max: "mL/kg/min",
};

function shouldAutoExpand(result: RespiratoryResult): boolean {
  if (result.firstScheduleFlag)  return true;
  if (result.isAsthmaOverride)   return true;
  if (result.isAsbestosisFloor)  return true;
  if (result.hardCapApplied)     return true;
  return false;
}

export function renderRespiratoryResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result   = toolResult as RespiratoryResult;
  const ef       = systemState.extractedFacts;
  const diagnosis = (ef[RESP_FK_DIAGNOSIS]?.value ?? "standard") as string;
  const autoExpand = shouldAutoExpand(result);

  // ── Summary lines ──────────────────────────────────────────────────────────
  const testLines: string[] = [];
  for (const key of (["fvc", "fev1", "dlco", "vo2Max"] as RespiratoryMetricKey[])) {
    const tc = result.testClassifications[key];
    if (tc.value !== null) {
      testLines.push(
        `- ${METRIC_LABELS[key]}: ${tc.value} ${METRIC_UNITS[key]} → ${tc.classLabel}${tc.matchedClassDefinition ? "" : " (boundary)"}`,
      );
    }
  }

  const diagLabel = DIAGNOSIS_LABELS[diagnosis as keyof typeof DIAGNOSIS_LABELS] ?? diagnosis;

  const summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.selectedPi)}`,
    ``,
    `Respiratory — ${diagLabel}:`,
    ...(testLines.length > 0 ? testLines : ["- No PFT values provided"]),
    ``,
    `Severity: ${result.severityLabel} (${result.piRangeMin === result.piRangeMax ? pct(result.piRangeMin) : `${result.piRangeMin}–${result.piRangeMax}%`})`,
    `Recommended PI%: ${pct(result.recommendedPi)}`,
    `Final PI%: ${pct(result.selectedPi)}`,
    ...(result.firstScheduleFlag ? [`⚠ First Schedule applies (100% PI).`] : []),
  ];

  // ── Auto-expanded breakdown ────────────────────────────────────────────────
  const expandedLines: string[] = [];
  if (autoExpand) {
    expandedLines.push(``, `**Calculation notes:**`);
    if (result.isAsthmaOverride) {
      const medKey = ef[RESP_FK_ASTHMA_MED]?.value as string | undefined;
      const medLabel = medKey ? (ASTHMA_MEDICATION_LABELS[medKey as keyof typeof ASTHMA_MEDICATION_LABELS] ?? medKey) : "unknown";
      expandedLines.push(`Occupational asthma override active — medication: ${medLabel} → ${pct(result.piRangeMin)} (fixed PI)`);
    }
    if (result.isAsbestosisFloor) {
      expandedLines.push(`Asbestosis/silicosis 10% minimum floor applied (PFT class ≤ No Impairment).`);
    }
    if (result.suppressionReason) {
      expandedLines.push(`Note: ${result.suppressionReason}`);
    }
    if (result.selectionAdjustedFrom !== null) {
      expandedLines.push(`PI% adjusted from ${result.selectionAdjustedFrom}% to ${pct(result.selectedPi)}: ${result.selectionAdjustmentReason}`);
    }
  }

  const dyspLabel = ef[RESP_FK_DYSPNOEA]
    ? DYSPNOEA_LABELS[ef[RESP_FK_DYSPNOEA].value as keyof typeof DYSPNOEA_LABELS] ?? ef[RESP_FK_DYSPNOEA].value
    : null;

  const message = [
    ...summaryLines,
    ...(dyspLabel ? [``, `Dyspnoea: ${dyspLabel}`] : []),
    ...expandedLines,
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  // ── Full breakdown ─────────────────────────────────────────────────────────
  const categoryResults = [
    {
      label: result.severityLabel,
      rawPercent: result.selectedPi,
      notes: [
        ...(result.isAsthmaOverride  ? ["Occupational asthma medication override"] : []),
        ...(result.isAsbestosisFloor ? ["Asbestosis/silicosis 10% floor"] : []),
      ],
    },
  ];

  const inputFacts: string[] = [];
  for (const [k, fact] of Object.entries(ef)) {
    if (fact) inputFacts.push(`${factKeyLabel("respiratory", k)}: ${factValueDisplay("respiratory", k, fact.value)}`);
  }

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "respiratory",
      finalPercent: result.selectedPi,
      categoryPercents: { respiratory: result.selectedPi },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults,
      dbeRomConflicts: [],
      cvcInputs: [],
      cvcTrace: [],
      capsApplied: [
        ...(result.firstScheduleFlag ? ["100% First Schedule cap"] : []),
        ...(result.hardCapApplied && !result.firstScheduleFlag ? ["Hard cap at 100%"] : []),
      ],
      rulesApplied: [
        ...(result.isAsthmaOverride  ? ["Occupational asthma medication override"] : []),
        ...(result.isAsbestosisFloor ? ["Asbestosis/silicosis minimum 10% floor"] : []),
      ],
      finalPercent: result.selectedPi,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
