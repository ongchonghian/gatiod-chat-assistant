// Build deterministic JSON fixture from data/gatiod_injury_scenario_catalogue.xlsx
// for the ADR-0001 Excel shadow runner. Run via `npm run build:excel-fixtures`.
//
// Output:
//   tests/v2/excelScenarios/scenarios.generated.json    — committed fixture
//   tests/v2/excelScenarios/outcome-class-report.generated.json — override events
//
// CI invariant: regenerate, then `git diff --exit-code` on the generated files.
// A non-empty diff means the workbook moved without the fixture moving.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  CHAPTER_TO_SYSTEM,
  COMPONENT_SYSTEM_TO_KEY,
  classifyComponentHeuristic,
  parsePiPercent,
  parsePiPercentRange,
} from "../tests/v2/excelScenarios/classifyScenario.js";
import type {
  ExcelFixtureFile,
  ExcelScenarioComponent,
  ExcelScenarioFixture,
  ExpectedOutcomeClass,
  OutcomeClassOverride,
  OutcomeClassOverriddenEvent,
} from "../tests/v2/excelScenarios/scenarioTypes.js";
import type { GatiodSystemKey } from "../src/v2/contracts.js";

const WORKBOOK_PATH = resolve("data/gatiod_injury_scenario_catalogue.xlsx");
const FIXTURE_PATH = resolve("tests/v2/excelScenarios/scenarios.generated.json");
const REPORT_PATH = resolve("tests/v2/excelScenarios/outcome-class-report.generated.json");
const OVERRIDES_PATH = resolve("tests/v2/excelScenarios/outcomeClassOverrides.json");

interface RawOverrides {
  [key: string]: OutcomeClassOverride | unknown;
}

function loadOverrides(): Record<string, OutcomeClassOverride> {
  const raw = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")) as RawOverrides;
  const out: Record<string, OutcomeClassOverride> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    if (
      v &&
      typeof v === "object" &&
      "componentIndex" in v &&
      "outcomeClass" in v &&
      "reason" in v
    ) {
      out[k] = v as OutcomeClassOverride;
    }
  }
  return out;
}

function applyOverride(
  rowId: string,
  sheetName: ExcelScenarioFixture["sheetName"],
  componentIndex: number,
  heuristic: ExpectedOutcomeClass,
  overrides: Record<string, OutcomeClassOverride>,
  events: OutcomeClassOverriddenEvent[],
): { final: ExpectedOutcomeClass; applied: boolean } {
  const key = `${sheetName}:${rowId}`;
  const override = overrides[key];
  if (override && override.componentIndex === componentIndex) {
    if (override.outcomeClass !== heuristic) {
      events.push({
        rowId,
        sheetName,
        componentIndex,
        heuristicClass: heuristic,
        overrideClass: override.outcomeClass,
        reason: override.reason,
      });
    }
    return { final: override.outcomeClass, applied: true };
  }
  return { final: heuristic, applied: false };
}

/**
 * The workbook stores anatomic context (region / joint / organ) in a
 * separate column from the injury description. A doctor would say "cervical
 * compression fracture <25%" but the catalogue rows split this across two
 * cells. Splice them so the input text matches doctor-facing phrasing —
 * without this, every spine row routes correctly but is asked which region
 * it applies to (surfaced by the slice-7 calibration sample).
 */
function spliceRegion(region: string | null | undefined, description: string): string {
  const r = (region ?? "").trim();
  if (!r) return description;
  // Strip the parenthetical landmark (e.g. "Cervical (C1-C7)" → "Cervical")
  // so the resulting text reads cleanly. The full label stays in the source
  // workbook for reference.
  const stripped = r.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!stripped) return description;
  if (description.toLowerCase().includes(stripped.toLowerCase())) return description;
  return `${stripped}: ${description}`;
}

/**
 * Hearing rows store the affected ear in the "Side affected" column and the
 * AHL value buried inside the description ("affected ear AHL (1,2,3 kHz) 50
 * dBA"). The hearing extractor's LEFT_AHL_RE / RIGHT_AHL_RE require the
 * number to appear close to "left ear" / "right ear", which the workbook
 * phrasing doesn't satisfy.
 *
 * This splice prepends a normalized `"<side> AHL <N> dB. "` prefix so the
 * extractor sees doctor-facing phrasing it understands. NID rows (where
 * "Side affected" is "Not applicable" or "Bilateral") get a `"left AHL <N> dB;
 * right AHL <N> dB. "` prefix using the better-ear AHL — readiness will
 * still ask for age, which is what the runner should observe for those rows.
 */
