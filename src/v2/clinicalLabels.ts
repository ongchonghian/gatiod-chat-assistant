import type { GatiodSystemKey } from "./contracts.js";
import type { SpineCategoryEntryFact } from "./extractors/spine.js";
import {
  diagnosisCategories,
  getSeveritiesForCategory,
  type DiagnosisCategory,
  type SpondylolysisPathway,
} from "../engine/spineAssessmentData.js";
import {
  DIAGNOSIS_LABELS as RESPIRATORY_DIAGNOSIS_LABELS,
  ASTHMA_MEDICATION_LABELS,
  DYSPNOEA_LABELS,
  ASBESTOSIS_PROFUSION_LABELS,
} from "../engine/respiratoryData.js";
import {
  PATIENT_SEX_LABELS,
  CKD_STAGE_LABELS,
  CLINICAL_SEVERITY_LABELS,
} from "../engine/renalData.js";

// ── Internal registration types ───────────────────────────────────────────────

type LabelMap = Record<string, string>;
type ValueFormatter = (value: unknown) => string;
type FormatterMap = Record<string, ValueFormatter>;

interface SystemRegistration {
  labels: LabelMap;
  formatters: FormatterMap;
}

const registry = new Map<GatiodSystemKey, SystemRegistration>();

function register(
  system: GatiodSystemKey,
  labels: LabelMap,
  formatters: FormatterMap = {},
): void {
  registry.set(system, { labels, formatters });
}

// ── Fallback helpers ──────────────────────────────────────────────────────────

function fallbackLabel(factKey: string): string {
  return factKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fallbackValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return "(complex value)";
  return String(value);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function factKeyLabel(system: GatiodSystemKey, factKey: string): string {
  const reg = registry.get(system);
  return reg?.labels[factKey] ?? fallbackLabel(factKey);
}

export function factValueDisplay(
  system: GatiodSystemKey,
  factKey: string,
  value: unknown,
): string {
  const reg = registry.get(system);
  const formatter = reg?.formatters[factKey];
  if (formatter) return formatter(value);
  return fallbackValue(value);
}

// ── Spine ─────────────────────────────────────────────────────────────────────

const SPINE_REGION_LABELS: Record<string, string> = {
  cervical: "Cervical",
  thoraco_lumbar: "Thoraco-Lumbar",
  lumbo_sacral: "Lumbo-Sacral",
};

export const SPINE_BLADDER_BOWEL_LABELS: Record<string, string> = {
  none: "None",
  incomplete_single: "Incomplete (bladder or bowel only)",
  incomplete_both: "Incomplete (bladder and bowel)",
  complete_single: "Complete (bladder or bowel only)",
  complete_both: "Complete (bladder and bowel)",
};

function spineCategoryLabel(key: string): string {
  return diagnosisCategories.find((c) => c.key === key)?.label ?? fallbackLabel(key);
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
    { spondylolysisPathway: (pathway ?? "acute_traumatic") as SpondylolysisPathway },
  );
  return opts.find((o) => o.key === severityKey)?.label ?? severityKey;
}

