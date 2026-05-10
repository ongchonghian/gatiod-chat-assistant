// Doctor-facing renderer for a validated SemanticInterpretation
// (REQ-SC-OUTPUT-001 acceptance criterion).
//
// Renders the proposal card the doctor sees BEFORE accepting consensus.
// The renderer reads the validated interpretation only. It must not call
// any LLM, must not produce PI%, and must not mention `assess_*` tools.
//
// The output is markdown-formatted text plus a chip array. The caller in
// `chatServiceV2` (Slice F) wraps this into a `pendingConsensus` and stops
// the pipeline.

import type {
  GatiodSystemKey,
  SemanticInterpretation,
} from "./contracts.js";
import { SEMANTIC_SYSTEM_TAXONOMY } from "./semanticSystemTaxonomy.js";

const SYSTEM_DISPLAY_NAMES: Record<GatiodSystemKey, string> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro / Digestive",
  hearing: "Hearing",
  cns: "Central Nervous System",
  visual: "Visual",
};

export interface RenderedSemanticConsensus {
  message: string;
  chips: string[];
  candidateSystems: GatiodSystemKey[];
}

/**
 * Render a doctor-facing proposal card from a validated semantic
 * interpretation. The card lists each candidate system, its source spans,
 * missing fields, and legacy/deferred labels. It ends with the four
 * standard action chips: Proceed, Edit interpretation, Choose system first,
 * Reject.
 */
export function renderSemanticConsensus(
  interpretation: SemanticInterpretation,
): RenderedSemanticConsensus {
  const lines: string[] = [];
  const candidateSystems: GatiodSystemKey[] = [];

  const systemCount = interpretation.candidateSystems.length;
  if (systemCount === 0) {
    lines.push(
      "I could not identify any GATIOD assessment areas from the input. Please rephrase or specify a system.",
    );
    return { message: lines.join("\n"), chips: [], candidateSystems: [] };
  }

  lines.push(
    `I think this input contains findings across **${systemCount} GATIOD assessment area${
      systemCount === 1 ? "" : "s"
    }**:`,
  );
  lines.push("");

  // Group findings by system for display order matching candidateSystems.
  const findingsBySystem: Record<string, SemanticInterpretation["candidateFindings"]> = {};
  for (const f of interpretation.candidateFindings) {
    if (!findingsBySystem[f.system]) findingsBySystem[f.system] = [];
    findingsBySystem[f.system].push(f);
  }

  let idx = 1;
  for (const sys of interpretation.candidateSystems) {
    candidateSystems.push(sys.system);
    const name = SYSTEM_DISPLAY_NAMES[sys.system];
    const statusLabel =
      sys.status === "legacy_deferred"
        ? "legacy/deferred"
        : sys.status === "structured_shadow"
          ? "in shadow validation"
          : "ready for interpretation confirmation";

    lines.push(`${idx}. **${name}** — ${statusLabel}`);
    if (sys.rationale) {
      lines.push(`   ${sys.rationale}`);
    }

    const findings = findingsBySystem[sys.system] ?? [];
    for (const f of findings) {
      lines.push(`   - Source: "${f.sourceSpan}"`);
      if (f.proposedMapping) {
        lines.push(`     Likely interpretation: ${f.proposedMapping}`);
      }
      if (f.missingFields.length > 0) {
        lines.push(`     Missing: ${f.missingFields.join(", ")}`);
      }
      if (sys.status === "legacy_deferred") {
        lines.push(
          `     Note: ${name} is currently handled by legacy assessment mode.`,
        );
      }
    }
    lines.push("");
    idx += 1;
  }

  if (interpretation.unsupportedTerms.length > 0) {
    lines.push(
      `Unsupported / unrecognised terms: ${interpretation.unsupportedTerms.join(", ")}.`,
    );
    lines.push("");
  }

  lines.push("How would you like to proceed?");

  // Standard action chips. The wider claim plan may swap these for the
  // structured plan when 3+ systems are involved (Slice F).
  const chips = ["Proceed", "Edit interpretation", "Choose system first", "Reject"];

  return {
    message: lines.join("\n").trimEnd(),
    chips,
    candidateSystems,
  };
}

/** Helper: list per-system "Assess X first" chips for a structured plan. */
export function buildSystemFirstChips(
  candidateSystems: GatiodSystemKey[],
): string[] {
  return candidateSystems.map(
    (s) => `Assess ${SYSTEM_DISPLAY_NAMES[s]} first`,
  );
}

/** Helper for tests / future renderers — expose taxonomy display names. */
export function getSystemDisplayName(system: GatiodSystemKey): string {
  return SYSTEM_DISPLAY_NAMES[system];
}

// Re-export the taxonomy keys for reference (avoid downstream importing
// SEMANTIC_SYSTEM_TAXONOMY directly).
export const SEMANTIC_TAXONOMY_KEYS = Object.keys(
  SEMANTIC_SYSTEM_TAXONOMY,
) as GatiodSystemKey[];