function spliceHearingContext(
  system: GatiodSystemKey,
  side: string | null | undefined,
  description: string,
): string {
  if (system !== "hearing") return description;
  const ahlMatch = description.match(/AHL[^()\d]*(?:\([^)]*\))?\s*(\d+(?:\.\d+)?)\s*dB/i);
  if (!ahlMatch) return description;
  const ahl = ahlMatch[1];
  const sideRaw = (side ?? "").trim().toLowerCase();
  if (sideRaw === "left") return `Left ear AHL ${ahl} dB. ${description}`;
  if (sideRaw === "right") return `Right ear AHL ${ahl} dB. ${description}`;
  // NID / bilateral / not-applicable: treat as both ears with the same AHL.
  // Readiness will still ask for age — that's the right observation for
  // these rows, and it surfaces in the calibration mismatch list.
  return `Left AHL ${ahl} dB; right AHL ${ahl} dB. ${description}`;
}

/**
 * Upper limb and lower limb rows store side in the "Side affected" column;
 * the description usually omits it (e.g. "Shoulder active abduction... 140°").
 * The extractor needs the side word to assemble the assess args. This
 * splice prepends a normalized side prefix when "Side affected" is Left or
 * Right; bilateral / not-applicable rows are handled by the classifier as
 * `clarification_required` and don't need a splice (the runner correctly
 * asks "which side?" on those).
 */
function spliceLimbSide(
  system: GatiodSystemKey,
  side: string | null | undefined,
  description: string,
): string {
  if (system !== "upper_limb" && system !== "lower_limb") return description;
  const sideRaw = (side ?? "").trim().toLowerCase();
  if (sideRaw !== "left" && sideRaw !== "right") return description;
  // Skip if the description already contains the side word — avoid double
  // prefixes like "Left Left shoulder...".
  if (/\b(left|right)\b/i.test(description)) return description;
  const sideLabel = sideRaw === "left" ? "Left" : "Right";
  return `${sideLabel}: ${description}`;
}

function buildSpecificScenarioRows(
  rows: Record<string, unknown>[],
  overrides: Record<string, OutcomeClassOverride>,
  events: OutcomeClassOverriddenEvent[],
): ExcelScenarioFixture[] {
  const out: ExcelScenarioFixture[] = [];
  for (const row of rows) {
    const rowId = String(row["Specific scenario ID"] ?? "").trim();
    const chapter = String(row["Chapter / body system"] ?? "").trim();
    const system = CHAPTER_TO_SYSTEM[chapter];
    if (!rowId || !system) continue;

    const rawDescription = String(row["Scenario / injury description"] ?? "").trim();
    const withRegion = spliceRegion(row["Region / joint / organ"] as string | null, rawDescription);
    const sideAffectedRaw = (row["Side affected"] as string | null) ?? null;
    const withHearing = spliceHearingContext(system, sideAffectedRaw, withRegion);
    const description = spliceLimbSide(system, sideAffectedRaw, withHearing);
    const piRaw = (row["PI%"] as string | number | null) ?? null;
    const expectedPi = parsePiPercent(piRaw) ?? undefined;
    const expectedPiRange = parsePiPercentRange(piRaw) ?? undefined;

    const heuristic = classifyComponentHeuristic({
      system,
      injuryDescription: description || null,
      rawPiPercent: piRaw,
      extractionStatus: (row["Extraction status"] as string | null) ?? null,
      sideAffected: sideAffectedRaw,
    });
    const { final, applied } = applyOverride(rowId, "Specific Scenarios", 0, heuristic, overrides, events);
    const isDeferred = final === "legacy_deferred";

    const component: ExcelScenarioComponent = {
      system,
      injuryDescription: description,
      expectedPiPercent: expectedPi,
      expectedPiRange,
      heuristicOutcomeClass: heuristic,
      outcomeClass: final,
      overrideApplied: applied,
      countsTowardSystemGate: !isDeferred,
      countsTowardCrossSystemE2E: false,
    };

    out.push({
      rowId,
      sheetName: "Specific Scenarios",
      inputText: description,
      expectedFinalPiPercent: expectedPi,
      components: [component],
      rowClassification: "single_system",
    });
  }
  return out;
}

