/**
 * GATIOD Chapter 9 — Hearing Assessment
 * Pure calculation logic for Noise Induced Deafness (NID) and Injury/Accident paths.
 * All percentages and thresholds sourced from the Sixth Edition GATIOD.
 */

import { z } from "zod";

// ─── Mapping Matrix ───────────────────────────────────────────────────────────

export interface DbMapping {
  /** Average Hearing Loss in dB */
  dB: number;
  /** NID % incapacity (better ear) */
  nidPercent: number;
  /** Injury/Accident % incapacity (affected ear) */
  injuryPercent: number;
}

export const DB_MAPPING_TABLE: DbMapping[] = [
  { dB: 50, nidPercent: 5, injuryPercent: 3 },
  { dB: 55, nidPercent: 10, injuryPercent: 5 },
  { dB: 60, nidPercent: 15, injuryPercent: 8 },
  { dB: 65, nidPercent: 20, injuryPercent: 10 },
  { dB: 70, nidPercent: 25, injuryPercent: 13 },
  { dB: 75, nidPercent: 30, injuryPercent: 15 },
  { dB: 80, nidPercent: 40, injuryPercent: 20 },
  { dB: 85, nidPercent: 50, injuryPercent: 25 },
  { dB: 90, nidPercent: 60, injuryPercent: 30 },
];

export const HEARING_DB_STEP = 5;
export const HEARING_DB_MIN_THRESHOLD = 50;
export const HEARING_DB_MAX_THRESHOLD = 90;

/**
 * Hearing table uses discrete threshold rows.
 * - AHL < 50 dB => 0%
 * - AHL >= 90 dB => capped at 90 dB row
 * - 50 <= AHL < 90 => snapped down to the nearest 5 dB row
 *
 * This avoids implicit linear interpolation between rows.
 */
export function interpolatePercent(
  ahlDb: number,
  path: "nid" | "injury"
): number {
  if (ahlDb < HEARING_DB_MIN_THRESHOLD) return 0;

  let rowDb = HEARING_DB_MAX_THRESHOLD;
  if (ahlDb < HEARING_DB_MAX_THRESHOLD) {
    rowDb = Math.floor(ahlDb / HEARING_DB_STEP) * HEARING_DB_STEP;
  }

  const row = DB_MAPPING_TABLE.find((entry) => entry.dB === rowDb);
  if (!row) return 0;
  return path === "nid" ? row.nidPercent : row.injuryPercent;
}

// ─── Presbycusis Modifier ─────────────────────────────────────────────────────

/**
 * For NID: subtract 0.5% for each year of age above 50.
 * Returns the deduction amount (always >= 0).
 */
export function presbycusisDeduction(age: number): number {
  if (age <= 50) return 0;
  return (age - 50) * 0.5;
}

// ─── Path A: Noise Induced Deafness ───────────────────────────────────────────

export interface NidInput {
  leftEarAhl: number;
  rightEarAhl: number;
  age: number;
  /** Optional: years of occupational noise exposure. Used for NID classification confirmation only — does not affect PI calculation. */
  occupationalExposureYears?: number;
}

export interface NidResult {
  betterEar: "left" | "right";
  betterEarAhl: number;
  isEarlyNid: boolean;
  basePercent: number;
  presbycusisDeduction: number;
  finalPercent: number;
}

export function calculateNid(input: NidInput): NidResult {
  const betterEar: "left" | "right" =
    input.leftEarAhl <= input.rightEarAhl ? "left" : "right";
  const betterEarAhl =
    betterEar === "left" ? input.leftEarAhl : input.rightEarAhl;

  if (betterEarAhl < 50) {
    return {
      betterEar,
      betterEarAhl,
      isEarlyNid: true,
      basePercent: 0,
      presbycusisDeduction: 0,
      finalPercent: 0,
    };
  }

  const basePercent = interpolatePercent(betterEarAhl, "nid");
  const deduction = presbycusisDeduction(input.age);
  const finalPercent = Math.max(0, Math.round((basePercent - deduction) * 10) / 10);

  return {
    betterEar,
    betterEarAhl,
    isEarlyNid: false,
    basePercent,
    presbycusisDeduction: deduction,
    finalPercent,
  };
}

// ─── Path B: Injury / Accident ────────────────────────────────────────────────

export type AffectedEars = "left" | "right";

export interface InjuryInput {
  affectedEars: AffectedEars;
  leftEarAhl?: number;
  rightEarAhl?: number;
}

export interface InjuryResult {
  leftPercent: number;
  rightPercent: number;
  /** Single-instance PI (one affected ear per instance in routing model). */
  finalPercent: number;
}

export function calculateInjury(input: InjuryInput): InjuryResult {
  let leftPercent = 0;
  let rightPercent = 0;

  if (input.affectedEars === "left" && input.leftEarAhl !== undefined) {
    leftPercent = interpolatePercent(input.leftEarAhl, "injury");
  }

  if (input.affectedEars === "right" && input.rightEarAhl !== undefined) {
    rightPercent = interpolatePercent(input.rightEarAhl, "injury");
  }

  return {
    leftPercent,
    rightPercent,
    finalPercent: Math.round((leftPercent + rightPercent) * 10) / 10,
  };
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const hearingValueSchema = z.discriminatedUnion("path", [
  z.object({
    path: z.literal("nid"),
    leftEarAhl: z.number().min(0).max(120),
    rightEarAhl: z.number().min(0).max(120),
    age: z.number().min(18).max(120),
    occupationalExposureYears: z.number().min(0).max(60).optional(),
  }),
  z.object({
    path: z.literal("injury"),
    affectedEars: z.enum(["left", "right"]),
    leftEarAhl: z.number().min(0).max(120).optional(),
    rightEarAhl: z.number().min(0).max(120).optional(),
  }),
]);

export type HearingValue = z.infer<typeof hearingValueSchema>;

export type HearingResult = NidResult | InjuryResult;

export function calculateHearing(value: HearingValue): HearingResult {
  if (value.path === "nid") {
    return calculateNid({
      leftEarAhl: value.leftEarAhl,
      rightEarAhl: value.rightEarAhl,
      age: value.age,
    });
  }
  return calculateInjury({
    affectedEars: value.affectedEars,
    leftEarAhl: value.leftEarAhl,
    rightEarAhl: value.rightEarAhl,
  });
}
