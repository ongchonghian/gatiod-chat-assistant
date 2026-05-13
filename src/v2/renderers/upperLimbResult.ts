import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { UpperLimbResult } from "../../engine/upperLimbData.js";
import { factKeyLabel, factValueDisplay } from "../clinicalLabels.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function pct(n: number): string { return `${n}%`; }

function shouldAutoExpand(result: UpperLimbResult): boolean {
  if (result.dbeRomConflicts.length > 0) return true;
  if (result.amputation.rawPercent > 0 && (result.rom.rawPercent > 0 || result.dbe.rawPercent > 0)) return true;
  const nonZeroStreams = [
    result.amputation.rawPercent,
    result.rom.rawPercent,
    result.neurological.rawPercent,
    result.dbe.rawPercent,
  ].filter((v) => v > 0);
  if (nonZeroStreams.length > 1) return true;
  return false;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderUpperLimbResult(
  toolResult: unknown,
  systemState: V2SystemState
): AssessmentRenderResult {
  const result = toolResult as UpperLimbResult;
  const side = (systemState.extractedFacts["side"]?.value as "left" | "right" | undefined) ?? "unknown";
  const sideLabel = side === "unknown" ? "" : ` — ${side}`;

  const autoExpand = shouldAutoExpand(result);

  // ── Summary message (default) ─────────────────────────────────────────────
  const ampPct = result.amputation.rawPercent;
  const romPct = result.rom.rawPercent;
  const neuroPct = result.neurological.rawPercent;
  const dbePct = result.dbe.rawPercent;

  const streamLines: string[] = [];
  if (ampPct > 0) streamLines.push(`- Amputation stream: ${pct(ampPct)}`);
  if (romPct > 0) streamLines.push(`- ROM stream: ${pct(romPct)}`);
  if (neuroPct > 0) streamLines.push(`- Neurological stream: ${pct(neuroPct)}`);
  if (dbePct > 0) streamLines.push(`- DBE stream: ${pct(dbePct)}`);

  const zeroStreams: string[] = [];
  if (ampPct === 0) zeroStreams.push("amputation");
  if (romPct === 0) zeroStreams.push("nerve deficit");
  if (neuroPct === 0 && romPct === 0) { /* already captured */ }
  if (dbePct === 0) zeroStreams.push("DBE");

  const includedZeroLine =
    zeroStreams.length > 0
      ? `- No ${zeroStreams.join(", or ")} included.`
      : "";

  let summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.finalPercent)}`,
    ``,
    `Upper limb${sideLabel}:`,
    ...streamLines,
    includedZeroLine,
    ``,
    `Final PI%: ${pct(result.finalPercent)}`,
  ].filter((l) => l !== "- ");

  // ── Auto-expanded inline breakdown ────────────────────────────────────────
  let expandedLines: string[] = [];
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
  }

  const message = [...summaryLines, ...expandedLines]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  // ── Full breakdown (always in API response) ───────────────────────────────
  const categoryResults = [
    { label: "Amputation", rawPercent: result.amputation.rawPercent, notes: result.amputation.notes },
    { label: "ROM restriction", rawPercent: result.rom.rawPercent, notes: result.rom.notes },
    { label: "Neurological", rawPercent: result.neurological.rawPercent, notes: result.neurological.notes },
    { label: "DBE", rawPercent: result.dbe.rawPercent, notes: result.dbe.notes },
  ];

  const inputFacts: string[] = [];
  for (const [key, fact] of Object.entries(systemState.extractedFacts)) {
    if (fact) inputFacts.push(`${factKeyLabel("upper_limb", key)}: ${factValueDisplay("upper_limb", key, fact.value)}`);
  }

  return {
    message,
    suggestedChips: ["View full calculation breakdown", "Calculate combined value (CVC)"],
    resultSummary: {
      system: "upper_limb",
      side: side === "unknown" ? undefined : side,
      finalPercent: result.finalPercent,
      categoryPercents: {
        amputation: ampPct,
        rom: romPct,
        neurological: neuroPct,
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
