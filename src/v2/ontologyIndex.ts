import {
  ARM_AMPUTATION_LEVELS,
  FINGER_AMPUTATION_LEVELS,
  LEG_AMPUTATION_LEVELS,
  TOE_AMPUTATION_LEVELS,
  UPPER_LIMB_NERVES,
  LOWER_LIMB_NERVES,
  DBE_CONDITIONS,
  LOWER_DBE_CONDITIONS,
} from "../engine/index.js";
import {
  diagnosisCategories,
  getSeveritiesForCategory,
  type DiagnosisCategory,
} from "../engine/spineAssessmentData.js";
import type { GatiodSystemKey, OntologyMatch } from "./contracts.js";
import { SYSTEM_SYNONYMS } from "./systemSynonyms.js";

interface OntologyEntry {
  system: GatiodSystemKey;
  type: OntologyMatch["type"];
  canonicalId: string;
  label: string;
  aliases: string[];
}

let cache: OntologyEntry[] | null = null;

function compactTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildSpineSeverityEntries(category: DiagnosisCategory): OntologyEntry[] {
  const severities = getSeveritiesForCategory(category, {
    spondylolysisPathway: "pre_existing_superimposed",
  });
  return severities.map((s) => ({
    system: "spine",
    type: "spine_severity",
    canonicalId: s.key,
    label: s.label,
    aliases: [s.key, s.label],
  }));
}

function buildOntology(): OntologyEntry[] {
  const entries: OntologyEntry[] = [];

  for (const item of ARM_AMPUTATION_LEVELS) {
    entries.push({
      system: "upper_limb",
      type: "amputation",
      canonicalId: item.id,
      label: item.label,
      aliases: [item.id, item.label, item.label.replace(/\s+/g, "_")],
    });
  }

  for (const [finger, levels] of Object.entries(FINGER_AMPUTATION_LEVELS)) {
    for (const level of levels) {
      entries.push({
        system: "upper_limb",
        type: "amputation",
        canonicalId: `${finger}:${level.id}`,
        label: `${finger} ${level.label}`,
        aliases: [finger, level.id, level.label, `${finger} ${level.id}`],
      });
    }
  }

  for (const item of UPPER_LIMB_NERVES) {
    entries.push({
      system: "upper_limb",
      type: "nerve",
      canonicalId: item.key,
      label: item.label,
      aliases: [item.key, item.label],
    });
  }

  for (const item of DBE_CONDITIONS) {
    entries.push({
      system: "upper_limb",
      type: "dbe",
      canonicalId: item.id,
      label: item.label,
      aliases: [item.id, item.label, item.description],
    });
  }

  for (const item of LEG_AMPUTATION_LEVELS) {
    entries.push({
      system: "lower_limb",
      type: "amputation",
      canonicalId: item.id,
      label: item.label,
      aliases: [item.id, item.label],
    });
  }

  for (const [toe, levels] of Object.entries(TOE_AMPUTATION_LEVELS)) {
    for (const level of levels) {
      entries.push({
        system: "lower_limb",
        type: "amputation",
        canonicalId: `${toe}:${level.id}`,
        label: `${toe} ${level.label}`,
        aliases: [toe, level.id, level.label, `${toe} ${level.id}`],
      });
    }
  }

  for (const item of LOWER_LIMB_NERVES) {
    entries.push({
      system: "lower_limb",
      type: "nerve",
      canonicalId: item.key,
      label: item.label,
      aliases: [item.key, item.label],
    });
  }

  for (const item of LOWER_DBE_CONDITIONS) {
    entries.push({
      system: "lower_limb",
      type: "dbe",
      canonicalId: item.id,
      label: item.label,
      aliases: [item.id, item.label, item.description],
    });
  }

  for (const category of diagnosisCategories) {
    entries.push({
      system: "spine",
      type: "spine_category",
      canonicalId: category.key,
      label: category.label,
      aliases: [category.key, category.label, category.description],
    });
    entries.push(...buildSpineSeverityEntries(category.key));
  }

  // Concept aliases derived from the curated synonym table — single source of
  // truth so router keywords, ontology concepts, and similar-term suggestions
  // never drift apart.
  const aliasesBySystem = new Map<GatiodSystemKey, string[]>();
  for (const syn of SYSTEM_SYNONYMS) {
    if (syn.requiresConfirmation) continue;
    if (syn.confidence < 0.85) continue;
    if (!aliasesBySystem.has(syn.system)) aliasesBySystem.set(syn.system, []);
    aliasesBySystem.get(syn.system)!.push(syn.term);
  }
  for (const [system, aliases] of aliasesBySystem) {
    entries.push({
      system,
      type: "concept",
      canonicalId: `${system}_concept`,
      label: `${system} concept`,
      aliases,
    });
  }

  return entries;
}

function ensureOntology(): OntologyEntry[] {
  if (!cache) cache = buildOntology();
  return cache;
}

function scoreMatch(queryTokens: string[], entry: OntologyEntry): number {
  const haystack = compactTokens([entry.label, ...entry.aliases].join(" "));
  if (haystack.length === 0 || queryTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) overlap += 1;
  }

  const precision = overlap / queryTokens.length;
  const recall = overlap / haystack.length;
  const bonus = haystack.join(" ").includes(queryTokens.join(" ")) ? 0.1 : 0;
  return precision * 0.75 + recall * 0.25 + bonus;
}

export function searchOntology(query: string, limit = 8): OntologyMatch[] {
  const ontology = ensureOntology();
  const queryTokens = compactTokens(query);
  const scored = ontology
    .map((entry) => ({ entry, score: scoreMatch(queryTokens, entry) }))
    .filter((row) => row.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({
      system: row.entry.system,
      type: row.entry.type,
      canonicalId: row.entry.canonicalId,
      label: row.entry.label,
      aliases: row.entry.aliases,
      score: Number(row.score.toFixed(3)),
    }));

  return scored;
}
