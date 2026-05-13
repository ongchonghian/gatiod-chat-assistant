import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { GastroDigestiveResult } from "../../engine/gastroDigestiveData.js";
import { GASTRO_FK_SUBSYSTEM, GASTRO_FK_BRACKET_INDEX, GASTRO_FK_PI_PERCENT } from "../extractors/gastro.js";
import { factKeyLabel, factValueDisplay } from "../clinicalLabels.js";

function pct(n: number | null): string { return n !== null ? `${n}%` : "—"; }

export function renderGastroResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result    = toolResult as GastroDigestiveResult;
  const ef        = systemState.extractedFacts;
  const subsystem = ef[GASTRO_FK_SUBSYSTEM]?.value as string | undefined;
  const bracket   = result.bracket;
  const isOutOfRange = result.isOutOfRange;
  const autoExpand = isOutOfRange || (result.weightLossAutoClass !== undefined && result.weightLossAutoClass > 0);

  const summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.piPercent)}`,
    ``,
    `Gastro-digestive — ${result.subSystemLabel || subsystem || "unknown"}:`,
    bracket
      ? `- Severity class: ${bracket.label} (${bracket.min}–${bracket.max}%)`
      : "- No bracket selected",
    `- Assigned PI%: ${pct(result.piPercent)}`,
    ...(isOutOfRange ? [`⚠ Warning: assigned PI% is outside the selected bracket range.`] : []),
    ...(result.weightLossAutoClass !== undefined && result.weightLossAutoClass > 0
      ? [`Note: weight loss suggests ${["Class I", "Class II", "Class III", "Class IV"][result.weightLossAutoClass] ?? "Class " + result.weightLossAutoClass}.`]
      : []),
    ``,
    `Final PI%: ${pct(result.piPercent)}`,
  ];

  const inputFacts: string[] = [];
  for (const [k, fact] of Object.entries(ef)) {
    if (fact) inputFacts.push(`${factKeyLabel("gastro_digestive", k)}: ${factValueDisplay("gastro_digestive", k, fact.value)}`);
  }

  const message = summaryLines.join("\n").replace(/\n{3,}/g, "\n\n");

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "gastro_digestive",
      finalPercent: result.piPercent ?? 0,
      categoryPercents: { gastro: result.piPercent ?? 0 },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults: [{
        label: result.subSystemLabel || "Gastro",
        rawPercent: result.piPercent ?? 0,
        notes: [
          ...(isOutOfRange ? ["PI% outside selected bracket range"] : []),
          ...(result.weightLossAutoClass !== undefined ? [`Weight loss auto-class: ${result.weightLossAutoClass}`] : []),
        ],
      }],
      dbeRomConflicts: [],
      cvcInputs: [],
      cvcTrace: [],
      capsApplied: [],
      rulesApplied: ["Doctor-assigned bracket and PI%"],
      finalPercent: result.piPercent ?? 0,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
