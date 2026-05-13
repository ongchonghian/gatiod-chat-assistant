import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { LowerLimbResult } from "../../engine/lowerLimbData.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function pct(n: number): string { return `${n}%`; }

function shouldAutoExpand(result: LowerLimbResult): boolean {
  if (result.dbeRomConflicts.length > 0) return true;
  if (result.shortening.rawPercent > 0 && result.amputation.rawPercent > 0) return true;
  if (result.amputation.rawPercent > 0 && (result.rom.rawPercent > 0 || result.dbe.rawPercent > 0)) return true;
  const nonZeroStreams = [
    result.amputation.rawPercent,
    result.rom.rawPercent,
    result.neurological.rawPercent,
    result.shortening.rawPercent,
    result.dbe.rawPercent,
  ].filter((v) => v > 0);
  if (nonZeroStreams.length > 1) return true;
  return false;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderLowerLimbResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result = toolResult as LowerLimbResult;
  const side = (systemState.extractedFacts["side"]?.value as "left" | "right" | undefined) ?? "unknown";
  const sideLabel = side === "unknown" ? "" : ` — ${side}`;

  const autoExpand = shouldAutoExpand(result);

  const ampPct = result.amputation.rawPercent;
  const romPct = result.rom.rawPercent;
  const neuroPct = result.neurological.rawPercent;
  const shorteningPct = result.shortening.rawPercent;
  const dbePct = result.dbe.rawPercent;

  const streamLines: string[] = [];
  if (ampPct > 0) streamLines.push(`- Amputation stream: ${pct(ampPct)}`);
  if (romPct > 0) streamLines.push(`- ROM stream: ${pct(romPct)}`);
  if (neuroPct > 0) streamLines.push(`- Neurological stream: ${pct(neuroPct)}`);
  if (shorteningPct > 0) streamLines.push(`- Shortening stream: ${pct(shorteningPct)}`);
  if (dbePct > 0) streamLines.push(`- DBE stream: ${pct(dbePct)}`);

  const summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.finalPercent)}`,
    ``,
    `Lower limb${sideLabel}:`,
    ...streamLines,
    ``,
    `Final PI%: ${pct(result.finalPercent)}`,
  ];

  const expandedLines: string[] = [];
  if (autoExpand) {
    expandedLines.push(``, `**Calculation breakdown:**`);
    if (result.dbeRomConflicts.length > 0) {
      expandedLines.push(`DBE/ROM conflicts resolved:`);
      for (const c of result.dbeRomConflicts) {
        expandedLines.push(`  • ${c.joint}: ROM ${pct(c.romPercent)} vs DBE ${pct(c.dbePercent)} → ${c.winner} wins`);
      }
    }
    if (result.cvcInputs.length > 0) {
      expandedLines.push(`CVC inputs: ${result.cvcInputs.map(pct).join(", ")} → ${pct(result.finalPercent)}`);
    }
    if (result.amputation.notes.length > 0) {
      expandedLines.push(`Amputation notes: ${result.amputation.notes.join("; ")}`);
    }
    if (result.shortening.rawPercent > 0) {
      expandedLines.push(`Shortening: ${result.shortening.notes.join("; ")}`);
    }
  }

  const message = [...summaryLines, ...expandedLines]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  const categoryResults = [
    { label: "Amputation", rawPercent: ampPct, notes: result.amputation.notes },
    { label: "ROM restriction", rawPercent: romPct, notes: result.rom.notes },
    { label: "Neurological", rawPercent: neuroPct, notes: result.neurological.notes },
    { label: "Shortening", rawPercent: shorteningPct, notes: result.shortening.notes },
    { label: "DBE", rawPercent: dbePct, notes: result.dbe.notes },
  ];

  const inputFacts: string[] = [];
  for (const [key, fact] of Object.entries(systemState.extractedFacts)) {
    if (fact) inputFacts.push(`${key}: ${JSON.stringify(fact.value)}`);
  }

  return {
    message,
    suggestedChips: ["View full calculation breakdown", "Calculate combined value (CVC)"],
    resultSummary: {
      system: "lower_limb",
      side: side === "unknown" ? undefined : side,
      finalPercent: result.finalPercent,
      categoryPercents: {
        amputation: ampPct,
        rom: romPct,
        neurological: neuroPct,
        shortening: shorteningPct,
        dbe: dbePct,
      },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults,
      dbeRomConflicts: result.dbeRomConflicts,
      cvcInputs: result.cvcInputs,
      cvcTrace: result.cvcInputs.length > 0
        ? [`CVC(${result.cvcInputs.map(pct).join(", ")}) = ${pct(result.finalPercent)}`]
        : [],
      capsApplied: [],
      rulesApplied: [],
      finalPercent: result.finalPercent,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
