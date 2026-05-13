import { describe, expect, it } from "vitest";
import { validateRenderedResponse, legacyPiGuardFails } from "../../../src/v2/guards.js";
import type { V2RenderedResponse } from "../../../src/v2/contracts.js";

function baseResponse(overrides: Partial<V2RenderedResponse> = {}): V2RenderedResponse {
  return {
    kind: "clarification",
    message: "Please clarify.",
    numericClaims: [],
    ...overrides,
  };
}

describe("validateRenderedResponse", () => {
  it("passes a plain clarification response", () => {
    expect(validateRenderedResponse(baseResponse()).ok).toBe(true);
  });

  it("fails assessment_result without tool evidence", () => {
    const r = baseResponse({ kind: "assessment_result", message: "System-generated GATIOD PI%: 8%" });
    expect(validateRenderedResponse(r).ok).toBe(false);
  });

  it("passes assessment_result with successful assess_ tool", () => {
    const r = baseResponse({
      kind: "assessment_result",
      message: "System-generated GATIOD PI%: 8%",
      toolEvidence: { toolName: "assess_upper_limb", status: "executed", success: true },
    });
    expect(validateRenderedResponse(r).ok).toBe(true);
  });

  it("fails when final PI language appears without tool evidence", () => {
    const r = baseResponse({ message: "Final PI%: 5% for the shoulder." });
    expect(validateRenderedResponse(r).ok).toBe(false);
  });

  it("fails lookup_only response containing final PI language", () => {
    const r = baseResponse({ kind: "lookup_only", message: "Final PI: 5%" });
    expect(validateRenderedResponse(r).ok).toBe(false);
  });

  it("passes lookup_only with table-only wording", () => {
    const r = baseResponse({
      kind: "lookup_only",
      message: "Lookup only — shoulder flexion 90° maps to a ROM table value of 5%.",
    });
    expect(validateRenderedResponse(r).ok).toBe(true);
  });

  it("fails for non-assess_ tool (e.g. lookup tool)", () => {
    const r = baseResponse({
      kind: "assessment_result",
      message: "System-generated GATIOD PI%: 8%",
      toolEvidence: { toolName: "lookup_nerve", status: "executed", success: true },
    });
    expect(validateRenderedResponse(r).ok).toBe(false);
  });
});

describe("legacyPiGuardFails", () => {
  it("detects final PI language in legacy output", () => {
    expect(legacyPiGuardFails("The final PI is 8%.")).toBe(true);
    expect(legacyPiGuardFails("Total incapacity: 15%")).toBe(true);
  });

  it("does not flag normal table-value text", () => {
    expect(legacyPiGuardFails("The shoulder ROM table value is 5%")).toBe(false);
  });
});
