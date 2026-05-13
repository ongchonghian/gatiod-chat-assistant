import type { GatiodSystemKey, SlotSignals, V2SystemFacts } from "./contracts.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
  HEARING_FK_AFFECTED_EARS,
} from "./extractors/hearing.js";
import {
  SP_FK_REGION,
  SP_FK_ENTRIES,
  type SpineCategoryEntryFact,
} from "./extractors/spine.js";
import {
  diagnosisCategories,
  getSeveritiesForCategory,
  type DiagnosisCategory,
  type SpondylolysisPathway,
} from "../engine/spineAssessmentData.js";

/**
 * Typed confirmation-build outcome (slice 4 / delta-audit follow-up).
 *
 * Replaces the soft-string return of `buildStructuredConfirmationMessage`,
 * which leaked messages like "Findings collected — confirm to calculate" or
 * "(none extracted yet — please describe the diagnosis)" when required
 * facts were absent. Under the new contract, an insufficient-facts state
 * returns `{ ok: false, reason, missingFields }` so callers must surface
 * a clarification rather than presenting a confirmation card.
 *
 * This is defense-in-depth — system readiness validators already block
 * confirmation when facts are missing — but the contract enforces
 * consistency at the boundary.
 */
export type ConfirmationBuildResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; missingFields: string[] };

/**
 * Build a doctor-facing confirmation message from confirmed structured facts,
 * or refuse with the missing fields if the facts are insufficient.
 */
export function buildStructuredConfirmation(
  system: GatiodSystemKey,
  facts: V2SystemFacts,
): ConfirmationBuildResult {
  const body = buildStructuredBody(system, facts);
  if (!body.ok) return body;

  const header = `**Confirmation — ${SYSTEM_LABELS[system] ?? system}**\n\nPlease confirm the extracted findings before I calculate the system-generated PI%:\n`;
  const footer = "\nConfirm and calculate?";
  return { ok: true, message: header + body.message + footer };
}

/**
 * Backward-compatible string-returning wrapper. Throws on `ok: false` so
 * callers that haven't migrated still hit a clear failure rather than
 * silently rendering a soft message. Production call sites use the typed
 * `buildStructuredConfirmation` and handle the failure gracefully.
 */
export function buildStructuredConfirmationMessage(
  system: GatiodSystemKey,
  facts: V2SystemFacts,
): string {
  const result = buildStructuredConfirmation(system, facts);
  if (!result.ok) {
    throw new Error(
      `buildStructuredConfirmationMessage(${system}): cannot render confirmation — ${result.reason} (missing: ${result.missingFields.join(", ")})`,
    );
  }
  return result.message;
}

/**
 * Build a confirmation message for legacy / shadow systems from extracted
 * display values + slot signals. Returns a typed result so callers can
 * distinguish "render this card" from "we have no facts yet".
 *
 * Fail-closed semantics here are deliberately weaker than `buildStructuredConfirmation`:
 * legacy paths use display-value-driven extraction whose required-fields
 * profile is system-dependent and not centrally enforced. The minimum bar
 * is "at least one fact extracted"; richer per-system fail-closed rules
 * land once each demoted system gathers Excel-shadow evidence under ADR-0001.
 */
export function buildLegacyConfirmation(
  system: GatiodSystemKey,
  values: Record<string, string>,
  signals: Partial<SlotSignals>,
): ConfirmationBuildResult {
  const body = buildBody(system, values, signals);

  // The soft-message branches currently emit phrases like
  // "Findings collected — confirm to calculate." when no facts are present.
  // Fail-closed when we recognize one of those sentinel phrases — the
  // assistant should ask for findings rather than presenting an empty card.
  if (/findings collected — confirm to calculate/i.test(body) && body.split("\n").length === 1) {
    return {
      ok: false,
      reason: "no_facts_present",
      missingFields: ["any"],
    };
  }

  const header = `**Confirmation — ${SYSTEM_LABELS[system] ?? system}**\n\nPlease confirm the extracted findings before I calculate the system-generated PI%:\n`;
  const footer = "\nConfirm and calculate?";
  return { ok: true, message: header + body + footer };
}

