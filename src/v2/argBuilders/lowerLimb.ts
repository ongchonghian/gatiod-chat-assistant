import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import {
  LL_FK_SIDE,
  LL_FK_ROM_JOINTS,
  LL_FK_ROM_FROM_NERVE,
  LL_FK_NERVE_SELECTIONS,
  LL_FK_LEG_AMPUTATION,
  LL_FK_TOE_AMPUTATIONS,
  LL_FK_SHORTENING_CM,
  LL_FK_DBE_SELECTIONS,
  type LlRomJointEntry,
  type LlNerveSelectionEntry,
  type LlDbeSelectionEntry,
  type LlToeAmputations,
  type ToeKey,
} from "../extractors/lowerLimb.js";
import { LowerLimbValueSchema } from "../../engine/lowerLimbData.js";
import type { LowerLimbValue, LowerAnatomicalKey } from "../../engine/lowerLimbData.js";

const TOE_KEYS: ToeKey[] = ["great", "second", "third", "fourth", "fifth"];

export function buildLowerLimbArgs(facts: V2SystemFacts): BuildResult<LowerLimbValue> {
  const warnings: string[] = [];
  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  // ── Side (required — never default) ──────────────────────────────────────
  if (!facts[LL_FK_SIDE]) {
    return {
      ok: false,
      warnings: ["Side is required and was not supplied by the doctor."],
      zodErrors: ["side: required"],
    };
  }
  const side = facts[LL_FK_SIDE].value as "left" | "right";
  userSupplied.push("side");

  // ── Leg amputation ────────────────────────────────────────────────────────
  let legLevel = "none";
  if (facts[LL_FK_LEG_AMPUTATION]) {
    // Normalise human-readable chip answers ("above knee") to the canonical
    // underscore format the engine schema expects ("above_knee").
    legLevel = (facts[LL_FK_LEG_AMPUTATION].value as string).replace(/\s+/g, "_");
    userSupplied.push("leg_amputation");
  } else {
    builderZeroFilled.push("leg_amputation");
  }

  // ── Toe amputations ───────────────────────────────────────────────────────
  const toes: Record<string, string> = {};
  if (facts[LL_FK_TOE_AMPUTATIONS]) {
    const raw = facts[LL_FK_TOE_AMPUTATIONS].value as LlToeAmputations;
    for (const t of TOE_KEYS) toes[t] = raw[t] ?? "none";
    userSupplied.push("toe_amputations");
  } else {
    for (const t of TOE_KEYS) toes[t] = "none";
    builderZeroFilled.push("toe_amputations");
  }

  // ── ROM ───────────────────────────────────────────────────────────────────
  const romJoints: LowerLimbValue["rom"]["joints"] = {};
  if (facts[LL_FK_ROM_JOINTS]) {
    const raw = facts[LL_FK_ROM_JOINTS].value as Record<string, LlRomJointEntry>;
    for (const [joint, entry] of Object.entries(raw)) {
      romJoints[joint] = { isAnkylosed: entry.isAnkylosed, measurements: { ...entry.measurements } };
    }
    userSupplied.push("rom_joints");
  } else {
    builderZeroFilled.push("rom_joints");
  }

  // ── Neurological ──────────────────────────────────────────────────────────
  const selectedNerves: LowerLimbValue["neurological"]["selectedNerves"] = [];
  if (facts[LL_FK_NERVE_SELECTIONS]) {
    const raw = facts[LL_FK_NERVE_SELECTIONS].value as LlNerveSelectionEntry[];
    for (const n of raw) {
      selectedNerves.push({ nerveKey: n.nerveKey, deficitType: n.deficitType, lossType: n.lossType });
    }
    userSupplied.push("nerve_selections");
  } else {
    builderZeroFilled.push("nerve_selections");
  }

  let romFromNerve = false;
  if (facts[LL_FK_ROM_FROM_NERVE]) {
    romFromNerve = facts[LL_FK_ROM_FROM_NERVE].value as boolean;
    userSupplied.push("rom_from_nerve");
  } else {
    builderZeroFilled.push("rom_from_nerve");
  }

  // ── Shortening ────────────────────────────────────────────────────────────
  let discrepancyCm = 0;
  if (facts[LL_FK_SHORTENING_CM]) {
    discrepancyCm = facts[LL_FK_SHORTENING_CM].value as number;
    userSupplied.push("shortening_cm");
  } else {
    builderZeroFilled.push("shortening_cm");
  }

  // ── DBE ───────────────────────────────────────────────────────────────────
  const selectedConditions: LowerLimbValue["dbe"]["selectedConditions"] = [];
  if (facts[LL_FK_DBE_SELECTIONS]) {
    const raw = facts[LL_FK_DBE_SELECTIONS].value as LlDbeSelectionEntry[];
    for (const d of raw) {
      selectedConditions.push({
        conditionId: d.conditionId,
        selectedPercent: d.selectedPercent,
        selectedAnatomicalKey: d.selectedAnatomicalKey as LowerAnatomicalKey | undefined,
      });
    }
    userSupplied.push("dbe_selections");
  } else {
    builderZeroFilled.push("dbe_selections");
  }

  // ── Assemble and validate ─────────────────────────────────────────────────
  const args: LowerLimbValue = {
    side,
    amputations: { legLevel, toes: toes as LowerLimbValue["amputations"]["toes"] },
    rom: { joints: romJoints },
    neurological: { selectedNerves, romFromNerve },
    shortening: { discrepancyCm },
    dbe: { selectedConditions },
  };

  const parsed = LowerLimbValueSchema.safeParse(args);
  if (!parsed.success) {
    const zodErrors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { ok: false, warnings: ["Schema validation failed."], zodErrors };
  }

  return {
    ok: true,
    toolName: "assess_lower_limb",
    args: parsed.data as LowerLimbValue,
    warnings,
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