export function formatSpineEntry(entry: SpineCategoryEntryFact): string {
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

register(
  "spine",
  {
    spine_region: "Region",
    spine_entries: "Diagnosis entries",
    monoparesisHalving: "Monoparesis halving",
    bladderBowelSeverity: "Bladder/bowel",
    discCordInvolvement: "Cord involvement",
    spondylolysisPathway: "Spondylolysis pathway",
  },
  {
    spine_region: (v) => SPINE_REGION_LABELS[v as string] ?? fallbackLabel(String(v)),
    spine_entries: (v) => {
      const entries = v as SpineCategoryEntryFact[];
      if (!Array.isArray(entries) || entries.length === 0) return "(no entries)";
      return entries.map(formatSpineEntry).join("; ");
    },
    bladderBowelSeverity: (v) => SPINE_BLADDER_BOWEL_LABELS[v as string] ?? String(v),
  },
);

// ── ROM joints formatter (shared by upper_limb and lower_limb) ────────────────

type RomJointEntry = {
  isAnkylosed?: boolean;
  measurements?: Record<string, number>;
};

function formatRomJoints(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const obj = value as Record<string, RomJointEntry>;
  const entries = Object.entries(obj);
  if (entries.length === 0) return "(no joints recorded)";
  return entries
    .map(([joint, jv]) => {
      if (jv.isAnkylosed) return `${joint}: ankylosed`;
      const measurements = jv.measurements ?? {};
      const dirs = Object.entries(measurements)
        .map(([dir, angle]) => `${dir} ${angle}°`)
        .join(", ");
      return dirs.length > 0 ? `${joint}: ${dirs}` : joint;
    })
    .join("; ");
}

// ── Upper limb ────────────────────────────────────────────────────────────────

register(
  "upper_limb",
  {
    side: "Side",
    rom_joints: "Range of motion",
    rom_from_nerve: "ROM from nerve",
    nerve_selections: "Nerve injuries",
    arm_amputation: "Arm amputation",
    finger_amputations: "Finger amputations",
    dbe_selections: "DBE",
  },
  {
    rom_joints: formatRomJoints,
  },
);

// ── Lower limb ────────────────────────────────────────────────────────────────

register(
  "lower_limb",
  {
    side: "Side",
    bilateral_mode: "Bilateral mode",
    rom_joints: "Range of motion",
    rom_from_nerve: "ROM from nerve",
    nerve_selections: "Nerve injuries",
    leg_amputation: "Leg amputation",
    toe_amputations: "Toe amputations",
    shortening_cm: "Shortening",
    dbe_selections: "DBE",
  },
  {
    rom_joints: formatRomJoints,
    shortening_cm: (v) => (v === null || v === undefined ? "—" : `${v} cm`),
  },
);

// ── Hearing ───────────────────────────────────────────────────────────────────

register("hearing", {
  hearing_path: "Assessment pathway",
  hearing_left_ear_ahl: "Left ear AHL",
  hearing_right_ear_ahl: "Right ear AHL",
  hearing_age: "Patient age",
  hearing_affected_ears: "Affected ears",
  hearing_occupational_years: "Occupational exposure years",
  hearing_tinnitus: "Tinnitus",
});

// ── Respiratory ───────────────────────────────────────────────────────────────

register(
  "respiratory",
  {
    resp_diagnosis: "Diagnosis type",
    resp_fvc: "FVC (% predicted)",
    resp_fev1: "FEV1 (% predicted)",
    resp_dlco: "DLCO (% predicted)",
    resp_vo2max: "VO₂ max (mL/kg/min)",
    resp_dyspnoea: "Dyspnoea",
    resp_asthma_daily_maintenance: "Daily maintenance therapy",
    resp_asthma_transferred: "Transferred asthma",
    resp_asthma_unlikely_improvement: "Unlikely improvement",
    resp_asthma_medication: "Maintenance medication",
    resp_asbestosis_radiological: "Radiological evidence",
    resp_asbestosis_profusion: "Profusion band",
  },
  {
    resp_diagnosis: (v) => RESPIRATORY_DIAGNOSIS_LABELS[v as keyof typeof RESPIRATORY_DIAGNOSIS_LABELS] ?? fallbackLabel(String(v)),
    resp_dyspnoea: (v) => DYSPNOEA_LABELS[v as keyof typeof DYSPNOEA_LABELS] ?? fallbackLabel(String(v)),
    resp_asthma_medication: (v) => ASTHMA_MEDICATION_LABELS[v as keyof typeof ASTHMA_MEDICATION_LABELS] ?? fallbackLabel(String(v)),
    resp_asbestosis_profusion: (v) => ASBESTOSIS_PROFUSION_LABELS[v as keyof typeof ASBESTOSIS_PROFUSION_LABELS] ?? fallbackLabel(String(v)),
  },
);

// ── Renal ─────────────────────────────────────────────────────────────────────

register(
  "renal",
  {
    renal_sex: "Patient sex",
    renal_serum_creatinine: "Serum creatinine",
    renal_creatinine_clearance: "Creatinine clearance",
    renal_ckd_stage: "CKD stage",
    renal_clinical_severity: "Clinical severity",
    renal_solitary_kidney: "Solitary kidney",
    renal_provisional_award: "Provisional award",
  },
  {
    renal_sex: (v) => PATIENT_SEX_LABELS[v as keyof typeof PATIENT_SEX_LABELS] ?? fallbackLabel(String(v)),
    renal_ckd_stage: (v) => CKD_STAGE_LABELS[v as keyof typeof CKD_STAGE_LABELS] ?? fallbackLabel(String(v)),
    renal_clinical_severity: (v) => CLINICAL_SEVERITY_LABELS[v as keyof typeof CLINICAL_SEVERITY_LABELS] ?? fallbackLabel(String(v)),
  },
);

// ── Gastro-digestive ──────────────────────────────────────────────────────────

const GASTRO_SUBSYSTEM_LABELS: Record<string, string> = {
  upperGI: "Upper GI",
  colonicRectalAnal: "Colonic / Rectal / Anal",
  liverBiliary: "Liver / Biliary",
  hernia: "Hernia",
};

const GASTRO_COLONAL_SUBPATH_LABELS: Record<string, string> = {
  colostomy: "Colostomy",
  inflammatory: "Inflammatory bowel disease",
  other: "Other colonic/rectal/anal",
};

const GASTRO_LIVER_BILIARY_SUBPATH_LABELS: Record<string, string> = {
  liver: "Liver disease",
  biliary: "Biliary disease",
};

register(
  "gastro_digestive",
  {
    gastro_subsystem: "Subsystem",
    gastro_colonal_subpath: "Colonic sub-pathway",
    gastro_liver_biliary_subpath: "Liver/biliary sub-pathway",
    gastro_bracket_index: "Severity bracket",
    gastro_weight_loss_percent: "Weight loss",
    gastro_pi_percent: "PI%",
    gastro_clinical_justification: "Clinical justification",
  },
  {
    gastro_subsystem: (v) => GASTRO_SUBSYSTEM_LABELS[v as string] ?? fallbackLabel(String(v)),
    gastro_colonal_subpath: (v) => GASTRO_COLONAL_SUBPATH_LABELS[v as string] ?? fallbackLabel(String(v)),
    gastro_liver_biliary_subpath: (v) => GASTRO_LIVER_BILIARY_SUBPATH_LABELS[v as string] ?? fallbackLabel(String(v)),
  },
);

// ── CNS (placeholder — system not yet structured_live) ───────────────────────

register("cns", {
  cns_g1a_bracketId: "Group 1A: Consciousness bracket",
  cns_g1b_bracketId: "Group 1B: Episodic impairment bracket",
  cns_g1c_bracketId: "Group 1C: Arousal bracket",
  cns_g2_bracketId: "Group 2: Cognitive bracket",
  cns_g2_neuro_confirmed: "Neurologist confirmation",
  cns_g3_bracketId: "Group 3: Psychiatric overlay bracket",
  cns_g4_bracketId: "Group 4: Episodic neurological bracket",
  cns_g4_psych_confirmed: "Psychiatrist confirmation",
  cns_b_olfaction_bracketId: "Olfaction bracket",
  cns_b_facial_bracketId: "Facial nerve bracket",
  cns_b_equilibrium_bracketId: "Equilibrium bracket",
  cns_b_equilibrium_ent_confirmed: "ENT confirmation",
  cns_b_swallowing_bracketId: "Swallowing bracket",
  cns_b_station_gait_bracketId: "Station/gait bracket",
  cns_b_respiration_bracketId: "Respiration bracket",
  cns_c_paralysed_limbs: "Paralysed limbs",
});

// ── Visual (placeholder — system not yet structured_live) ─────────────────────

register("visual", {
  visual_left_acuity_id: "Left eye acuity",
  visual_right_acuity_id: "Right eye acuity",
  visual_left_field_id: "Left eye visual field",
  visual_right_field_id: "Right eye visual field",
  visual_left_modifiers: "Left eye modifiers",
  visual_right_modifiers: "Right eye modifiers",
  visual_left_conditions: "Left eye conditions",
  visual_right_conditions: "Right eye conditions",
  visual_diplopia_id: "Diplopia zone",
  visual_left_enucleated: "Left eye enucleated",
  visual_right_enucleated: "Right eye enucleated",
});
