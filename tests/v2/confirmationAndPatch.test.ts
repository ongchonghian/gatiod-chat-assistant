import { describe, expect, it } from "vitest";
import { buildConfirmationMessage } from "../../src/v2/confirmationBuilder.js";
import {
  isConfirmation,
  isEditRequest,
  buildFactPatch,
} from "../../src/v2/factPatch.js";
import { extractValues } from "../../src/v2/slotEvaluator.js";
import type { NormalizedUtterance } from "../../src/v2/contracts.js";

function utt(text: string): NormalizedUtterance {
  return {
    raw: text,
    normalizedText: text,
    tokens: text.split(/\s+/),
    mappedTokens: [],
    unresolvedTerms: [],
    confidence: 0.9,
  };
}

// ---------------------------------------------------------------------------
// extractValues
// ---------------------------------------------------------------------------

describe("extractValues", () => {
  it("extracts side from utterance", () => {
    const v = extractValues(utt("left shoulder flexion 90°"));
    expect(v.side).toBe("left");
  });

  it("extracts ROM readings as direction+angle pairs", () => {
    const v = extractValues(utt("flexion 90° and abduction 60°"));
    expect(v.rom_readings).toContain("flexion 90°");
    expect(v.rom_readings).toContain("abduction 60°");
  });

  it("extracts joint name", () => {
    const v = extractValues(utt("shoulder flexion 90°"));
    expect(v.rom_joint).toBe("shoulder");
  });

  it("infers restricted motion for non-zero degree", () => {
    const v = extractValues(utt("elbow flexion 45°"));
    expect(v.ankylosis_type).toBe("restricted motion");
  });

  it("infers ankylosed for 'fixed at' keyword", () => {
    const v = extractValues(utt("elbow fixed at 0°"));
    expect(v.ankylosis_type).toBe("ankylosed");
  });

  it("extracts nerve name and deficit type", () => {
    const v = extractValues(utt("median nerve sensory partial"));
    expect(v.nerve_name).toBe("median");
    expect(v.nerve_deficit).toBe("sensory");
    expect(v.nerve_loss).toBe("partial");
  });

  it("records explicit nerve negation", () => {
    const v = extractValues(utt("no nerve deficit"));
    expect(v.nerve_present).toBe("none");
  });

  it("records 'no other findings' as negating all optional streams", () => {
    const v = extractValues(utt("no other findings"));
    expect(v.nerve_present).toBe("none");
    expect(v.amputation_present).toBe("none");
    expect(v.dbe_present).toBe("none");
  });

  it("extracts rom_from_nerve as independent", () => {
    const v = extractValues(utt("independent ROM, not due to nerve"));
    expect(v.rom_from_nerve).toBe("independent");
  });

  it("extracts shortening in cm", () => {
    const v = extractValues(utt("limb shortening 2.5 cm"));
    expect(v.shortening_cm).toBe("2.5 cm");
  });

  it("extracts spine region", () => {
    const v = extractValues(utt("lumbar disc herniation"));
    expect(v.region).toBe("lumbar");
  });

  it("extracts ASIA grade", () => {
    const v = extractValues(utt("ASIA D grade"));
    expect(v.asia_grade).toBe("ASIA D");
  });
});

// ---------------------------------------------------------------------------
// buildConfirmationMessage — upper limb
// ---------------------------------------------------------------------------

describe("buildConfirmationMessage — upper_limb", () => {
  it("includes side and ROM section when ROM signals present", () => {
    const msg = buildConfirmationMessage(
      "upper_limb",
      { side: "left", rom_joint: "shoulder", rom_readings: "flexion 90°", ankylosis_type: "restricted motion" },
      { side: true, rom_present: true, rom_joint: true, rom_measurements: true, ankylosis_flag: true }
    );
    expect(msg).toContain("**Confirmation — Upper Limb**");
    expect(msg).toContain("Left");
    expect(msg).toContain("Shoulder"); // titleCase applied by builder
    expect(msg).toContain("flexion 90°");
    expect(msg).toContain("**Nerve deficit:** None reported");
    expect(msg).toContain("**Amputation:** None reported");
    expect(msg).toContain("Confirm and calculate?");
  });

  it("shows nerve section when nerve signal present", () => {
    const msg = buildConfirmationMessage(
      "upper_limb",
      {
        side: "right",
        nerve_name: "median",
        nerve_deficit: "sensory",
        nerve_loss: "partial",
        rom_from_nerve: "independent",
      },
      { side: true, nerve_present: true, rom_present: true, rom_from_nerve: true }
    );
    expect(msg).toContain("Median");
    expect(msg).toContain("sensory");
    expect(msg).toContain("independent");
  });

  it("suppresses nerve section when nerve_present = none in values", () => {
    const msg = buildConfirmationMessage(
      "upper_limb",
      { side: "left", nerve_present: "none" },
      { side: true, nerve_present: true }
    );
    expect(msg).toContain("None reported");
    expect(msg).not.toContain("nerve_name");
  });
});

