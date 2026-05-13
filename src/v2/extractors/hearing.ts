import { randomUUID } from "crypto";
import type {
  ExtractedFact,
  NormalizedUtterance,
  PendingObservation,
  StructuredExtractionResult,
  V2SystemFacts,
  V2SystemState,
} from "../contracts.js";
import { makeInstanceId } from "../assessmentInstanceRules.js";

// ── Fact key constants ────────────────────────────────────────────────────────

export const HEARING_FK_PATH               = "hearing_path";
export const HEARING_FK_LEFT_EAR_AHL       = "hearing_left_ear_ahl";
export const HEARING_FK_RIGHT_EAR_AHL      = "hearing_right_ear_ahl";
export const HEARING_FK_AGE                = "hearing_age";
export const HEARING_FK_AFFECTED_EARS      = "hearing_affected_ears";
export const HEARING_FK_OCCUPATIONAL_YEARS = "hearing_occupational_years";
export const HEARING_FK_TINNITUS           = "hearing_tinnitus";

// ── Pattern tables ────────────────────────────────────────────────────────────

const NID_RE    = /\b(noise[\s-]?induced|nid\b|occupational\s+(?:deafness|hearing\s+loss|noise)|noise\s+(?:exposure|damage|trauma))\b/i;
const INJURY_RE = /\b(injury|accident|trauma(?:tic)?|blast|head\s+injury|perforat(?:ion|ed)|barotrauma)\b/i;

// AHL in dB: "left ear 65 dB", "left AHL 65", "left 65 dB"
const LEFT_AHL_RE  = /\bleft\s+(?:ear\s+)?(?:ahl\b|hearing\s+loss|average\s+hearing)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:db|dB)?\b/i;
const RIGHT_AHL_RE = /\bright\s+(?:ear\s+)?(?:ahl\b|hearing\s+loss|average\s+hearing)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:db|dB)?\b/i;

// Age: "age 55", "55 years old", "55 yo"
const AGE_RE = /\bage\s*[:=]?\s*(\d{1,3})\b|\b(\d{2,3})\s*(?:years?\s+old|y\/o|yo)\b/i;

// Affected ears for injury
// Affected-ear phrasings. Issue #12, RC-7: extend beyond the original
// "left ear / left side / left hearing" baseline to natural workbook
// variants — "left-sided", "on the left", "in the left ear", etc. The
// alternations are split out as constants for readability.
//
// Patterns covered:
//   - "left ear" / "right side" / "left hearing"             (baseline)
//   - "left-sided" / "right-sided"                            (hyphen)
//   - "in the left ear" / "in the right ear"                  (positional)
//   - "on the left" / "on the right" (with later "ear"/"hearing" context)
const AFFECTED_LEFT_RE  =
  /\bleft\s+(?:ear|side|hearing)\b|\bleft-sided\b|\bin\s+the\s+left(?:\s+ear)?\b|\bon\s+the\s+left\b/i;
const AFFECTED_RIGHT_RE =
  /\bright\s+(?:ear|side|hearing)\b|\bright-sided\b|\bin\s+the\s+right(?:\s+ear)?\b|\bon\s+the\s+right\b/i;

// Occupational exposure years: "25 years exposure", "exposed 20 years"
const OCC_YEARS_RE = /\b(\d+)\s*years?\s+(?:of\s+)?(?:occupational\s+)?(?:noise\s+)?exposure\b|\bexposed\s+(?:for\s+)?(\d+)\s*years?\b/i;

// Tinnitus
const TINNITUS_RE = /\b(tinnitus|ringing\s+in\s+(?:the\s+)?ears?|ear\s+ringing|buzzing\s+in\s+ears?)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function makeFact<T>(value: T, text: string): ExtractedFact<T> {
  const now = nowIso();
  return { value, sourceText: text, confidence: 0.9, extractionMethod: "regex", createdAt: now, updatedAt: now };
}

/**
 * Compute the instanceId for a resolved hearing state.
 * Returns undefined if path or (for injury) affected ear is not yet known.
 */
function resolveInstanceId(
  path: "nid" | "injury" | undefined,
  affectedEar: "left" | "right" | undefined
): string | undefined {
  if (path === "nid") return makeInstanceId("hearing", "global");
  if (path === "injury" && affectedEar) return makeInstanceId("hearing", `${affectedEar}_ear`);
  return undefined;
}

/**
 * Scope a facts patch to only include facts that belong to a specific
 * hearing instance. Prevents cross-ear contamination.
 *
 * - hearing::global (NID): all facts valid — no scoping needed
 * - hearing::left_ear (injury): strip right-ear AHL
 * - hearing::right_ear (injury): strip left-ear AHL
 */
