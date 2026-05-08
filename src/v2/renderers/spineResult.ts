import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { SpineAssessmentResult } from "../../engine/spineAssessmentData.js";
import { diagnosisCategories, getSeveritiesForCategory } from "../../engine/spineAssessmentData.js";
import { SP_FK_REGION, SP_FK_ENTRIES, type SpineCategoryEntryFact } from "../extractors/spine.js";

function pct(n: number): string { return `${n}%`; }

function categoryLabel(key: string): string {
  return diagnosisCategories.find((c) => c.key === key)?.label ?? key;
}

function severityLabel(diagnosisCategory: string, severityKey: string, pathway?: string): string {
  const opts = getSeveritiesForCategory(
    diagnosisCategory as import("../../engine/spineAssessmentData.js").DiagnosisCategory,
    { spondylolysisPathway: (pathway ?? "acute_traumatic") as import("../../engine/spineAssessmentData.js").SpondylolysisPathway }
  );
  return opts.find((o) => o.key === severityKey)?.label ?? severityKey;
}

function shouldAutoExpand(result: SpineAssessmentResult): boolean {
  if (result.firstScheduleFlag) return true;
  if (result.evaluatedEntries.length > 1) return true;
  const winner = result.evaluatedEntries[result.winnerIndex];
  if (winner?.bladderBowelAddOn > 0) return true;
  if (winner?.isMonoparesis) return true;
  return false;
}

export function renderSpineResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result = toolResult as SpineAssessmentResult;
  const regionRaw = systemState.extractedFacts[SP_FK_REGION]?.value as string | undefined;
  const regionLabel = regionRaw
    ? { cervical: "Cervical", thoraco_lumbar: "Thoraco-Lumbar", lumbo_sacral: "Lumbo-Sacral" }[regionRaw] ?? regionRaw
    : "";

  const autoExpand = shouldAutoExpand(result);
  const winner = result.evaluatedEntries[result.winnerIndex];
  const entries = (systemState.extractedFacts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];

  // ── Summary lines ──────────────────────────────────────────────────────────
  const entryLines = result.evaluatedEntries.map((e, idx) => {
    const catLabel = categoryLabel(e.diagnosisCategory as string);
    const sevLabel = severityLabel(
      e.diagnosisCategory as string,
      e.severity as string,
      e.spondylolysisPathway
    );
    const suppNote = e.suppressed ? " (suppressed)" : "";
    const winNote = idx === result.winnerIndex ? " ← winner" : "";
    return `- ${catLabel}: ${sevLabel} → ${pct(e.computedPercent)}${suppNote}${winNote}`;
  });

  const summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.finalPercent)}`,
    ``,
    `Spine${regionLabel ? ` — ${regionLabel}` : ""}:`,
    ...entryLines,
    ``,
    `Final PI%: ${pct(result.finalPercent)}`,
    ...(result.firstScheduleFlag ? [`⚠ First Schedule applies (100% PI).`] : []),
  ];

  // ── Auto-expanded breakdown ────────────────────────────────────────────────
  const expandedLines: string[] = [];
  if (autoExpand && winner) {
    expandedLines.push(``, `**Calculation breakdown (winning entry):**`);
    expandedLines.push(`Base PI%: ${pct(winner.basePercent)}`);
    if (winner.isMonoparesis) {
      expandedLines.push(`Monoparesis halving applied: ${pct(winner.basePercent)} → ${pct(winner.adjustedPercent)}`);
    }
    if (winner.bladderBowelAddOn > 0) {
      expandedLines.push(`Bladder/bowel add-on: +${pct(winner.bladderBowelAddOn)} → ${pct(winner.preCapPercent)}`);
    }
    if (winner.preCapPercent > 100) {
      expandedLines.push(`Capped at 100%`);
    }
  }

  const message = [...summaryLines, ...expandedLines]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  // ── Full breakdown ─────────────────────────────────────────────────────────
  const categoryResults = result.evaluatedEntries.map((e) => ({
    label: categoryLabel(e.diagnosisCategory as string),
    rawPercent: e.computedPercent,
    notes: [
      ...(e.suppressed ? [`Suppressed: ${e.suppressionReason ?? "winner override"}`] : []),
      ...(e.isMonoparesis ? ["Monoparesis halving applied"] : []),
      ...(e.bladderBowelAddOn > 0 ? [`Bladder/bowel add-on: +${pct(e.bladderBowelAddOn)}`] : []),
    ],
  }));

  const inputFacts: string[] = [];
  for (const [key, fact] of Object.entries(systemState.extractedFacts)) {
    if (fact) inputFacts.push(`${key}: ${JSON.stringify(fact.value)}`);
  }

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "spine",
      finalPercent: result.finalPercent,
      categoryPercents: Object.fromEntries(
        result.evaluatedEntries.map((e, i) => [
          `${e.diagnosisCategory}_${i}`,
          e.computedPercent,
        ])
      ),
    },
    fullBreakdown: {
      inputFacts,
      categoryResults,
      dbeRomConflicts: [],
      cvcInputs: [],
      cvcTrace: [],
      capsApplied: result.firstScheduleFlag ? ["100% First Schedule cap"] : [],
      rulesApplied: [
        ...(winner?.isMonoparesis ? ["Monoparesis halving (÷2)"] : []),
        ...(winner?.bladderBowelAddOn ? [`Bladder/bowel add-on (+${winner.bladderBowelAddOn}%)`] : []),
      ],
      finalPercent: result.finalPercent,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