function buildScenarioCatalogueRows(
  rows: Record<string, unknown>[],
  overrides: Record<string, OutcomeClassOverride>,
  events: OutcomeClassOverriddenEvent[],
): ExcelScenarioFixture[] {
  const out: ExcelScenarioFixture[] = [];
  for (const row of rows) {
    const rowId = String(row["ID"] ?? "").trim();
    const chapter = String(row["Chapter / body system"] ?? "").trim();
    const system = CHAPTER_TO_SYSTEM[chapter];
    if (!rowId || !system) continue;

    const rawDescription = String(row["Scenario / injury description"] ?? "").trim();
    const withRegion = spliceRegion(row["Region / joint / organ"] as string | null, rawDescription);
    // Catalogue rows don't have a "Side affected" column — only Specific
    // Scenarios do — so hearing rows here only get the AHL prefix when the
    // splice can detect a side from the description itself.
    const description = spliceHearingContext(system, null, withRegion);
    const piRaw = (row["PI%"] as string | number | null) ?? null;
    const expectedPi = parsePiPercent(piRaw) ?? undefined;
    const expectedPiRange = parsePiPercentRange(piRaw) ?? undefined;

    const heuristic = classifyComponentHeuristic({
      system,
      injuryDescription: description || null,
      rawPiPercent: piRaw,
      extractionStatus: (row["Extraction status"] as string | null) ?? null,
    });
    const { final, applied } = applyOverride(rowId, "Scenario Catalogue", 0, heuristic, overrides, events);
    const isDeferred = final === "legacy_deferred";

    const component: ExcelScenarioComponent = {
      system,
      injuryDescription: description,
      expectedPiPercent: expectedPi,
      expectedPiRange,
      heuristicOutcomeClass: heuristic,
      outcomeClass: final,
      overrideApplied: applied,
      countsTowardSystemGate: !isDeferred,
      countsTowardCrossSystemE2E: false,
    };

    out.push({
      rowId,
      sheetName: "Scenario Catalogue",
      inputText: description,
      expectedFinalPiPercent: expectedPi,
      components: [component],
      rowClassification: "single_system",
    });
  }
  return out;
}

function buildCrossSystemRows(
  rows: Record<string, unknown>[],
  overrides: Record<string, OutcomeClassOverride>,
  events: OutcomeClassOverriddenEvent[],
): ExcelScenarioFixture[] {
  const out: ExcelScenarioFixture[] = [];
  for (const row of rows) {
    const rowId = String(row["Cross scenario ID"] ?? "").trim();
    if (!rowId) continue;

    const inputText = String(row["Doctor-facing combined scenario"] ?? "").trim();
    const expectedPi = parsePiPercent(row["Final PI% via CVC"] as string | number | null) ?? undefined;

    const components: ExcelScenarioComponent[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const compSystem = String(row[`Component ${i} system`] ?? "").trim();
      if (!compSystem) continue;
      const system = COMPONENT_SYSTEM_TO_KEY[compSystem];
      if (!system) continue;

      const description = String(row[`Component ${i} injury description`] ?? "").trim();
      const compPi = parsePiPercent(row[`Component ${i} PI%`] as string | number | null) ?? undefined;

      const heuristic = classifyComponentHeuristic({
        system,
        injuryDescription: description || null,
        rawPiPercent: (row[`Component ${i} PI%`] as string | number | null) ?? null,
        extractionStatus: (row["Extraction status"] as string | null) ?? null,
      });
      const { final, applied } = applyOverride(rowId, "Cross-System Scenarios", i - 1, heuristic, overrides, events);
      const isDeferred = final === "legacy_deferred";

      components.push({
        system,
        injuryDescription: description,
        expectedPiPercent: compPi,
        heuristicOutcomeClass: heuristic,
        outcomeClass: final,
        overrideApplied: applied,
        countsTowardSystemGate: !isDeferred,
        countsTowardCrossSystemE2E: !isDeferred,
      });
    }

    const allDeferred =
      components.length > 0 && components.every((c) => c.outcomeClass === "legacy_deferred");

    out.push({
      rowId,
      sheetName: "Cross-System Scenarios",
      inputText,
      expectedFinalPiPercent: expectedPi,
      components,
      rowClassification: allDeferred ? "legacy_deferred_cross_system" : "cross_system",
    });
  }
  return out;
}

