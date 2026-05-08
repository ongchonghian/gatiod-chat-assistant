import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import {
  FK_ARM_AMPUTATION,
  FK_DBE_SELECTIONS,
  FK_FINGER_AMPUTATIONS,
  FK_NERVE_SELECTIONS,
  FK_ROM_FROM_NERVE,
  FK_ROM_JOINTS,
  FK_SIDE,
  type DbeSelectionEntry,
  type NerveSelectionEntry,
  type RomJointEntry,
} from "../extractors/upperLimb.js";
import { UpperLimbValueSchema } from "../../engine/upperLimbData.js";
import type { UpperLimbValue } from "../../engine/upperLimbData.js";

const FINGER_KEYS = ["thumb", "index", "middle", "ring", "little"] as const;

export function buildUpperLimbArgs(facts: V2SystemFacts): BuildResult<UpperLimbValue> {
  const warnings: string[] = [];
  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  // ── Side (required — never default) ──────────────────────────────────────
  if (!facts[FK_SIDE]) {
    return {
      ok: false,
      warnings: ["Side is required and was not supplied by the doctor."],
      zodErrors: ["side: required"],
    };
  }
  const side = facts[FK_SIDE].value as "left" | "right";
  userSupplied.push("side");

  // ── Amputations ───────────────────────────────────────────────────────────
  let armLevel = "none";
  if (facts[FK_ARM_AMPUTATION]) {
    armLevel = facts[FK_ARM_AMPUTATION].value as string;
    userSupplied.push("arm_amputation");
  } else {
    builderZeroFilled.push("arm_amputation");
  }

  const fingers: Record<string, string> = {};
  if (facts[FK_FINGER_AMPUTATIONS]) {
    const raw = facts[FK_FINGER_AMPUTATIONS].value as Record<string, string>;
    for (const f of FINGER_KEYS) fingers[f] = raw[f] ?? "none";
    userSupplied.push("finger_amputations");
  } else {
    for (const f of FINGER_KEYS) fingers[f] = "none";
    builderZeroFilled.push("finger_amputations");
  }

  // ── ROM ───────────────────────────────────────────────────────────────────
  const romJoints: UpperLimbValue["rom"]["joints"] = {};
  if (facts[FK_ROM_JOINTS]) {
    const raw = facts[FK_ROM_JOINTS].value as Record<string, RomJointEntry>;
    for (const [joint, entry] of Object.entries(raw)) {
      romJoints[joint] = { isAnkylosed: entry.isAnkylosed, measurements: { ...entry.measurements } };
    }
    userSupplied.push("rom_joints");
  } else {
    builderZeroFilled.push("rom_joints");
  }

  // ── Neurological ──────────────────────────────────────────────────────────
  const selectedNerves: UpperLimbValue["neurological"]["selectedNerves"] = [];
  if (facts[FK_NERVE_SELECTIONS]) {
    const raw = facts[FK_NERVE_SELECTIONS].value as NerveSelectionEntry[];
    for (const n of raw) {
      selectedNerves.push({
        nerveKey: n.nerveKey,
        deficitType: n.deficitType,
        lossType: n.lossType,
        severityId: n.severityId,
      });
    }
    userSupplied.push("nerve_selections");
  } else {
    builderZeroFilled.push("nerve_selections");
  }

  let romFromNerve = false;
  if (facts[FK_ROM_FROM_NERVE]) {
    romFromNerve = facts[FK_ROM_FROM_NERVE].value as boolean;
    userSupplied.push("rom_from_nerve");
  } else {
    builderZeroFilled.push("rom_from_nerve");
  }

  // ── DBE ───────────────────────────────────────────────────────────────────
  const selectedConditions: UpperLimbValue["dbe"]["selectedConditions"] = [];
  if (facts[FK_DBE_SELECTIONS]) {
    const raw = facts[FK_DBE_SELECTIONS].value as DbeSelectionEntry[];
    for (const d of raw) {
      selectedConditions.push({
        conditionId: d.conditionId,
        selectedPercent: d.selectedPercent,
        // selectedAnatomicalKey is validated by the engine as a known key; the arg builder
        // passes it through opaquely and lets the schema reject unknown values.
        selectedAnatomicalKey: d.selectedAnatomicalKey as import("../../engine/upperLimbData.js").UpperAnatomicalKey | undefined,
      });
    }
    userSupplied.push("dbe_selections");
  } else {
    builderZeroFilled.push("dbe_selections");
  }

  // ── Assemble and validate ─────────────────────────────────────────────────
  const args: UpperLimbValue = {
    side,
    amputations: { armLevel, fingers },
    rom: { joints: romJoints },
    neurological: { selectedNerves, romFromNerve },
    dbe: { selectedConditions },
  };

  const parsed = UpperLimbValueSchema.safeParse(args);
  if (!parsed.success) {
    const zodErrors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { ok: false, warnings: ["Schema validation failed."], zodErrors };
  }

  if (warnings.length > 0) {
    // Non-fatal warnings present but schema passed
  }

  return {
    ok: true,
    toolName: "assess_upper_limb",
    args: parsed.data as UpperLimbValue,
    warnings,
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
