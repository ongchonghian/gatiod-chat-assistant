import { randomUUID } from "crypto";
import type {
  ExtractedFact,
  ExtractionAuditEvent,
  ExtractionContext,
  GatiodSystemKey,
  NormalizedUtterance,
  OntologyMatch,
  PendingObservation,
  SlotSignals,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import {
  getSeveritiesForCategory,
  type DiagnosisCategory,
  type SeverityKey,
  type BladderBowelSeverity,
  type SpondylolysisPathway,
  type SpinalRegion,
} from "../../engine/spineAssessmentData.js";

// ── Fact key constants (shared with argBuilder) ──────────────────────────────

export const SP_FK_REGION  = "spine_region";
export const SP_FK_ENTRIES = "spine_entries";

// ── Internal types ────────────────────────────────────────────────────────────

export interface SpineCategoryEntryFact {
  diagnosisCategory: DiagnosisCategory;
  severityKey: SeverityKey | "";
  monoparesisHalving: boolean;
  bladderBowelSeverity: BladderBowelSeverity;
  discCordInvolvement: boolean;
  spondylolysisPathway: SpondylolysisPathway;
}

// ── Pattern tables ────────────────────────────────────────────────────────────

const REGION_CERVICAL_RE = /\b(cervical|c[\s-]?spine|neck\s+spine|c[1-7](?:\s*[-–]\s*c[1-7])?)\b/i;
const REGION_THORACO_RE  = /\b(thorac(?:ic|o[-\s]?lumbar)|thoracolumbar|t[1-9]|t1[0-2]|t[\s-]?l\b)\b/i;
// Negative lookbehind excludes "lumbar" matches that are part of "thoraco-lumbar"
// or "thoracolumbar" — those belong to thoraco_lumbar, not lumbo_sacral.
const REGION_LUMBO_RE    = /(?<!thoraco[-\s]?)\b(lumbo?[-\s]?sacral|lumbosacral|lumbar|l[2-5]|l[\s-]?s\b|lower\s+back)\b/i;

/**
 * Detect every spinal region mentioned in the text. Used by the multi-region
 * guard so a sentence describing both cervical and lumbo-sacral findings
 * surfaces both, instead of silently picking the first one and dropping the
 * rest.
 *
 * The three region regexes are designed to be mutually exclusive: the
 * lumbo-sacral pattern excludes matches that are part of "thoraco-lumbar",
 * so detecting "thoraco-lumbar compression" returns only `thoraco_lumbar`.
 */
export function detectSpineRegions(text: string): SpinalRegion[] {
  const regions: SpinalRegion[] = [];
  if (REGION_CERVICAL_RE.test(text)) regions.push("cervical");
  if (REGION_THORACO_RE.test(text))  regions.push("thoraco_lumbar");
  if (REGION_LUMBO_RE.test(text))    regions.push("lumbo_sacral");
  return regions;
}

const REGION_LABELS: Record<SpinalRegion, string> = {
  cervical: "Cervical",
  thoraco_lumbar: "Thoraco-Lumbar",
  lumbo_sacral: "Lumbo-Sacral",
};

export const SPINE_MULTI_REGION_AUDIT_EVENT = "spine_multi_region_unsupported";

const CATEGORY_FRACTURE_RE    = /\b(fracture|dislocation|fracture[-\s]?dislocation|burst\s+fracture|compression\s+fracture|vertebral\s+fracture)\b/i;
const CATEGORY_CORD_RE        = /\b(spinal\s+cord|cord\s+injury|cauda\s+equina|myelopathy|central\s+cord|neurogenic)\b/i;
// Slice-16 — also match the bare "degenerated/degenerating disc" form, which
// the workbook uses for section 3.2 rows (e.g. "Degenerated disc with
// documented superimposed injury - residual pain"). Without this, the
// extractor doesn't even detect the disc category and asks the doctor
// "what is the spinal diagnosis?" despite the input being unambiguous.
const CATEGORY_DISC_RE        = /\b(intervertebral\s+disc|disc\s+(?:prolapse|herniation|protrusion|degeneration|lesion)|prolapsed\s+disc|herniated\s+disc|disc\s+disease|ivd\b|degenerat(?:ed|ing)\s+disc)\b/i;
const CATEGORY_SPONDY_RE      = /\b(spondylol[iy]s[iy]s|spondylolisthesis|spondy\b)\b/i;
const CATEGORY_CHRONIC_RE     = /\b(chronic\s+pain\s+(?:syndrome\s+)?(?:with\s+normal\s+mri|normal\s+mri)|normal\s+mri\s+chronic|chronic\s+spinal\s+pain)\b/i;

// Severity patterns — order matters (more specific first)
const ASIA_BA_RE   = /\b(asia\s*[ab]\b|paraplegia|tetraplegia|quadriplegia|complete\s+cord)\b/i;
const ASIA_C_RE    = /\b(asia\s*c\b|incomplete\s+(?:paraparesis|tetraparesis).*asia\s*c|asia\s*c.*(?:paraparesis|tetraparesis))\b/i;
const ASIA_D_RE    = /\b(asia\s*d\b|(?:paraparesis|tetraparesis)(?!\s+asia\s*[abc]))\b/i;
const MILD_NEURO_RE        = /\b(mild\s+(?:sensory|motor|neurological)|mild\s+sensory\s+(?:and\s+)?motor|mild\s+neuro)\b/i;
const PERSISTENT_RADICULAR_RE = /\b(persistent\s+radicular|radicular\s+pain|radiculopathy|localised?\s+motor\s+weakness|local(?:ised?)?\s+motor\s+weakness)\b/i;

// Compression / burst fracture severity — decomposed into independent checks
// rather than a single brittle regex. The previous combined pattern failed on
// natural phrasings like "compression/burst fracture <25% height loss" because
// (a) the slash broke the (compression|burst)\s+fracture sequence, and
// (b) the trailing \b after "%" never matched (% and following space are both
// non-word, no boundary transition).
function hasFractureMention(text: string): boolean {
  const t = text.toLowerCase();
  // Either (compression|burst) AND fracture appear in any order/separator,
  // or "compression fracture" / "burst fracture" appear as a phrase.
  const hasFractureWord = /\bfractures?\b/.test(t);
  const hasType = /\b(?:compression|burst)\b/.test(t);
  return hasFractureWord && hasType;
}
function hasLt25(text: string): boolean {
  const t = text.toLowerCase();
  return /<\s*25\s*%?/.test(t)
    || /\bless\s+than\s+25\b/.test(t)
    || /\bunder\s+25\b/.test(t)
    || /≤\s*25\s*%?/.test(t);
}
function hasGt25(text: string): boolean {
  const t = text.toLowerCase();
  return />\s*25\s*%?/.test(t)
    || /\bgreater\s+than\s+25\b/.test(t)
    || /\bmore\s+than\s+25\b/.test(t)
    || /≥\s*25\s*%?/.test(t);
}
// Disc severity patterns
const DISC_RESIDUAL_RE          = /\b(residual\s+pain|residual\s+(?:acceptable|minimal)\b|3\.1a\b)\b/i;
const DISC_PERSISTENT_NO_NEURO_RE = /\b(persistent\s+(?:pain|restricted)(?!\s+(?:sensory|motor|neuro))[^.]*(?:restricted\s+motion|no\s+neurological)|3\.1b\b)\b/i;
const DISC_PERSISTENT_SENSORY_RE  = /\b(persistent\s+(?:pain|restricted|sensory)[^.]*(?:sensory\s+)?deficit|persistent\s+sensory\s+deficit|sensory\s+deficit[^.]*persistent|3\.1c\b)\b/i;
const DISC_PERSISTENT_MOTOR_RE    = /\b(persistent\s+(?:pain|restricted)[^.]*motor\s+(?:deficit|weakness)|motor\s+(?:deficit|weakness)[^.]*persistent|3\.1d\b|motor\s+or\s+motor[\s-]sensory)\b/i;
const DISC32_RESIDUAL_RE         = /\b(degenerat(?:ed|ing)\s+disc[^.]*residual|disc\s+degeneration[^.]*residual|3\.2a\b)\b/i;
const DISC32_PERSISTENT_RE       = /\b(degenerat(?:ed|ing)\s+disc[^.]*persistent|disc\s+degeneration[^.]*persistent|3\.2b\b)\b/i;
// Spondylolysis severity patterns
const SPONDY_PRE_RESIDUAL_RE = /\b(pre[-\s]?existing[^.]*(?:spondy|listhesis)[^.]*residual|spondy[^.]*pre[-\s]?existing[^.]*residual)\b/i;
const SPONDY_PRE_CHRONIC_RE  = /\b(pre[-\s]?existing[^.]*(?:spondy|listhesis)[^.]*chronic|spondy[^.]*pre[-\s]?existing[^.]*chronic)\b/i;
// Chronic pain severity
const CHRONIC_ATTRIBUTABLE_RE     = /\b((?:pain\s+)?attributable\s+to|attributable\s+injury|attributable\s+to\s+the\s+injury)\b/i;
const CHRONIC_NOT_ATTRIBUTABLE_RE = /\b(not\s+attributable|non[-\s]?attributable|unrelated\s+pain)\b/i;

const MONOPARESIS_RE  = /\b(monoparesis|one\s+limb\s+(?:only|affected)|single\s+limb\s+affected|unilateral\s+(?:limb|paresis))\b/i;

const BLADDER_BOWEL_MAP: { re: RegExp; key: BladderBowelSeverity }[] = [
  { re: /\bcomplete\s+(?:incontinence\s+)?(?:bladder\s+and\s+bowel|bladder\s*[,&]\s*bowel|bowel\s+and\s+bladder)\b/i, key: "complete_both" },
  { re: /\bincomplete\s+(?:incontinence\s+)?(?:bladder\s+and\s+bowel|bladder\s*[,&]\s*bowel|bowel\s+and\s+bladder)\b/i, key: "incomplete_both" },
  { re: /\bcomplete\s+(?:bladder|bowel)\s+incontinence\b|\bcomplete\s+incontinence\s+(?:bladder|bowel)\b/i, key: "complete_single" },
  { re: /\bincomplete\s+(?:bladder|bowel)\s+incontinence\b|\bincomplete\s+incontinence\s+(?:bladder|bowel)\b/i, key: "incomplete_single" },
];

const CORD_INVOLVEMENT_RE = /\b(cord\s+involvement|myelopathy|cord\s+compression|spinal\s+cord[^)]*involved)\b/i;
const SPONDY_PREEXISTING_RE = /\b(pre[-\s]?existing|chronic\s+spondy|superimposed)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(
  value: T,
  sourceText: string,
  method: ExtractedFact<T>["extractionMethod"] = "regex",
  confidence = 0.9
): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText, confidence, extractionMethod: method, createdAt: now, updatedAt: now };
}

