import type { AssessmentRenderResult, V2SystemState } from "../contracts.js";
import type { CnsResult } from "../../engine/cnsAssessmentData.js";
import { factKeyLabel, factValueDisplay } from "../clinicalLabels.js";
import {
  CNS_FK_G1A, CNS_FK_G1B, CNS_FK_G1C,
  CNS_FK_G2, CNS_FK_G3, CNS_FK_G4,
  CNS_FK_B_OLFACTION, CNS_FK_B_FACIAL,
  CNS_FK_B_EQUILIBRIUM, CNS_FK_B_SWALLOWING,
  CNS_FK_B_STATION_GAIT, CNS_FK_B_RESPIRATION,
  CNS_FK_C_LIMBS,
} from "../extractors/cns.js";

function pct(n: number): string { return `${n}%`; }

// Labels for Section A group bracket keys
const G1A_LABELS: Record<string, string> = {
  c_none: "No impairment", c_brief_minimal: "Brief/Persistent — Minimal ADL limit",
  c_brief_moderate: "Brief/Persistent — Moderate ADL limit",
  c_prolonged: "Prolonged consciousness impairment", c_coma: "Coma/Semi-coma",
};
const G1B_LABELS: Record<string, string> = {
  e_none: "No impairment", e_predictable: "Paroxysmal with risk/limitation",
  e_interferes: "Interferes with some daily activities",
  e_severe_supervised: "Severe — supervised/restricted", e_uncontrolled: "Uncontrolled",
};
const G1C_LABELS: Record<string, string> = {
  a_none: "No impairment", a_reduced_most: "Reduced alertness, most ADL preserved",
  a_reduced_some: "Reduced alertness, some ADL limited",
  a_significant_limit: "Significantly limited ADL", a_unable_selfcare: "Unable to care for self",
};
const G2_LABELS: Record<string, string> = {
  ms_none: "No impairment", ms_slight: "Slight forgetfulness", ms_moderate: "Moderate memory/integrative deficit",
  ms_severe: "Severe deficit", ms_fragment_only: "Fragments only",
};
const G3_LABELS: Record<string, string> = {
  co_none: "No impairment", co_minimal: "Minimal language disturbance",
  co_moderate: "Moderate language impairment", co_severe_or_complete: "Unintelligible/complete inability",
};
const G4_LABELS: Record<string, string> = {
  em_none: "No impairment", em_mild: "Mild ADL/social limitation",
  em_moderate: "Moderate ADL/social limitation", em_severe: "Severe/total dependence",
};

function shouldAutoExpand(result: CnsResult): boolean {
  if (result.sectionATieGroups.length > 1) return true;
  if (result.sectionBValues.length > 1) return true;
  if (result.sectionCValues.length > 0) return true;
  if (result.firstScheduleBonus) return true;
  return false;
}