/**
 * Backward-compatible string-returning wrapper for legacy confirmation.
 * Throws on `ok: false` so callers that haven't migrated still hit a clear
 * failure rather than rendering an empty confirmation card.
 */
export function buildConfirmationMessage(
  system: GatiodSystemKey,
  values: Record<string, string>,
  signals: Partial<SlotSignals>
): string {
  const result = buildLegacyConfirmation(system, values, signals);
  if (!result.ok) {
    throw new Error(
      `buildConfirmationMessage(${system}): cannot render confirmation — ${result.reason} (missing: ${result.missingFields.join(", ")})`,
    );
  }
  return result.message;
}

function buildStructuredBody(system: GatiodSystemKey, facts: V2SystemFacts): ConfirmationBuildResult {
  switch (system) {
    case "hearing": return buildHearingFromFacts(facts);
    case "spine":   return buildSpineFromFacts(facts);
    default: {
      const entries = Object.entries(facts).filter(([, f]) => f?.value != null);
      if (entries.length === 0) {
        return {
          ok: false,
          reason: "no_facts_present",
          missingFields: ["any"],
        };
      }
      return {
        ok: true,
        message: entries.map(([k, f]) => {
          const v = f!.value;
          const display =
            v === null || v === undefined
              ? "(none)"
              : typeof v === "object"
                ? Object.entries(v as Record<string, unknown>)
                    .filter(([, ev]) => ev != null && ev !== "none")
                    .map(([ek, ev]) =>
                      typeof ev === "object"
                        ? `${ek}: ${JSON.stringify(ev)}`
                        : `${ek}: ${ev}`
                    )
                    .join(", ") || JSON.stringify(v)
                : titleCase(String(v));
          return line(formatKey(k), display);
        }).join("\n"),
      };
    }
  }
}

const SPINE_REGION_LABELS: Record<string, string> = {
  cervical: "Cervical",
  thoraco_lumbar: "Thoraco-Lumbar",
  lumbo_sacral: "Lumbo-Sacral",
};

const SPINE_BLADDER_BOWEL_LABELS: Record<string, string> = {
  none: "None",
  incomplete_single: "Incomplete (bladder or bowel only)",
  incomplete_both: "Incomplete (bladder and bowel)",
  complete_single: "Complete (bladder or bowel only)",
  complete_both: "Complete (bladder and bowel)",
};

function spineCategoryLabel(key: string): string {
  return diagnosisCategories.find((c) => c.key === key)?.label ?? key;
}

function spineSeverityLabel(category: string, severityKey: string, pathway?: string): string {
  if (!severityKey) return "(severity not yet selected)";
  const validCategories = new Set([
    "fractures_dislocations", "spinal_cord_injury", "intervertebral_disc",
    "spondylolysis_spondylolisthesis", "chronic_pain_normal_mri",
  ]);
  if (!validCategories.has(category)) return severityKey;
  const opts = getSeveritiesForCategory(
    category as DiagnosisCategory,
    { spondylolysisPathway: (pathway ?? "acute_traumatic") as SpondylolysisPathway }
  );
  return opts.find((o) => o.key === severityKey)?.label ?? severityKey;
}

function formatSpineEntry(entry: SpineCategoryEntryFact): string {
  const cat = spineCategoryLabel(entry.diagnosisCategory);
  const sev = spineSeverityLabel(entry.diagnosisCategory, entry.severityKey, entry.spondylolysisPathway);
  const modifiers: string[] = [];
  if (entry.monoparesisHalving) modifiers.push("monoparesis halving");
  if (entry.bladderBowelSeverity && entry.bladderBowelSeverity !== "none") {
    modifiers.push(`bladder/bowel: ${SPINE_BLADDER_BOWEL_LABELS[entry.bladderBowelSeverity] ?? entry.bladderBowelSeverity}`);
  }
  if (entry.discCordInvolvement) modifiers.push("disc cord involvement");
  if (entry.spondylolysisPathway === "pre_existing_superimposed") {
    modifiers.push("pre-existing/superimposed pathway");
  }
  const modifierStr = modifiers.length > 0 ? ` (${modifiers.join("; ")})` : "";
  return `${cat}: ${sev}${modifierStr}`;
}