function makeObservation(
  system: GatiodSystemKey,
  type: PendingObservation["type"],
  sourceText: string,
  parsed: Record<string, unknown>,
  missingFields: string[],
  clarificationQuestion: string,
  candidateAnswers: string[]
): PendingObservation {
  const now = nowIso();
  return {
    id: randomUUID(),
    system,
    type,
    sourceText,
    parsed,
    missingFields,
    clarificationQuestion,
    candidateAnswers,
    createdAt: now,
    updatedAt: now,
  };
}

function makeDefaultEntry(diagnosisCategory: DiagnosisCategory): SpineCategoryEntryFact {
  return {
    diagnosisCategory,
    severityKey: "",
    monoparesisHalving: false,
    bladderBowelSeverity: "none",
    discCordInvolvement: false,
    spondylolysisPathway: "acute_traumatic",
  };
}

/**
 * Resolve a spine SeverityKey from free-form text for a given category.
 *
 * SHARED parser: used by both the spine extractor (initial parse from the
 * doctor's first utterance) and the pendingObservationResolver (resolving
 * a chip reply). Maintaining a single matcher prevents the two paths from
 * drifting and creating two distinct ways for the same severity phrasing
 * to fail.
 */
export function resolveSpineSeverityKeyFromText(
  text: string,
  category: DiagnosisCategory,
  _pathway?: SpondylolysisPathway
): SeverityKey | undefined {
  // Section 1/2 shared rows
  if (ASIA_BA_RE.test(text)) return "asia_ba";
  if (ASIA_C_RE.test(text)) return "asia_c";
  if (ASIA_D_RE.test(text)) return "asia_d";
  if (PERSISTENT_RADICULAR_RE.test(text)) return "persistent_radicular";
  if (MILD_NEURO_RE.test(text)) return "mild_sensory_motor";

  if (category === "fractures_dislocations" || category === "spinal_cord_injury") {
    // Decomposed: presence of fracture mention + size threshold.
    // Either order ("compression/burst fracture <25%" or "<25% height loss
    // with residual pain") is accepted as long as both signals appear.
    if (hasFractureMention(text)) {
      if (hasGt25(text)) return "compression_gt25";
      if (hasLt25(text)) return "compression_lt25";
    } else {
      // Fallback: "<25% height loss with residual pain" without the literal
      // word "fracture" — common chip phrasing. The category gate above
      // already restricts this to fracture/cord-injury contexts.
      if (hasGt25(text) && /residual\s+pain|height\s+loss/i.test(text)) return "compression_gt25";
      if (hasLt25(text) && /residual\s+pain|height\s+loss/i.test(text)) return "compression_lt25";
    }
  }

  if (category === "intervertebral_disc") {
    if (DISC32_RESIDUAL_RE.test(text)) return "disc32_residual";
    if (DISC32_PERSISTENT_RE.test(text)) return "disc32_persistent_neuro";
    if (DISC_PERSISTENT_MOTOR_RE.test(text)) return "disc31_persistent_motor_or_motor_sensory";
    if (DISC_PERSISTENT_SENSORY_RE.test(text)) return "disc31_persistent_sensory";
    if (DISC_PERSISTENT_NO_NEURO_RE.test(text)) return "disc31_persistent_no_neuro";
    if (DISC_RESIDUAL_RE.test(text)) return "disc31_residual";
  }

  if (category === "spondylolysis_spondylolisthesis") {
    if (SPONDY_PRE_RESIDUAL_RE.test(text)) return "spondy_preexisting_residual";
    if (SPONDY_PRE_CHRONIC_RE.test(text)) return "spondy_preexisting_chronic";
    // Acute traumatic → use section12Rows; severity extracted above
  }

  if (category === "chronic_pain_normal_mri") {
    if (CHRONIC_NOT_ATTRIBUTABLE_RE.test(text)) return "chronic_pain_not_attributable";
    if (CHRONIC_ATTRIBUTABLE_RE.test(text)) return "chronic_pain_attributable";
  }

  return undefined;
}

