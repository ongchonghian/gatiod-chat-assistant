// Phase H — loosen respiratory FVC/FEV1/DLCO regexes (issue #12, RC-9).
//
// The original patterns required the number to follow the abbreviation
// directly (with at most an optional ":" or "="). They missed natural
// workbook phrasings like "FVC of 45% predicted" and stalled the flow
// in five Cross-System Scenarios. This test pins the loosened patterns.

import { describe, expect, it } from "vitest";
import {
  extractRespiratory,
  RESP_FK_FVC,
  RESP_FK_FEV1,
  RESP_FK_DLCO,
} from "../../src/v2/extractors/respiratory.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";

function run(text: string) {
  return extractRespiratory(
    normalizeClinicalUtterance(text),
    defaultV2SessionState().systems.respiratory,
  );
}
function fvc(text: string): number | undefined {
  return run(text).extractedFactsPatch[RESP_FK_FVC]?.value as number | undefined;
}
function fev1(text: string): number | undefined {
  return run(text).extractedFactsPatch[RESP_FK_FEV1]?.value as number | undefined;
}
function dlco(text: string): number | undefined {
  return run(text).extractedFactsPatch[RESP_FK_DLCO]?.value as number | undefined;
}

describe("Respiratory FVC/FEV1/DLCO regex accepts natural phrasing", () => {
  it("FVC: parses bare, colon, and equals forms", () => {
    expect(fvc("FVC 45")).toBe(45);
    expect(fvc("FVC: 45")).toBe(45);
    expect(fvc("FVC = 45")).toBe(45);
  });

  it("FVC: parses 'of N% predicted' phrasing", () => {
    expect(fvc("FVC of 45% predicted")).toBe(45);
    expect(fvc("FVC of 45")).toBe(45);
  });

  it("FVC: parses 'predicted N%' phrasing", () => {
    expect(fvc("FVC predicted 45%")).toBe(45);
  });

  it("FVC: parses '= N% predicted' phrasing", () => {
    expect(fvc("FVC = 45% predicted")).toBe(45);
  });

  it("FEV1: parses 'of N% predicted' phrasing", () => {
    expect(fev1("FEV1 of 60% predicted")).toBe(60);
    expect(fev1("FEV1 60% predicted")).toBe(60);
  });

  it("DLCO: parses 'of N% predicted' phrasing", () => {
    expect(dlco("DLCO of 70% predicted")).toBe(70);
    expect(dlco("DLCO 70")).toBe(70);
  });

  it("FEV1 still does not match FEV1/FVC ratio", () => {
    // Negative lookahead must remain so "FEV1/FVC 75" does not extract FEV1=75.
    expect(fev1("FEV1/FVC 75%")).toBeUndefined();
  });
});