export function renderCnsResult(
  toolResult: unknown,
  systemState: V2SystemState,
): AssessmentRenderResult {
  const result = toolResult as CnsResult;
  const ef = systemState.extractedFacts;
  const autoExpand = shouldAutoExpand(result);

  // ── Section A summary ──────────────────────────────────────────────────────
  const sectionALines: string[] = [];
  if (result.sectionAHighest > 0) {
    sectionALines.push(`Section A — ${result.sectionAHighestGroup}: ${pct(result.sectionAHighest)}`);
    if (result.sectionATieGroups.length > 1) {
      sectionALines.push(`  (tied: ${result.sectionATieGroups.join(", ")})`);
    }
  }

  // ── Section B summary ──────────────────────────────────────────────────────
  const sectionBLines: string[] = [];
  if (result.sectionBValues.length > 0) {
    for (const { label, value } of result.sectionBValues) {
      sectionBLines.push(`- ${label}: ${pct(value)}`);
    }
    sectionBLines.push(`Section B combined (CVC): ${pct(result.sectionBCombined)}`);
  }

  // ── Section C summary ──────────────────────────────────────────────────────
  const sectionCLines: string[] = [];
  if (result.sectionCValues.length > 0) {
    for (const { label, value } of result.sectionCValues) {
      sectionCLines.push(`- ${label}: ${pct(value)}`);
    }
    sectionCLines.push(`Section C combined (CVC): ${pct(result.sectionCTotal)}`);
    if (result.firstScheduleBonus) {
      sectionCLines.push(`First Schedule applies (both upper limbs / both hands)`);
    }
  }

  const summaryLines = [
    `System-generated GATIOD PI%: ${pct(result.finalPercent)}`,
    ``,
    `CNS Assessment:`,
    ...(sectionALines.length > 0 ? sectionALines : []),
    ...(sectionBLines.length > 0 ? sectionBLines : []),
    ...(sectionCLines.length > 0 ? sectionCLines : []),
    ``,
    `Combined A+B (CVC): ${pct(result.combinedAB)}`,
    `Final PI%: ${pct(result.finalPercent)}`,
  ];

  // ── Auto-expanded breakdown ────────────────────────────────────────────────
  const expandedLines: string[] = [];
  if (autoExpand) {
    expandedLines.push(``, `**Calculation breakdown:**`);

    if (result.sectionAScores.some((s) => s.value > 0)) {
      expandedLines.push(`Section A scores:`);
      for (const { label, value, winner } of result.sectionAScores) {
        if (value > 0) {
          expandedLines.push(`  ${label}: ${pct(value)}${winner ? " ← highest" : ""}`);
        }
      }
    }

    if (result.sectionBValues.length > 1) {
      const bInputs = result.sectionBValues.map((b) => pct(b.value)).join(", ");
      expandedLines.push(`Section B CVC inputs: [${bInputs}] → ${pct(result.sectionBCombined)}`);
    }

    if (result.sectionCValues.length > 0) {
      const cInputs = result.sectionCValues.map((c) => pct(c.value)).join(", ");
      expandedLines.push(`Section C CVC inputs: [${cInputs}] → ${pct(result.sectionCTotal)}`);
      if (result.firstScheduleBonus) {
        expandedLines.push(`First Schedule: bilateral upper limb → 100% PI`);
      }
    }

    expandedLines.push(
      `Final CVC [Section A, B, C]: [${pct(result.sectionAHighest)}, ${pct(result.sectionBCombined)}, ${pct(result.sectionCTotal)}] → ${pct(result.finalPercent)}`,
    );
  }

  const message = [...summaryLines, ...expandedLines].join("\n").replace(/\n{3,}/g, "\n\n");

  // ── Full breakdown ─────────────────────────────────────────────────────────
  const inputFacts: string[] = [];
  for (const [k, fact] of Object.entries(ef)) {
    if (fact) inputFacts.push(`${factKeyLabel("cns", k)}: ${factValueDisplay("cns", k, fact.value)}`);
  }

  const categoryResults = [
    ...(result.sectionAHighest > 0 ? [{ label: `Section A: ${result.sectionAHighestGroup}`, rawPercent: result.sectionAHighest, notes: result.sectionATieGroups.length > 1 ? [`Tied with: ${result.sectionATieGroups.join(", ")}`] : [] }] : []),
    ...(result.sectionBCombined > 0 ? [{ label: "Section B (CVC combined)", rawPercent: result.sectionBCombined, notes: result.sectionBValues.map((b) => `${b.label}: ${pct(b.value)}`) }] : []),
    ...(result.sectionCTotal > 0 ? [{ label: "Section C (paralysed limbs)", rawPercent: result.sectionCTotal, notes: result.sectionCValues.map((c) => `${c.label}: ${pct(c.value)}`) }] : []),
  ];

  const cvcInputs = [result.sectionAHighest, result.sectionBCombined, result.sectionCTotal].filter((v) => v > 0);
  const cvcTrace = cvcInputs.length > 1
    ? [`CVC [${cvcInputs.map(pct).join(", ")}] → ${pct(result.finalPercent)}`]
    : [];

  return {
    message,
    suggestedChips: ["View full calculation breakdown"],
    resultSummary: {
      system: "cns",
      finalPercent: result.finalPercent,
      categoryPercents: {
        sectionA: result.sectionAHighest,
        sectionB: result.sectionBCombined,
        sectionC: result.sectionCTotal,
      },
    },
    fullBreakdown: {
      inputFacts,
      categoryResults,
      dbeRomConflicts: [],
      cvcInputs,
      cvcTrace,
      capsApplied: result.finalPercent === 100 ? ["100% cap applied"] : [],
      rulesApplied: [
        "Section A: highest group wins",
        ...(result.sectionBValues.length > 1 ? ["Section B: CVC combination"] : []),
        ...(result.sectionCTotal > 0 ? ["Section C: amputation-equivalent CVC"] : []),
        ...(result.firstScheduleBonus ? ["First Schedule: bilateral upper limbs"] : []),
      ],
      finalPercent: result.finalPercent,
    },
    displayMode: autoExpand ? "expanded" : "summary",
  };
}