/** @deprecated kept for internal callers; prefer resolveSpineSeverityKeyFromText. */
function extractSeverityKey(text: string, category: DiagnosisCategory): SeverityKey | undefined {
  return resolveSpineSeverityKeyFromText(text, category);
}

function severityChipsForCategory(category: DiagnosisCategory, pathway?: SpondylolysisPathway): string[] {
  const opts = getSeveritiesForCategory(category, { spondylolysisPathway: pathway ?? "acute_traumatic" });
  return opts.map((o) => o.label);
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractSpine(
  utterance: NormalizedUtterance,
  currentSystemState: V2SystemState,
  _ontologyMatches: OntologyMatch[] = [],
  extractionContext?: ExtractionContext,
): StructuredExtractionResult {
  // REQ-SC-SPINE-001 / REQ-SC-SPINE-002 — when the doctor selected one
  // spine region from a multi-region semantic proposal, the orchestrator
  // passes the chosen region's source spans here. We narrow the parsing
  // input to those spans only — the hard multi-region guard still runs
  // (it can't know the doctor already picked a region), so the narrowed
  // text MUST contain only one region.
  const useSelectedScope =
    extractionContext?.selectedScope?.system === "spine" &&
    Array.isArray(extractionContext.selectedScope.sourceSpans) &&
    extractionContext.selectedScope.sourceSpans.length > 0;

  const text = useSelectedScope
    ? extractionContext!.selectedScope!.sourceSpans.join(" ; ")
    : utterance.normalizedText;
  const raw = useSelectedScope
    ? extractionContext!.selectedScope!.sourceSpans.join(" ; ")
    : utterance.raw;
  const existingFacts = currentSystemState.extractedFacts;

  const factsPatch: V2SystemFacts = {};
  const pendingToAdd: PendingObservation[] = [];
  const pendingToResolve: string[] = [];
  const slotSignalsPatch: Partial<SlotSignals> = {};
  const displayValuesPatch: Record<string, string> = {};
  const warnings: string[] = [];
  const auditEvents: ExtractionAuditEvent[] = [];

  // ── Multi-region safe-fail guard (ADR-0001) ───────────────────────────────
  // Spine v1 supports a single region per assessment. If the doctor mentions
  // findings in more than one region in the same utterance, OR mentions a
  // different region than the one already captured, refuse to write region
  // or entry facts and surface a clarification. Silently overwriting the
  // existing region (or picking the first match and dropping the rest) is a
  // zero-tolerance failure under ADR-0001.
  const detectedRegions = detectSpineRegions(text);
  const existingRegion = (existingFacts[SP_FK_REGION]?.value ?? undefined) as SpinalRegion | undefined;

  const multiRegionInUtterance = detectedRegions.length > 1;
  const crossUtteranceConflict =
    !!existingRegion && detectedRegions.length === 1 && detectedRegions[0] !== existingRegion;

  if (multiRegionInUtterance || crossUtteranceConflict) {
    const action = multiRegionInUtterance ? "blocked_multi_region_utterance" : "blocked_overwrite";
    const allDetected = multiRegionInUtterance
      ? detectedRegions
      : (existingRegion ? [existingRegion, detectedRegions[0]] : detectedRegions);
    const labelList = allDetected.map((r) => `- ${REGION_LABELS[r]}`).join("\n");

    let clarificationQuestion: string;
    let candidateAnswers: string[];
    if (multiRegionInUtterance) {
      clarificationQuestion =
        `I detected spine findings in more than one spinal region:\n${labelList}\n\n` +
        `Multi-region spine assessment is not yet supported in V2. ` +
        `Please assess one spine region at a time. Which region should I assess first?`;
      candidateAnswers = detectedRegions.map((r) => REGION_LABELS[r]);
    } else {
      const existingLabel = REGION_LABELS[existingRegion!];
      const newLabel = REGION_LABELS[detectedRegions[0]];
      clarificationQuestion =
        `You already have an active ${existingLabel} spine assessment. ` +
        `I also detected a ${newLabel} spine finding. ` +
        `Multi-region spine assessment is not yet supported in V2. ` +
        `Please complete or clear the current spine assessment before assessing another spine region.`;
      // Only offer a chip that preserves existing work — the doctor can clear
      // the current assessment manually if they want to switch regions.
      candidateAnswers = [`Continue with ${existingLabel} assessment`];
    }

    pendingToAdd.push(
      makeObservation(
        "spine",
        "other",
        raw,
        {
          subtype: SPINE_MULTI_REGION_AUDIT_EVENT,
          existingRegion,
          detectedRegions,
          action,
        },
        ["spine_region_choice"],
        clarificationQuestion,
        candidateAnswers,
      ),
    );

    auditEvents.push({
      eventType: SPINE_MULTI_REGION_AUDIT_EVENT,
      payload: {
        existingRegion,
        detectedRegions,
        sourceText: raw,
        action,
        userFacingMessage: clarificationQuestion,
      },
    });

    warnings.push(
      `${SPINE_MULTI_REGION_AUDIT_EVENT}: ${action} (existing=${existingRegion ?? "none"}, detected=[${detectedRegions.join(",")}])`,
    );

    return {
      extractedFactsPatch: factsPatch,        // empty — do NOT write region or entries
      pendingObservationsToAdd: pendingToAdd,
      pendingObservationsToResolve: pendingToResolve,
      slotSignalsPatch,
      displayValuesPatch,
      warnings,
      auditEvents,
    };
  }

  // ── Region ────────────────────────────────────────────────────────────────
  let detectedRegion: SpinalRegion | undefined;
  if (REGION_CERVICAL_RE.test(text)) {
    detectedRegion = "cervical";
  } else if (REGION_THORACO_RE.test(text)) {
    detectedRegion = "thoraco_lumbar";
  } else if (REGION_LUMBO_RE.test(text)) {
    detectedRegion = "lumbo_sacral";
  }

  if (detectedRegion) {
    factsPatch[SP_FK_REGION] = makeFact(detectedRegion, raw);
    slotSignalsPatch.region = true;
    displayValuesPatch.spine_region = detectedRegion;
  }

  const effectiveRegion = (detectedRegion ?? existingFacts[SP_FK_REGION]?.value) as SpinalRegion | undefined;

  // ── Categories detected in this utterance ─────────────────────────────────
  const detectedCategories: DiagnosisCategory[] = [];
  if (CATEGORY_CORD_RE.test(text)) detectedCategories.push("spinal_cord_injury");
  if (CATEGORY_FRACTURE_RE.test(text) && !detectedCategories.includes("spinal_cord_injury")) {
    detectedCategories.push("fractures_dislocations");
  }
  if (CATEGORY_DISC_RE.test(text)) detectedCategories.push("intervertebral_disc");
  if (CATEGORY_SPONDY_RE.test(text)) detectedCategories.push("spondylolysis_spondylolisthesis");
  if (CATEGORY_CHRONIC_RE.test(text)) detectedCategories.push("chronic_pain_normal_mri");

  if (detectedCategories.length > 0) {
    slotSignalsPatch.diagnosis_category = true;

    // Load existing entries to merge
    const existingEntries = (existingFacts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];
    let updatedEntries = [...existingEntries];

    for (const category of detectedCategories) {
      const existingIdx = updatedEntries.findIndex((e) => e.diagnosisCategory === category);
      const base: SpineCategoryEntryFact =
        existingIdx >= 0 ? { ...updatedEntries[existingIdx] } : makeDefaultEntry(category);

      // Determine spondylolysis pathway early (affects severity chips)
      if (category === "spondylolysis_spondylolisthesis") {
        if (SPONDY_PREEXISTING_RE.test(text)) {
          base.spondylolysisPathway = "pre_existing_superimposed";
        }
      }

      // Try to extract severity
      const severityKey = extractSeverityKey(text, category);

      // Apply modifiers if severity present or already set
      if (MONOPARESIS_RE.test(text)) base.monoparesisHalving = true;

      let bladderBowelSeverity: BladderBowelSeverity = base.bladderBowelSeverity;
      for (const { re, key } of BLADDER_BOWEL_MAP) {
        if (re.test(text)) { bladderBowelSeverity = key; break; }
      }
      base.bladderBowelSeverity = bladderBowelSeverity;

      if (category === "intervertebral_disc" && CORD_INVOLVEMENT_RE.test(text)) {
        base.discCordInvolvement = true;
      }

      if (severityKey) {
        base.severityKey = severityKey;
        slotSignalsPatch.severity_key = true;
        displayValuesPatch[`severity_${category}`] = severityKey;

        // Graduated entry: replace or insert
        if (existingIdx >= 0) updatedEntries[existingIdx] = base;
        else updatedEntries.push(base);
      } else if (!base.severityKey) {
        // No severity in this utterance and none previously → pending obs
        if (!effectiveRegion) {
          // Need region before we can offer correct severity chips
          pendingToAdd.push(
            makeObservation(
              "spine",
              "other",
              raw,
              { subtype: "spine_region", partialCategory: category },
              ["spine_region"],
              "Which spinal region is affected?",
              ["Cervical (C1–C7)", "Thoraco-Lumbar (T1–L1)", "Lumbo-Sacral (L2–S1)"]
            )
          );
        } else {
          const chips = severityChipsForCategory(
            category,
            category === "spondylolysis_spondylolisthesis" ? base.spondylolysisPathway : undefined
          );
          pendingToAdd.push(
            makeObservation(
              "spine",
              "severity_bracket",
              raw,
              {
                diagnosisCategory: category,
                partialEntry: base,
                region: effectiveRegion,
              },
              ["severityKey"],
              `For the ${category.replace(/_/g, " ")} diagnosis, which severity row applies?`,
              chips
            )
          );
        }

        // Partial entry: update existing but keep severityKey="" (do not push as new)
        if (existingIdx >= 0) updatedEntries[existingIdx] = base;
        // Don't add to entries without a severity key — will be added on resolution
        continue;
      } else {
        // severityKey already set in existing entry; apply modifier updates
        if (existingIdx >= 0) updatedEntries[existingIdx] = base;
      }
    }

    if (updatedEntries.some((e) => e.severityKey !== "")) {
      factsPatch[SP_FK_ENTRIES] = makeFact(
        updatedEntries.filter((e) => e.severityKey !== ""),
        raw
      );
    }
  }

  // ── Modifier-only utterances (update most recent entry) ───────────────────
  // When doctor answers a modifier question without re-stating the category
  if (detectedCategories.length === 0) {
    const existingEntries = (existingFacts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];
    if (existingEntries.length > 0) {
      let changed = false;
      const updated = existingEntries.map((entry) => {
        const e = { ...entry };
        if (MONOPARESIS_RE.test(text)) { e.monoparesisHalving = true; changed = true; }
        for (const { re, key } of BLADDER_BOWEL_MAP) {
          if (re.test(text)) { e.bladderBowelSeverity = key; changed = true; break; }
        }
        if (entry.diagnosisCategory === "intervertebral_disc" && CORD_INVOLVEMENT_RE.test(text)) {
          e.discCordInvolvement = true; changed = true;
        }
        return e;
      });
      if (changed) {
        factsPatch[SP_FK_ENTRIES] = makeFact(updated, raw);
      }
    }
  }

  return {
    extractedFactsPatch: factsPatch,
    pendingObservationsToAdd: pendingToAdd,
    pendingObservationsToResolve: pendingToResolve,
    slotSignalsPatch,
    displayValuesPatch,
    warnings,
  };
}
