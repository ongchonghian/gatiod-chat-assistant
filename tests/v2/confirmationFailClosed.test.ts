// Confirmation fail-closed contract (slice 4 / delta-audit follow-up).
// `buildStructuredConfirmation` is the typed contract; it must refuse with
// `{ ok: false, missingFields }` when required facts are absent — replacing
// the previous soft strings ("Findings collected — confirm to calculate.",
// "(none extracted yet — please describe the diagnosis)") that could leak
// into the doctor-facing UI under unexpected states.
import { describe, expect, it } from "vitest";
import {
  buildLegacyConfirmation,
  buildStructuredConfirmation,
  buildStructuredConfirmationMessage,
} from "../../src/v2/confirmationBuilder.js";
import {
  HEARING_FK_PATH,
  HEARING_FK_AFFECTED_EARS,
  HEARING_FK_LEFT_EAR_AHL,
  HEARING_FK_RIGHT_EAR_AHL,
  HEARING_FK_AGE,
} from "../../src/v2/extractors/hearing.js";
import {
  SP_FK_REGION,
  SP_FK_ENTRIES,
  type SpineCategoryEntryFact,
} from "../../src/v2/extractors/spine.js";
import type { ExtractedFact, V2SystemFacts } from "../../src/v2/contracts.js";

function fact<T>(value: T): ExtractedFact<T> {
  const now = new Date().toISOString();
  return {
    value,
    sourceText: "test",
    confidence: 0.9,
    extractionMethod: "regex",
    createdAt: now,
    updatedAt: now,
  };
}

describe("buildStructuredConfirmation — spine fail-closed", () => {
  it("ok: false when no facts at all", () => {
    const result = buildStructuredConfirmation("spine", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("spine_missing_region");
    expect(result.missingFields).toEqual(
      expect.arrayContaining(["spine_region", "spine_entries"]),
    );
  });

  it("ok: false when region present but no entries", () => {
    const facts: V2SystemFacts = { [SP_FK_REGION]: fact("thoraco_lumbar") };
    const result = buildStructuredConfirmation("spine", facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("spine_no_calculable_entries");
    expect(result.missingFields).toEqual(["spine_entries"]);
  });

  it("ok: false when entries exist but none have a severityKey", () => {
    const incomplete: SpineCategoryEntryFact[] = [
      {
        diagnosisCategory: "fractures_dislocations",
        severityKey: "" as SpineCategoryEntryFact["severityKey"],
        monoparesisHalving: false,
        bladderBowelSeverity: "none",
        discCordInvolvement: false,
        spondylolysisPathway: "acute_traumatic",
      },
    ];
    const facts: V2SystemFacts = {
      [SP_FK_REGION]: fact("thoraco_lumbar"),
      [SP_FK_ENTRIES]: fact(incomplete),
    };
    const result = buildStructuredConfirmation("spine", facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("spine_no_calculable_entries");
  });

  it("ok: true when region + at least one calculable entry", () => {
    const entries: SpineCategoryEntryFact[] = [
      {
        diagnosisCategory: "fractures_dislocations",
        severityKey: "compression_lt25",
        monoparesisHalving: false,
        bladderBowelSeverity: "none",
        discCordInvolvement: false,
        spondylolysisPathway: "acute_traumatic",
      },
    ];
    const facts: V2SystemFacts = {
      [SP_FK_REGION]: fact("thoraco_lumbar"),
      [SP_FK_ENTRIES]: fact(entries),
    };
    const result = buildStructuredConfirmation("spine", facts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain("Thoraco-Lumbar");
    expect(result.message).not.toMatch(/none extracted yet/);
    expect(result.message).not.toMatch(/findings collected — confirm to calculate/i);
  });
});

describe("buildStructuredConfirmation — hearing fail-closed", () => {
  it("ok: false when no path", () => {
    const result = buildStructuredConfirmation("hearing", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toContain("hearing_path");
  });

  it("ok: false on injury path with affected ear missing", () => {
    const facts: V2SystemFacts = { [HEARING_FK_PATH]: fact("injury") };
    const result = buildStructuredConfirmation("hearing", facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toContain("affected_ears");
  });

  it("ok: false on injury path with right ear selected but right AHL missing", () => {
    const facts: V2SystemFacts = {
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("right"),
    };
    const result = buildStructuredConfirmation("hearing", facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toContain("right_ear_ahl");
  });

  it("ok: false on NID path missing AHLs and age", () => {
    const facts: V2SystemFacts = { [HEARING_FK_PATH]: fact("nid") };
    const result = buildStructuredConfirmation("hearing", facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(
      expect.arrayContaining(["right_ear_ahl", "left_ear_ahl", "age"]),
    );
  });

  it("ok: true on injury path with affected ear + AHL", () => {
    const facts: V2SystemFacts = {
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("right"),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(90),
    };
    const result = buildStructuredConfirmation("hearing", facts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain("Right ear AHL");
    expect(result.message).not.toMatch(/findings collected — confirm to calculate/i);
  });

  it("ok: true on NID path with both AHLs and age", () => {
    const facts: V2SystemFacts = {
      [HEARING_FK_PATH]: fact("nid"),
      [HEARING_FK_RIGHT_EAR_AHL]: fact(70),
      [HEARING_FK_LEFT_EAR_AHL]: fact(75),
      [HEARING_FK_AGE]: fact(55),
    };
    const result = buildStructuredConfirmation("hearing", facts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain("Noise-Induced Deafness");
    expect(result.message).toContain("Age");
  });
});

describe("buildStructuredConfirmation — default branch fail-closed", () => {
  it("ok: false for an empty facts patch on a non-special-cased system", () => {
    const result = buildStructuredConfirmation("respiratory", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_facts_present");
  });
});

describe("buildLegacyConfirmation — empty-state fail-closed", () => {
  it("ok: false when no values are present (no soft 'findings collected' card)", () => {
    const result = buildLegacyConfirmation("respiratory", {}, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_facts_present");
  });

  it("ok: true when at least one value is extracted", () => {
    const result = buildLegacyConfirmation(
      "respiratory",
      { diagnosis: "occupational asthma" },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain("Confirmation — Respiratory");
    expect(result.message).toContain("Pathway");
  });
});

describe("buildStructuredConfirmationMessage compat shim", () => {
  it("returns the message string on ok: true", () => {
    const facts: V2SystemFacts = {
      [HEARING_FK_PATH]: fact("injury"),
      [HEARING_FK_AFFECTED_EARS]: fact("left"),
      [HEARING_FK_LEFT_EAR_AHL]: fact(60),
    };
    const msg = buildStructuredConfirmationMessage("hearing", facts);
    expect(msg).toContain("Confirmation — Hearing");
    expect(msg).toContain("Left ear AHL");
  });

  it("throws on ok: false rather than returning a soft message", () => {
    expect(() => buildStructuredConfirmationMessage("spine", {})).toThrow(
      /spine_missing_region|cannot render confirmation/,
    );
  });
});
