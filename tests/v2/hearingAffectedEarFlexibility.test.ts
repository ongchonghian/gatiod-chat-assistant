// Phase F — hearing affected-ear extraction across natural phrasings
// (issue #12, RC-7 / BUG-06).
//
// The resolver branch for `hearing_affected_ear` works, but the extractor
// only matches "left ear", "left side", "left hearing" — so phrasings
// like "left-sided hearing loss", "hearing loss in the left ear", and
// "L ear AHL 60" stall on the chip.

import { describe, expect, it } from "vitest";
import { extractHearing, HEARING_FK_AFFECTED_EARS } from "../../src/v2/extractors/hearing.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";

function affectedEar(text: string): "left" | "right" | undefined {
  const result = extractHearing(
    normalizeClinicalUtterance(text),
    defaultV2SessionState().systems.hearing,
  );
  return result.extractedFactsPatch[HEARING_FK_AFFECTED_EARS]?.value as
    | "left"
    | "right"
    | undefined;
}

describe("Hearing affected-ear extraction tolerates natural phrasing", () => {
  it("matches the existing baseline phrasings", () => {
    expect(affectedEar("Left ear hearing loss after accident; AHL 90 dB")).toBe("left");
    expect(affectedEar("Right side hearing loss after blast injury; AHL 80")).toBe("right");
  });

  it("matches 'left-sided' / 'right-sided' (hyphen)", () => {
    // Hearing path detection requires explicit injury/noise context — supply it.
    expect(
      affectedEar("Left-sided hearing loss after accident; AHL 90 dB"),
    ).toBe("left");
    expect(
      affectedEar("Right-sided hearing impairment after blast injury; AHL 80"),
    ).toBe("right");
  });

  it("matches 'in the left/right ear'", () => {
    expect(affectedEar("Hearing loss in the left ear after blast injury; AHL 75 dB")).toBe("left");
    expect(affectedEar("AHL 80 dB in the right ear post accident")).toBe("right");
  });

  it("matches 'on the left/right' (with injury context)", () => {
    expect(
      affectedEar("Hearing loss on the left after accident; AHL 90 dB"),
    ).toBe("left");
  });
});
