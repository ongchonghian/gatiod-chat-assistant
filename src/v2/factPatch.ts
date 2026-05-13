import type { SlotSignals } from "./contracts.js";
import { extractValues } from "./slotEvaluator.js";
import type { NormalizedUtterance } from "./contracts.js";

/**
 * Describes changes to apply to a system's slot state after a correction.
 */
export interface FactPatch {
  /** Updated extracted values (override existing). */
  updatedValues: Record<string, string>;
  /** Signal keys to clear (set to undefined) — forces the slot to be re-asked. */
  signalsToClear: (keyof SlotSignals)[];
}

// Patterns that indicate the user is correcting a previous fact
const CORRECTION_RE = /\b(actually|correction:?|i\s+meant|not\s+\w+\s+but|change\s+.+\s+to|no\s+wait|sorry,?\s+i?\s+meant|right\s+side\s+not|left\s+side\s+not|was\s+actually)\b/i;

// Patterns for explicit negations of finding types
const NEGATE_NERVE_RE = /\b(no|without|negative|absent)\s+(nerve|neurological|neuropathy|palsy)\b/i;
const NEGATE_AMP_RE = /\b(no|without)\s+(amputation|amp\b)/i;
const NEGATE_DBE_RE = /\b(no|without|negative)\s+(dbe|diagnosis.?based|fracture|instability|oa|osteoarthritis)\b/i;
const NEGATE_ROM_RE = /\b(no\s+(restricted\s+)?motion|full\s+(range\s+of\s+)?motion|normal\s+rom)\b/i;

const SIDE_SWAP_RE = /\b(actually\s+)?(right|left)\s+(side|limb|arm|leg|eye|ear)?\b/i;

/**
 * Returns true if the utterance appears to be a correction to previously
 * stated facts (rather than new information or a confirmation).
 */
export function isCorrection(utterance: NormalizedUtterance): boolean {
  const text = utterance.normalizedText;
  if (CORRECTION_RE.test(text)) return true;

  // Side swap without correction keyword (e.g., "right side" when left was set)
  // Detected externally by comparing against extractedValues.side
  return false;
}

/**
 * Returns true if the utterance is a confirmation of the pending summary.
 * Detects "confirm", "yes", "proceed", "Confirm and calculate" chip.
 */
export function isConfirmation(utterance: NormalizedUtterance): boolean {
  const text = utterance.normalizedText.trim().toLowerCase();
  return /^(confirm(ed)?|yes|y\b|ok|okay|proceed|correct|calculate|confirm\s+and\s+calculate|go\s+ahead)/.test(text);
}

/**
 * Returns true if the utterance is a request to edit / go back.
 */
export function isEditRequest(utterance: NormalizedUtterance): boolean {
  const text = utterance.normalizedText.trim().toLowerCase();
  return /^(edit|no\b|change|wrong|incorrect|not\s+right|not\s+correct|actually|correction|revise|update\s+findings?)/.test(text);
}

/**
 * Given a correction utterance and the current extracted values + signals,
 * produces a FactPatch describing what to update.
 *
 * Strategy:
 * 1. Re-extract values from the correction utterance.
 * 2. Detect explicit negations (override values with "none").
 * 3. If a value changed from what we had, note the signal to optionally clear.
 */
export function buildFactPatch(
  utterance: NormalizedUtterance,
  currentValues: Record<string, string>,
  _currentSignals: Partial<SlotSignals>
): FactPatch {
  const text = utterance.normalizedText;
  const newValues = extractValues(utterance);
  const updatedValues: Record<string, string> = {};
  const signalsToClear: (keyof SlotSignals)[] = [];

  // Side correction
  const sideMatch = SIDE_SWAP_RE.exec(text);
  if (sideMatch) {
    const newSide = sideMatch[2].toLowerCase();
    if (currentValues.side && currentValues.side !== newSide) {
      updatedValues.side = newSide;
    } else if (!currentValues.side) {
      updatedValues.side = newSide;
    }
  }

  // ROM readings correction — replace if new readings detected
  if (newValues.rom_readings) {
    updatedValues.rom_readings = newValues.rom_readings;
    updatedValues.rom_measurements = "updated";
  }

  // Joint correction
  if (newValues.rom_joint && newValues.rom_joint !== currentValues.rom_joint) {
    updatedValues.rom_joint = newValues.rom_joint;
  }

  // Nerve negation
  if (NEGATE_NERVE_RE.test(text)) {
    updatedValues.nerve_present = "none";
    updatedValues.nerve_details = "none";
    // Clear rom_from_nerve since there's no nerve
    signalsToClear.push("rom_from_nerve");
  } else if (newValues.nerve_name) {
    updatedValues.nerve_name = newValues.nerve_name;
    if (newValues.nerve_deficit) updatedValues.nerve_deficit = newValues.nerve_deficit;
    if (newValues.nerve_loss) updatedValues.nerve_loss = newValues.nerve_loss;
  }

  // Amputation negation
  if (NEGATE_AMP_RE.test(text)) {
    updatedValues.amputation_present = "none";
  }

  // DBE negation
  if (NEGATE_DBE_RE.test(text)) {
    updatedValues.dbe_present = "none";
  }

  // ROM negation (e.g. user initially mentioned ROM but it was wrong)
  if (NEGATE_ROM_RE.test(text)) {
    updatedValues.rom_readings = "none";
    signalsToClear.push("rom_measurements");
    signalsToClear.push("ankylosis_flag");
    signalsToClear.push("rom_from_nerve");
  }

  // rom_from_nerve correction
  if (newValues.rom_from_nerve) {
    updatedValues.rom_from_nerve = newValues.rom_from_nerve;
  }

  // Spine corrections
  if (newValues.region && newValues.region !== currentValues.region) {
    updatedValues.region = newValues.region;
  }
  if (newValues.diagnosis_category && newValues.diagnosis_category !== currentValues.diagnosis_category) {
    updatedValues.diagnosis_category = newValues.diagnosis_category;
    signalsToClear.push("severity_key");
    signalsToClear.push("fracture_height_loss");
  }
  if (newValues.asia_grade && newValues.asia_grade !== currentValues.asia_grade) {
    updatedValues.asia_grade = newValues.asia_grade;
    signalsToClear.push("monoparesis_gate");
  }

  // Shortening correction
  if (newValues.shortening_cm) {
    updatedValues.shortening_cm = newValues.shortening_cm;
  }

  // "No other findings" — negate all optional finding streams
  if (/\bno\s+other\s+findings?\b/i.test(text)) {
    updatedValues.nerve_present = updatedValues.nerve_present ?? currentValues.nerve_present ?? "none";
    updatedValues.amputation_present = updatedValues.amputation_present ?? currentValues.amputation_present ?? "none";
    updatedValues.dbe_present = updatedValues.dbe_present ?? currentValues.dbe_present ?? "none";
  }

  return { updatedValues, signalsToClear };
}

/**
 * Apply a FactPatch to the current signal map.
 * Clears specified signal keys to force re-asking those slots.
 */
export function applySignalClear(
  signals: Partial<SlotSignals>,
  toClear: (keyof SlotSignals)[]
): Partial<SlotSignals> {
  if (toClear.length === 0) return signals;
  const next = { ...signals };
  for (const key of toClear) {
    delete next[key];
  }
  return next;
}