function main(): void {
  const buffer = readFileSync(WORKBOOK_PATH);
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");

  const wb = XLSX.read(buffer, { type: "buffer" });
  const overrides = loadOverrides();
  const events: OutcomeClassOverriddenEvent[] = [];

  const specific = wb.Sheets["Specific Scenarios"]
    ? (XLSX.utils.sheet_to_json(wb.Sheets["Specific Scenarios"], { defval: null }) as Record<string, unknown>[])
    : [];
  const catalogue = wb.Sheets["Scenario Catalogue"]
    ? (XLSX.utils.sheet_to_json(wb.Sheets["Scenario Catalogue"], { defval: null }) as Record<string, unknown>[])
    : [];
  const crossSystem = wb.Sheets["Cross-System Scenarios"]
    ? (XLSX.utils.sheet_to_json(wb.Sheets["Cross-System Scenarios"], { defval: null }) as Record<string, unknown>[])
    : [];

  const scenarios: ExcelScenarioFixture[] = [
    ...buildSpecificScenarioRows(specific, overrides, events),
    ...buildScenarioCatalogueRows(catalogue, overrides, events),
    ...buildCrossSystemRows(crossSystem, overrides, events),
  ];

  // Stable sort for deterministic git diff.
  scenarios.sort((a, b) => {
    if (a.sheetName !== b.sheetName) return a.sheetName.localeCompare(b.sheetName);
    return a.rowId.localeCompare(b.rowId);
  });

  // Per-system sanity counts for the report.
  const componentSystemCounts: Record<GatiodSystemKey, number> = {
    upper_limb: 0,
    lower_limb: 0,
    spine: 0,
    respiratory: 0,
    renal: 0,
    gastro_digestive: 0,
    hearing: 0,
    cns: 0,
    visual: 0,
  };
  const outcomeClassCounts: Record<ExpectedOutcomeClass, number> = {
    exact_calculation: 0,
    clarification_required: 0,
    unsupported_safe_fail: 0,
    routing_only: 0,
    legacy_deferred: 0,
  };
  for (const s of scenarios) {
    for (const c of s.components) {
      componentSystemCounts[c.system] += 1;
      outcomeClassCounts[c.outcomeClass] += 1;
    }
  }

  const fixture: ExcelFixtureFile = {
    sourceWorkbook: "data/gatiod_injury_scenario_catalogue.xlsx",
    sourceSha256,
    generatedAt: new Date().toISOString(),
    sheetCounts: {
      "Scenario Catalogue": catalogue.length,
      "Specific Scenarios": specific.length,
      "Cross-System Scenarios": crossSystem.length,
    },
    scenarios,
  };

  // Pin generatedAt to the workbook hash so determinism doesn't require
  // ignoring the timestamp — different content produces a different hash AND
  // a different timestamp; same content keeps both stable run-to-run.
  // We do this by hashing only the inputs (workbook + overrides) and using
  // that to derive a stable "generatedAt" for the canonical fixture.
  const inputsHash = createHash("sha256")
    .update(buffer)
    .update(readFileSync(OVERRIDES_PATH))
    .digest("hex");
  fixture.generatedAt = `inputs-${inputsHash.slice(0, 16)}`;

  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");

  const report = {
    sourceSha256,
    generatedAt: fixture.generatedAt,
    overrideEventCount: events.length,
    componentSystemCounts,
    outcomeClassCounts,
    overrideEvents: events,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log(
    `Wrote ${scenarios.length} scenarios (${Object.values(componentSystemCounts).reduce((a, b) => a + b, 0)} components) to ${FIXTURE_PATH}`,
  );
  console.log(`Override events: ${events.length}`);
}

main();