/**
 * Spine fail-closed: require region AND ≥1 entry with a non-empty severityKey.
 * Mirrors `validateSpineReadiness` so a confirmation can only be presented
 * when the calculator can actually run.
 */
function buildSpineFromFacts(facts: V2SystemFacts): ConfirmationBuildResult {
  const missing: string[] = [];
  const region = facts[SP_FK_REGION]?.value as string | undefined;
  if (!region) missing.push("spine_region");

  const entries = (facts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];
  const calculableEntries = entries.filter((e) => e.severityKey !== "");
  if (calculableEntries.length === 0) missing.push("spine_entries");

  if (missing.length > 0) {
    // Region is the more fundamental fact — surface its absence first.
    return {
      ok: false,
      reason: missing.includes("spine_region")
        ? "spine_missing_region"
        : "spine_no_calculable_entries",
      missingFields: missing,
    };
  }

  const rows: string[] = [];
  rows.push(line("Region", SPINE_REGION_LABELS[region!] ?? titleCase(region!)));

  if (calculableEntries.length === 1) {
    rows.push(line("Entry", formatSpineEntry(calculableEntries[0])));
  } else {
    calculableEntries.forEach((entry, idx) => {
      rows.push(line(`Entry ${idx + 1}`, formatSpineEntry(entry)));
    });
  }

  return { ok: true, message: rows.join("\n") };
}

/**
 * Hearing fail-closed: require pathway AND, depending on path:
 *   - NID: both ear AHLs AND age
 *   - Injury: affectedEars AND the AHL for that ear
 * Mirrors `validateHearingCore`.
 */
function buildHearingFromFacts(facts: V2SystemFacts): ConfirmationBuildResult {
  const missing: string[] = [];

  const path = facts[HEARING_FK_PATH]?.value as "nid" | "injury" | undefined;
  if (!path) missing.push("hearing_path");

  const affectedEars = facts[HEARING_FK_AFFECTED_EARS]?.value as "left" | "right" | undefined;
  const rightAhl = facts[HEARING_FK_RIGHT_EAR_AHL]?.value as number | undefined;
  const leftAhl  = facts[HEARING_FK_LEFT_EAR_AHL]?.value as number | undefined;
  const age      = facts[HEARING_FK_AGE]?.value as number | undefined;

  if (path === "nid") {
    if (rightAhl === undefined) missing.push("right_ear_ahl");
    if (leftAhl === undefined) missing.push("left_ear_ahl");
    if (age === undefined) missing.push("age");
  } else if (path === "injury") {
    if (!affectedEars) {
      missing.push("affected_ears");
    } else if (affectedEars === "left" && leftAhl === undefined) {
      missing.push("left_ear_ahl");
    } else if (affectedEars === "right" && rightAhl === undefined) {
      missing.push("right_ear_ahl");
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: "hearing_required_facts_missing",
      missingFields: missing,
    };
  }

  const rows: string[] = [];
  rows.push(line("Assessment pathway", path === "nid" ? "Noise-Induced Deafness (NID)" : "Injury/Accident"));
  if (affectedEars) rows.push(line("Affected ear", titleCase(affectedEars)));
  if (rightAhl !== undefined) rows.push(line("Right ear AHL", `${rightAhl} dB`));
  if (leftAhl  !== undefined) rows.push(line("Left ear AHL",  `${leftAhl} dB`));
  if (age      !== undefined) rows.push(line("Age", String(age)));

  return { ok: true, message: rows.join("\n") };
}

const SYSTEM_LABELS: Partial<Record<GatiodSystemKey, string>> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro-Digestive",
  hearing: "Hearing",
  cns: "CNS",
  visual: "Visual",
};

function line(label: string, value: string): string {
  return `- **${label}:** ${value}`;
}