function scopeFactsToInstance(
  patch: V2SystemFacts,
  display: Record<string, string>,
  signals: Partial<import("../contracts.js").SlotSignals>,
  instanceId: string
): void {
  if (instanceId === makeInstanceId("hearing", "right_ear")) {
    delete patch[HEARING_FK_LEFT_EAR_AHL];
    delete display["left_ear_ahl"];
    delete signals.leftEarAhl;
  } else if (instanceId === makeInstanceId("hearing", "left_ear")) {
    delete patch[HEARING_FK_RIGHT_EAR_AHL];
    delete display["right_ear_ahl"];
    delete signals.rightEarAhl;
  }
  // hearing::global keeps everything
}

// ── Main extractor ────────────────────────────────────────────────────────────

export function extractHearing(
  utterance: NormalizedUtterance,
  systemState: V2SystemState
): StructuredExtractionResult {
  const text = utterance.normalizedText;
  const src  = utterance.raw;
  const ef   = systemState.extractedFacts;
  const patch: V2SystemFacts = {};
  const pending: PendingObservation[] = [];
  const signals: Partial<import("../contracts.js").SlotSignals> = {};
  const display: Record<string, string> = {};

  // ── Tinnitus ──────────────────────────────────────────────────────────────
  if (TINNITUS_RE.test(text)) {
    patch[HEARING_FK_TINNITUS] = makeFact(true, src);
    signals.tinnitus_mentioned = true;
    display["tinnitus"] = "yes";
  }

  // ── Path detection ────────────────────────────────────────────────────────
  let detectedPath: "nid" | "injury" | undefined;
  if      (NID_RE.test(text))    detectedPath = "nid";
  else if (INJURY_RE.test(text)) detectedPath = "injury";

  if (detectedPath) {
    patch[HEARING_FK_PATH] = makeFact(detectedPath, src);
    signals.path = true;
    display["path"] = detectedPath;
  }

  const currentPath = (patch[HEARING_FK_PATH] ?? ef[HEARING_FK_PATH])?.value as "nid" | "injury" | undefined;

  if (!currentPath) {
    pending.push({
      id: randomUUID(),
      system: "hearing",
      type: "hearing_value",
      sourceText: src,
      parsed: { subtype: "hearing_path" },
      missingFields: ["path"],
      clarificationQuestion: "Is this noise-induced deafness (NID) or injury/accident hearing loss?",
      candidateAnswers: ["Noise-Induced Deafness (NID)", "Injury/Accident"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    // instanceId undefined: path not yet known, no instance to target
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: display, warnings: [] };
  }

  // ── AHL values (both paths capture here; scoped to instance at end) ───────
  const leftMatch  = LEFT_AHL_RE.exec(text);
  const rightMatch = RIGHT_AHL_RE.exec(text);

  if (leftMatch?.[1]) {
    const ahl = parseFloat(leftMatch[1]);
    patch[HEARING_FK_LEFT_EAR_AHL] = makeFact(ahl, src);
    signals.leftEarAhl = true;
    display["left_ear_ahl"] = `${ahl} dB`;
  }
  if (rightMatch?.[1]) {
    const ahl = parseFloat(rightMatch[1]);
    patch[HEARING_FK_RIGHT_EAR_AHL] = makeFact(ahl, src);
    signals.rightEarAhl = true;
    display["right_ear_ahl"] = `${ahl} dB`;
  }

  // ── NID path ──────────────────────────────────────────────────────────────
  if (currentPath === "nid") {
    const ageMatch = AGE_RE.exec(text);
    if (ageMatch) {
      const age = parseInt(ageMatch[1] ?? ageMatch[2], 10);
      patch[HEARING_FK_AGE] = makeFact(age, src);
      signals.age = true;
      display["age"] = String(age);
    }

    const occMatch = OCC_YEARS_RE.exec(text);
    if (occMatch) {
      const years = parseInt(occMatch[1] ?? occMatch[2], 10);
      patch[HEARING_FK_OCCUPATIONAL_YEARS] = makeFact(years, src);
      display["occupational_years"] = String(years);
    }

    const hasLeft  = Boolean(patch[HEARING_FK_LEFT_EAR_AHL]  ?? ef[HEARING_FK_LEFT_EAR_AHL]);
    const hasRight = Boolean(patch[HEARING_FK_RIGHT_EAR_AHL] ?? ef[HEARING_FK_RIGHT_EAR_AHL]);
    const hasAge   = Boolean(patch[HEARING_FK_AGE]            ?? ef[HEARING_FK_AGE]);

    if (!hasLeft || !hasRight) {
      const which = !hasLeft && !hasRight ? "both ears" : !hasLeft ? "left ear" : "right ear";
      pending.push({
        id: randomUUID(),
        system: "hearing",
        type: "hearing_value",
        sourceText: src,
        parsed: { subtype: "hearing_ahl", missingEar: !hasLeft && !hasRight ? "both" : !hasLeft ? "left" : "right" },
        missingFields: ["leftEarAhl", "rightEarAhl"].filter((_, i) => i === 0 ? !hasLeft : !hasRight),
        clarificationQuestion: `Please provide the average hearing loss (AHL) in dB for the ${which}.`,
        candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    } else if (!hasAge) {
      pending.push({
        id: randomUUID(),
        system: "hearing",
        type: "hearing_value",
        sourceText: src,
        parsed: { subtype: "hearing_age" },
        missingFields: ["age"],
        clarificationQuestion: "What is the patient's age? (Required for presbycusis deduction.)",
        candidateAnswers: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }

    // NID always targets hearing::global — no scoping needed
    return {
      extractedFactsPatch: patch,
      pendingObservationsToAdd: pending,
      pendingObservationsToResolve: [],
      slotSignalsPatch: signals,
      displayValuesPatch: display,
      warnings: [],
      instanceId: makeInstanceId("hearing", "global"),
    };
  }

  // ── Injury/Accident path ──────────────────────────────────────────────────
  let affectedEars: "left" | "right" | undefined;
  if      (AFFECTED_LEFT_RE.test(text))  affectedEars = "left";
  else if (AFFECTED_RIGHT_RE.test(text)) affectedEars = "right";

  if (affectedEars) {
    patch[HEARING_FK_AFFECTED_EARS] = makeFact(affectedEars, src);
    signals.affectedEars = true;
    display["affected_ears"] = affectedEars;
  } else if (!ef[HEARING_FK_AFFECTED_EARS]) {
    pending.push({
      id: randomUUID(),
      system: "hearing",
      type: "hearing_value",
      sourceText: src,
      parsed: { subtype: "hearing_affected_ear" },
      missingFields: ["affectedEars"],
      clarificationQuestion: "Which ear is affected by the injury?",
      candidateAnswers: ["Left ear", "Right ear"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    // instanceId undefined: affected ear not yet known, no instance to target
    return { extractedFactsPatch: patch, pendingObservationsToAdd: pending, pendingObservationsToResolve: [], slotSignalsPatch: signals, displayValuesPatch: display, warnings: [] };
  }

  const ear = (patch[HEARING_FK_AFFECTED_EARS] ?? ef[HEARING_FK_AFFECTED_EARS])?.value as "left" | "right" | undefined;
  if (ear) {
    const ahlKey = ear === "left" ? HEARING_FK_LEFT_EAR_AHL : HEARING_FK_RIGHT_EAR_AHL;

    // Bind a generic "AHL X dB" to the known affected ear when directional regex
    // didn't match (e.g. "Right ear … AHL 90 dB" with intervening text).
    if (!patch[ahlKey] && !ef[ahlKey]) {
      const GENERIC_AHL_RE = /\bAHL\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:dB|db)?\b/i;
      const genericMatch = GENERIC_AHL_RE.exec(text);
      if (genericMatch?.[1]) {
        const ahl = parseFloat(genericMatch[1]);
        patch[ahlKey] = makeFact(ahl, src);
        if (ear === "right") {
          signals.rightEarAhl = true;
          display["right_ear_ahl"] = `${ahl} dB`;
        } else {
          signals.leftEarAhl = true;
          display["left_ear_ahl"] = `${ahl} dB`;
        }
      }
    }

    if (!patch[ahlKey] && !ef[ahlKey]) {
      pending.push({
        id: randomUUID(),
        system: "hearing",
        type: "hearing_value",
        sourceText: src,
        parsed: { subtype: "hearing_ahl", missingEar: ear },
        missingFields: [ear === "left" ? "leftEarAhl" : "rightEarAhl"],
        clarificationQuestion: `Please provide the AHL in dB for the ${ear} ear.`,
        candidateAnswers: ["50 dB", "55 dB", "60 dB", "65 dB", "70 dB", "75 dB", "80 dB", "85 dB", "90 dB"],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
  }

  // Resolve instanceId for injury path and scope facts to the specific ear instance.
  // This prevents the other ear's AHL from leaking into a single-ear instance.
  const instanceId = resolveInstanceId("injury", ear);
  if (instanceId) scopeFactsToInstance(patch, display, signals, instanceId);

  return {
    extractedFactsPatch: patch,
    pendingObservationsToAdd: pending,
    pendingObservationsToResolve: [],
    slotSignalsPatch: signals,
    displayValuesPatch: display,
    warnings: [],
    instanceId,
  };
}
