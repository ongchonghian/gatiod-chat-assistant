import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { HearingResult, NidResult, InjuryResult } from "../../engine/hearingData.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_TINNITUS,
} from "../extractors/hearing.js";

function pct(n: number): string { return `${n}%`; }
function isNidResult(r: HearingResult): r is NidResult {
  return "betterEar" in r;
}

export function renderHearingResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result    = toolResult as HearingResult;
  const ef        = systemState.extractedFacts;
  const path      = ef[HEARING_FK_PATH]?.value as string | undefined;
  const hasTinnitus = Boolean(ef[HEARING_FK_TINNITUS]?.value);
  const autoExpand = hasTinnitus || (isNidResult(result) && result.presbycusisDeduction > 0);

  let summaryLines: string[];
  let finalPercent: number;

  if (isNidResult(result)) {
    finalPercent = result.finalPercent;
    const leftAhl  = ef[HEARING_FK_LEFT_EAR_AHL]?.value as number | undefined;
    const rightAhl = ef[HEARING_FK_RIGHT_EAR_AHL]?.value as number | undefined;
    const age      = ef[HEARING_FK_AGE]?.value as number | undefined;

    summaryLines = [
      `System-generated GATIOD PI%: ${pct(result.finalPercent)}`,
      ``,
      `Hearing — Noise-Induced Deafness:`,
      ...(leftAhl  !== undefined ? [`- Left ear AHL: ${leftAhl} dB`]  : []),
      ...(rightAhl !== undefined ? [`- Right ear AHL: ${rightAhl} dB`] : []),
      `- Better ear: ${result.betterEar} (${result.betterEarAhl} dB)`,
      ...(age !== undefined ? [`- Age: ${age}`] : []),
      ``,
      `Base PI%: ${pct(result.basePercent)}`,
      ...(result.presbycusisDeduction > 0 ? [`Presbycusis deduction: −${result.presbycusisDeduction}%`] : []),
      `Final PI%: ${pct(result.finalPercent)}`,
      ...(result.isEarlyNid ? [`Note: Better-ear AHL < 50 dB — early NID, PI = 0%.`] : []),
      ...(hasTinnitus ? [`\nNote: Tinnitus noted. Tinnitus award is assessed separately; it does not affect this PI%.`] : []),
    ];
  } else {
    const inj = result as InjuryResult;
    finalPercent = inj.finalPercent;
    summaryLines = [
      `System-generated GATIOD PI%: ${pct(inj.finalPercent)}`,
      ``,
      `Hearing — Injury/Accident:`,
      ...(inj.leftPercent  > 0 ? [`- Left ear: ${pct(inj.leftPercent)}`]  : []),
      ...(inj.rightPercent > 0 ? [`- Right ear: ${pct(inj.rightPercent)}`] : []),
      ``,
      `Final PI%: ${pct(inj.finalPercent)}`,
      ...(hasTinnitus ? [`\nNote: Tinnitus noted. Tinnitus award assessed separately.`] : []),
    ];
  }

  const expandedLines: string[] = [];
  if (isNidResult(result) && result.presbycusisDeduction > 0) {
    expandedLines.push(
      ``,
      `**Presbycusis deduction:** ${result.presbycusisDeduction}% (0.5% per year above age 50, age ${ef[HEARING_FK_AGE]?.value})`,
    );
  }

  const message = [...summaryLines, ...expandedLines].join("\n").replace(/\n{3,}/g, "\n\n");

  const inputFacts: string[] = [];
  for (const [k, fact] of Object.entries(ef)) {
    if (fact) inputFacts.push(`${k}: ${JSON.stringify(fact.value)}`);
  }

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "hearing",
      finalPercent,
      categoryPercents: { hearing: finalPercent },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults: [{
        label: path === "nid" ? "Noise-Induced Deafness" : "Injury/Accident",
        rawPercent: finalPercent,
        notes: [
          ...(isNidResult(result) && result.presbycusisDeduction > 0
            ? [`Presbycusis deduction: −${result.presbycusisDeduction}%`]
            : []),
          ...(hasTinnitus ? ["Tinnitus noted (separate award)"] : []),
        ],
      }],
      dbeRomConflicts: [],
      cvcInputs: [],
      cvcTrace: [],
      capsApplied: [],
      rulesApplied: [
        ...(isNidResult(result) ? ["Better-ear rule", "Presbycusis deduction 0.5%/yr > 50"] : ["Injury path"]),
      ],
      finalPercent,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
