import type { GatiodSystemKey, SlotSignals } from "./contracts.js";

/**
 * Builds a human-readable structured confirmation message for a system, given
 * the accumulated extracted values and slot signals.
 *
 * The message is shown to the doctor before calculation is triggered.
 * Values come from extractedValues (actual text parsed from utterances).
 * Signals govern which sections are included (e.g. nerve section only if detected).
 */
export function buildConfirmationMessage(
  system: GatiodSystemKey,
  values: Record<string, string>,
  signals: Partial<SlotSignals>
): string {
  const header = `**Confirmation — ${SYSTEM_LABELS[system] ?? system}**\n\nPlease confirm the extracted findings before I calculate the system-generated PI%:\n`;
  const body = buildBody(system, values, signals);
  const footer = "\nConfirm and calculate?";
  return header + body + footer;
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
  if (v.path) rows.push(line("Assessment pathway", titleCase(v.path)));
  if (v.leftEarAhl) rows.push(line("Left ear AHL", v.leftEarAhl));
  if (v.rightEarAhl) rows.push(line("Right ear AHL", v.rightEarAhl));
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