function buildBody(
  system: GatiodSystemKey,
  v: Record<string, string>,
  s: Partial<SlotSignals>
): string {
  switch (system) {
    case "upper_limb": return buildUpperLimb(v, s);
    case "lower_limb": return buildLowerLimb(v, s);
    case "spine": return buildSpine(v, s);
    case "respiratory": return buildRespiratory(v, s);
    case "renal": return buildRenal(v, s);
    case "gastro_digestive": return buildGastro(v, s);
    case "hearing": return buildHearing(v, s);
    case "cns": return buildCns(v, s);
    case "visual": return buildVisual(v, s);
    default: return buildGeneric(v);
  }
}

// ---------------------------------------------------------------------------
// Upper Limb
// ---------------------------------------------------------------------------

function buildUpperLimb(v: Record<string, string>, s: Partial<SlotSignals>): string {
  const rows: string[] = [];

  rows.push(line("Side", titleCase(v.side ?? "not specified")));

  if (s.rom_present) {
    const joint = titleCase(v.rom_joint ?? "joint not specified");
    const readings = v.rom_readings ?? v.degrees ?? "measurements not specified";
    const ankylosis = v.ankylosis_type === "ankylosed" ? " (ankylosed)" : v.ankylosis_type === "restricted motion" ? " (restricted motion)" : "";
    rows.push(line("ROM", `${joint}${ankylosis} — ${readings}`));
  }

  if (s.nerve_present && v.nerve_present !== "none") {
    const nerve = titleCase(v.nerve_name ?? "nerve not specified");
    const deficit = v.nerve_deficit ?? "deficit type not specified";
    const loss = v.nerve_loss ?? "loss type not specified";
    rows.push(line("Nerve deficit", `${nerve}, ${deficit}, ${loss}`));
    if (v.rom_from_nerve) {
      rows.push(line("ROM from nerve lesion", v.rom_from_nerve === "from nerve" ? "Yes — ROM excluded from PI" : "No — ROM is independent"));
    }
  } else {
    rows.push(line("Nerve deficit", "None reported"));
  }

  if (s.amputation_present && v.amputation_present !== "none") {
    rows.push(line("Amputation", "Amputation finding reported — confirm level"));
  } else {
    rows.push(line("Amputation", "None reported"));
  }

  if (s.dbe_present && v.dbe_present !== "none") {
    rows.push(line("DBE condition", "DBE finding reported — confirm condition"));
  } else {
    rows.push(line("DBE condition", "None reported"));
  }

  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Lower Limb
// ---------------------------------------------------------------------------

function buildLowerLimb(v: Record<string, string>, s: Partial<SlotSignals>): string {
  const rows: string[] = [];

  rows.push(line("Side", titleCase(v.side ?? "not specified")));

  if (s.rom_present) {
    const joint = titleCase(v.rom_joint ?? "joint not specified");
    const readings = v.rom_readings ?? v.degrees ?? "measurements not specified";
    rows.push(line("ROM", `${joint} — ${readings}`));
  }

  if (s.nerve_present && v.nerve_present !== "none") {
    const nerve = titleCase(v.nerve_name ?? "nerve not specified");
    const deficit = v.nerve_deficit ?? "?";
    const loss = v.nerve_loss ?? "?";
    rows.push(line("Nerve deficit", `${nerve}, ${deficit}, ${loss}`));
    if (v.rom_from_nerve) {
      rows.push(line("ROM from nerve lesion", v.rom_from_nerve === "from nerve" ? "Yes" : "No"));
    }
  } else {
    rows.push(line("Nerve deficit", "None reported"));
  }

  if (s.shortening_present && v.shortening_cm) {
    rows.push(line("Limb shortening", v.shortening_cm));
  } else if (!s.amputation_present) {
    rows.push(line("Limb shortening", "None reported"));
  }

  if (s.amputation_present && v.amputation_present !== "none") {
    rows.push(line("Amputation", "Amputation finding reported — confirm level"));
  } else {
    rows.push(line("Amputation", "None reported"));
  }

  if (s.dbe_present && v.dbe_present !== "none") {
    rows.push(line("DBE condition", "DBE finding reported — confirm condition"));
  } else {
    rows.push(line("DBE condition", "None reported"));
  }

  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Spine
// ---------------------------------------------------------------------------

function buildSpine(v: Record<string, string>, s: Partial<SlotSignals>): string {
  const rows: string[] = [];

  rows.push(line("Region", titleCase(v.region ?? "not specified")));
  rows.push(line("Diagnosis pathway", titleCase(v.diagnosis_category ?? "not specified")));

  if (s.severity_key) {
    rows.push(line("Severity / finding", v.severity_key ?? "not specified"));
  }

  if (s.asia_grade && v.asia_grade) {
    rows.push(line("ASIA grade", v.asia_grade));
  }

  if (s.spine_neuro_present) {
    if (s.monoparesis_gate) {
      rows.push(line("Monoparesis", "Yes — halving rule may apply"));
    }
    if (s.bladder_bowel) {
      rows.push(line("Bladder/bowel", "Neurogenic involvement reported"));
    } else {
      rows.push(line("Bladder/bowel", "None reported"));
    }
  }

  if (s.mri_status) {
    rows.push(line("MRI status", v.mri_status ?? "not specified"));
  }

  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Remaining systems — generic summaries, sufficient for MVP
// ---------------------------------------------------------------------------

function buildRespiratory(v: Record<string, string>, _s: Partial<SlotSignals>): string {
  const rows: string[] = [];
  if (v.diagnosis) rows.push(line("Pathway", titleCase(v.diagnosis)));
  if (v.pft_values) rows.push(line("PFT values", v.pft_values));
  return rows.join("\n") || "Respiratory findings collected — confirm to calculate.";
}

function buildRenal(v: Record<string, string>, _s: Partial<SlotSignals>): string {
  const rows: string[] = [];
  if (v.renal_inputs) rows.push(line("Lab values", v.renal_inputs));
  if (v.sex) rows.push(line("Sex", titleCase(v.sex)));
  if (v.clinical_severity) rows.push(line("Severity class", titleCase(v.clinical_severity)));
  return rows.join("\n") || "Renal findings collected — confirm to calculate.";
}

function buildGastro(v: Record<string, string>, _s: Partial<SlotSignals>): string {
  const rows: string[] = [];
  if (v.subSystem) rows.push(line("Subsystem", titleCase(v.subSystem)));
  if (v.selectedBracketIndex) rows.push(line("Severity bracket", titleCase(v.selectedBracketIndex)));
  if (v.piPercent) rows.push(line("Selected PI%", v.piPercent));
  return rows.join("\n") || "Gastro-digestive findings collected — confirm to calculate.";
}

function buildHearing(v: Record<string, string>, _s: Partial<SlotSignals>): string {
  const rows: string[] = [];
  if (v.path) rows.push(line("Assessment pathway", v.path === "nid" ? "Noise-Induced Deafness (NID)" : "Injury/Accident"));
  if (v.affected_ears) rows.push(line("Affected ear", titleCase(v.affected_ears)));
  if (v.right_ear_ahl) rows.push(line("Right ear AHL", v.right_ear_ahl));
  if (v.left_ear_ahl)  rows.push(line("Left ear AHL",  v.left_ear_ahl));
  if (v.age) rows.push(line("Age", v.age));
  return rows.join("\n") || "Hearing findings collected — confirm to calculate.";
}

function buildCns(v: Record<string, string>, _s: Partial<SlotSignals>): string {
  const rows: string[] = [];
  if (v.cns_section) rows.push(line("Section", titleCase(v.cns_section)));
  if (v.section_a_group) rows.push(line("Group", titleCase(v.section_a_group)));
  return rows.join("\n") || "CNS findings collected — confirm to calculate.";
}

function buildVisual(v: Record<string, string>, _s: Partial<SlotSignals>): string {
  const rows: string[] = [];
  if (v.leftEye) rows.push(line("Left eye VA", v.leftEye));
  if (v.rightEye) rows.push(line("Right eye VA", v.rightEye));
  if (v.diplopiaId) rows.push(line("Diplopia", titleCase(v.diplopiaId)));
  return rows.join("\n") || "Visual findings collected — confirm to calculate.";
}

function buildGeneric(v: Record<string, string>): string {
  const entries = Object.entries(v).filter(([, val]) => val && val !== "none");
  if (entries.length === 0) return "Findings collected — confirm to calculate.";
  return entries.map(([k, val]) => line(formatKey(k), titleCase(val))).join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
