/**
 * Trace Builder — converts an engine result into a human-readable, step-by-step
 * computation trace. Used by DecisionReplay to let doctors inspect and challenge
 * individual steps of the PI% calculation.
 */

export interface TraceStep {
  id: string;
  number: number;
  title: string;
  /** One-line outcome summary shown in collapsed state. */
  summary: string;
  /** Expanded audit notes shown when the step is opened. */
  detail: string[];
  /** The percentage this step contributed, or null for non-numeric steps. */
  percent: number | null;
  /** Whether the doctor can flag a concern against this step. */
  canChallenge: boolean;
}

interface CategoryData {
  label: string;
  rawPercent: number;
  notes: string[];
  gatiodReference?: { chapter: string; section?: string; table?: string };
}

interface Conflict {
  joint: string;
  romPercent: number;
  dbePercent: number;
  winner: string;
}

export interface AssessmentResult {
  finalPercent: number;
  amputation: CategoryData;
  rom: CategoryData;
  neurological: CategoryData;
  dbe: CategoryData;
  shortening?: CategoryData;
  dbeRomConflicts: Conflict[];
  cvcInputs: number[];
}

export function buildUpperLimbTrace(result: AssessmentResult): TraceStep[] {
  const steps: TraceStep[] = [];
  let n = 1;

  // ── Amputation ──────────────────────────────────────────────────────────────
  if (result.amputation.rawPercent > 0 || result.amputation.notes.length > 0) {
    steps.push({
      id: "step_amputation",
      number: n++,
      title: "Amputation Assessment",
      summary:
        result.amputation.rawPercent > 0
          ? `${result.amputation.rawPercent}% PI from amputation findings`
          : "No amputations recorded",
      detail:
        result.amputation.notes.length > 0
          ? result.amputation.notes
          : ["No amputation findings were entered."],
      percent: result.amputation.rawPercent,
      canChallenge: true,
    });
  }

  // ── ROM ─────────────────────────────────────────────────────────────────────
  const romExcluded = result.rom.notes.some(
    (note) => note.toLowerCase().includes("excluded") || note.toLowerCase().includes("r0017")
  );
  steps.push({
    id: "step_rom",
    number: n++,
    title: "Range of Motion (ROM) Assessment",
    summary: romExcluded
      ? "ROM excluded — nerve lesion gate (R0017) applied; ROM stream zeroed"
      : result.rom.rawPercent > 0
        ? `${result.rom.rawPercent}% PI from ROM restrictions`
        : "No ROM findings recorded",
    detail:
      result.rom.notes.length > 0
        ? result.rom.notes
        : ["No range of motion findings were entered."],
    percent: result.rom.rawPercent,
    canChallenge: true,
  });

  // ── DBE ─────────────────────────────────────────────────────────────────────
  if (result.dbe.rawPercent > 0 || result.dbe.notes.length > 0) {
    steps.push({
      id: "step_dbe",
      number: n++,
      title: "Diagnosis-Based Estimates (DBE)",
      summary:
        result.dbe.rawPercent > 0
          ? `${result.dbe.rawPercent}% PI from diagnosis-based conditions`
          : "No DBE conditions recorded",
      detail:
        result.dbe.notes.length > 0
          ? result.dbe.notes
          : ["No diagnosis-based conditions were entered."],
      percent: result.dbe.rawPercent,
      canChallenge: true,
    });
  }

  // ── Neurological ────────────────────────────────────────────────────────────
  if (result.neurological.rawPercent > 0 || result.neurological.notes.length > 0) {
    steps.push({
      id: "step_neurological",
      number: n++,
      title: "Neurological Assessment",
      summary:
        result.neurological.rawPercent > 0
          ? `${result.neurological.rawPercent}% PI from nerve injuries`
          : "No neurological findings recorded",
      detail:
        result.neurological.notes.length > 0
          ? result.neurological.notes
          : ["No neurological findings were entered."],
      percent: result.neurological.rawPercent,
      canChallenge: true,
    });
  }

  // ── DBE vs ROM Conflict Resolution ──────────────────────────────────────────
  if (result.dbeRomConflicts.length > 0) {
    const conflictDetail = result.dbeRomConflicts.map(
      (c) =>
        `${c.joint}: DBE ${c.dbePercent}% vs ROM ${c.romPercent}% → ${c.winner} retained (higher award principle)`
    );
    steps.push({
      id: "step_conflict_resolution",
      number: n++,
      title: "DBE vs ROM Conflict Resolution",
      summary: `${result.dbeRomConflicts.length} joint conflict${result.dbeRomConflicts.length > 1 ? "s" : ""} — higher value retained per GATIOD higher-award rule`,
      detail: conflictDetail,
      percent: null,
      canChallenge: true,
    });
  }

  // ── CVC Combination ─────────────────────────────────────────────────────────
  if (result.cvcInputs.length > 1) {
    const inputStr = result.cvcInputs.map((v) => `${v}%`).join(", ");
    steps.push({
      id: "step_cvc",
      number: n++,
      title: "CVC Combination (Combined Values Chart)",
      summary: `${inputStr} combined → ${result.finalPercent}% final PI`,
      detail: [
        `Input values (descending): ${inputStr}`,
        "Combination method: CVC (Combined Values Chart) — each subsequent value is applied to the remainder.",
        `Final result: ${result.finalPercent}% Permanent Incapacity`,
      ],
      percent: result.finalPercent,
      canChallenge: false,
    });
  } else {
    steps.push({
      id: "step_final",
      number: n++,
      title: "Final Result",
      summary: `${result.finalPercent}% PI — single active category, no CVC combination needed`,
      detail: [
        `Only one category contributed a non-zero value: ${result.cvcInputs[0] ?? 0}%`,
        `Final result: ${result.finalPercent}% Permanent Incapacity`,
      ],
      percent: result.finalPercent,
      canChallenge: false,
    });
  }

  return steps;
}