// ---------------------------------------------------------------------------
// isConfirmation / isEditRequest
// ---------------------------------------------------------------------------

describe("isConfirmation", () => {
  it("detects 'confirm'", () => {
    expect(isConfirmation(utt("confirm"))).toBe(true);
  });

  it("detects 'Confirm and calculate'", () => {
    expect(isConfirmation(utt("Confirm and calculate"))).toBe(true);
  });

  it("detects 'yes'", () => {
    expect(isConfirmation(utt("yes"))).toBe(true);
  });

  it("detects 'proceed'", () => {
    expect(isConfirmation(utt("proceed"))).toBe(true);
  });

  it("does not treat corrections as confirmations", () => {
    expect(isConfirmation(utt("actually right side"))).toBe(false);
  });

  it("does not treat edit requests as confirmations", () => {
    expect(isConfirmation(utt("edit"))).toBe(false);
  });
});

describe("isEditRequest", () => {
  it("detects 'edit'", () => {
    expect(isEditRequest(utt("edit"))).toBe(true);
  });

  it("detects 'no'", () => {
    expect(isEditRequest(utt("no"))).toBe(true);
  });

  it("detects 'actually'", () => {
    expect(isEditRequest(utt("actually the ROM was wrong"))).toBe(true);
  });

  it("does not treat 'yes' as an edit", () => {
    expect(isEditRequest(utt("yes"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildFactPatch
// ---------------------------------------------------------------------------

describe("buildFactPatch", () => {
  it("patches side on 'actually right side'", () => {
    const patch = buildFactPatch(
      utt("actually right side"),
      { side: "left" },
      { side: true }
    );
    expect(patch.updatedValues.side).toBe("right");
  });

  it("patches ROM readings when corrected angle provided", () => {
    const patch = buildFactPatch(
      utt("abduction 80°"),     // doctor corrects "90" → "80"
      { rom_readings: "abduction 90°" },
      { rom_present: true }
    );
    expect(patch.updatedValues.rom_readings).toBeDefined();
    expect(patch.updatedValues.rom_readings).toContain("80°");
  });

  it("negates nerve finding on 'no nerve deficit'", () => {
    const patch = buildFactPatch(
      utt("no nerve deficit"),
      { nerve_name: "median" },
      { nerve_present: true }
    );
    expect(patch.updatedValues.nerve_present).toBe("none");
    expect(patch.signalsToClear).toContain("rom_from_nerve");
  });

  it("negates amputation on 'no amputation'", () => {
    const patch = buildFactPatch(
      utt("no amputation"),
      {},
      { amputation_present: true }
    );
    expect(patch.updatedValues.amputation_present).toBe("none");
  });

  it("'no other findings' negates all optional streams", () => {
    const patch = buildFactPatch(
      utt("no other findings"),
      {},
      {}
    );
    expect(patch.updatedValues.nerve_present).toBe("none");
    expect(patch.updatedValues.amputation_present).toBe("none");
    expect(patch.updatedValues.dbe_present).toBe("none");
  });

  it("patches diagnosis category and clears dependent severity for spine corrections", () => {
    const patch = buildFactPatch(
      utt("actually it is a disc injury not a fracture"),
      { diagnosis_category: "fracture" },
      { diagnosis_category: true, severity_key: true }
    );
    expect(patch.updatedValues.diagnosis_category).toContain("disc");
    expect(patch.signalsToClear).toContain("severity_key");
  });
});
