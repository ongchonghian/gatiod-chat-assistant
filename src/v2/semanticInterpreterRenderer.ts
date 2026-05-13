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
import { buildSpineScopeChips, detectSpineScopesFromText } from "./spineScope.js";

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
 * Classification of a semantic proposal, used to select message template and
 * chip set. Priority order (ADR-0003 §6):
 *   empty → single_legacy → single_system → multi_scope_spine
 *   → mixed_structured_legacy → multi_system
 *
 * `multi_scope_spine` applies ONLY when ALL non-legacy systems are spine.
 */
export type SemanticProposalKind =
  | "empty"
  | "single_system"
  | "single_legacy"
  | "multi_scope_spine"
  | "mixed_structured_legacy"
  | "multi_system";

/**
 * Classify the interpretation into a proposal kind.
 * Priority is fixed per ADR-0003 §6 to avoid the multi_scope_spine-before-
 * multi_system bug described in §Consequences.
 */
export function classifySemanticProposal(
  interpretation: SemanticInterpretation,
): SemanticProposalKind {
  const systems = interpretation.candidateSystems;
  if (systems.length === 0) return "empty";

  const legacySystems = systems.filter((s) => s.status === "legacy_deferred");
  const structuredSystems = systems.filter((s) => s.status !== "legacy_deferred");

  if (systems.length === 1) {
    return legacySystems.length === 1 ? "single_legacy" : "single_system";
  }

  // multi_scope_spine: ALL non-legacy systems are spine AND ≥2 spine regions detected
  if (structuredSystems.length > 0 && structuredSystems.every((s) => s.system === "spine")) {
    const allText = interpretation.candidateFindings.map((f) => f.sourceSpan).join(" ");
    const scopeKeys = detectSpineScopesFromText(allText);
    if (scopeKeys.length >= 2) {
      return "multi_scope_spine";
    }
  }

  // mixed_structured_legacy
  if (legacySystems.length > 0 && structuredSystems.length > 0) {
    return "mixed_structured_legacy";
  }

  return "multi_system";
}

/**
 * Render a doctor-facing proposal card from a validated semantic
 * interpretation. Uses proposal-kind-specific chip sets per ADR-0003 §6.
 */
export function renderSemanticConsensus(
  interpretation: SemanticInterpretation,
): RenderedSemanticConsensus {
  const lines: string[] = [];
  const candidateSystems: GatiodSystemKey[] = [];

  const kind = classifySemanticProposal(interpretation);

  if (kind === "empty") {
    lines.push(
      "I could not identify any GATIOD assessment areas from the input. Please rephrase or specify a system.",
    );
    return { message: lines.join("\n"), chips: [], candidateSystems: [] };
  }

  const systemCount = interpretation.candidateSystems.length;
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

  const chips = buildChipsForKind(kind, interpretation);

  return {
    message: lines.join("\n").trimEnd(),
    chips,
    candidateSystems,
  };
}

function buildChipsForKind(
  kind: SemanticProposalKind,
  interpretation: SemanticInterpretation,
): string[] {
  const legacySystems = interpretation.candidateSystems
    .filter((s) => s.status === "legacy_deferred")
    .map((s) => s.system);
  const structuredSystems = interpretation.candidateSystems
    .filter((s) => s.status !== "legacy_deferred")
    .map((s) => s.system);

  switch (kind) {
    case "single_system":
      return ["Proceed", "Edit interpretation", "Reject"];

    case "single_legacy":
      return ["Proceed with legacy mode", "Edit interpretation", "Reject"];

    case "multi_scope_spine": {
      // Detect scope regions from all source spans — never include a generic "Proceed".
      const allText = interpretation.candidateFindings.map((f) => f.sourceSpan).join(" ");
      const scopeKeys = detectSpineScopesFromText(allText);
      const scopeChips = buildSpineScopeChips(scopeKeys);
      return [...scopeChips, "Edit interpretation", "Reject"];
    }

    case "mixed_structured_legacy": {
      const chips: string[] = ["Proceed"];
      for (const sys of structuredSystems) {
        chips.push(`Assess ${SYSTEM_DISPLAY_NAMES[sys]} first`);
      }
      for (const sys of legacySystems) {
        chips.push(`Use legacy for ${SYSTEM_DISPLAY_NAMES[sys]}`);
      }
      chips.push("Edit interpretation", "Reject");
      return chips;
    }

    case "multi_system": {
      if (structuredSystems.length <= 3) {
        const chips: string[] = [];
        for (const sys of structuredSystems) {
          chips.push(`Assess ${SYSTEM_DISPLAY_NAMES[sys]} first`);
        }
        chips.push("Proceed", "Edit interpretation", "Reject");
        return chips;
      }
      return ["Proceed", "Choose system first", "Edit interpretation", "Reject"];
    }

    default:
      return ["Proceed", "Edit interpretation", "Reject"];
  }
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
