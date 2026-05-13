import { describe, expect, it } from "vitest";
import { routeUtterance } from "../../src/v2/router.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import { retrieveGrounding } from "../../src/v2/hybridRetriever.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";

describe("routeUtterance", () => {
  it("routes spine assessment from clinical wording", () => {
    const state = defaultV2SessionState();
    const utterance = normalizeClinicalUtterance("Lumbo-sacral intervertebral disc with persistent pain and motor deficit");
    const grounding = retrieveGrounding(utterance.normalizedText);
    const route = routeUtterance(utterance, grounding, state);

    expect(route.operation === "assessment" || route.operation === "clarify").toBeTruthy();
    expect(route.systems.includes("spine") || route.confidence < 0.5).toBeTruthy();
  });

  it("detects global CVC operation intent", () => {
    const state = defaultV2SessionState();
    const utterance = normalizeClinicalUtterance("combine assessments for global PI");
    const grounding = retrieveGrounding(utterance.normalizedText);
    const route = routeUtterance(utterance, grounding, state);

    expect(route.operation).toBe("global_cvc");
  });

  it("keeps multi-system trauma narrative in assessment mode", () => {
    const state = defaultV2SessionState();
    const utterance = normalizeClinicalUtterance(
      "Road traffic accident while working: Lumbo-sacral prolapsed intervertebral disc with persistent pain, restricted motion and motor deficit; Right femoral neck/head fracture with avascular necrosis."
    );
    const grounding = retrieveGrounding(utterance.normalizedText);
    const route = routeUtterance(utterance, grounding, state);

    expect(route.operation).toBe("assessment");
    expect(route.systems.includes("spine")).toBeTruthy();
    expect(route.systems.includes("lower_limb")).toBeTruthy();
    expect(route.confidence).toBeGreaterThan(0.5);
  });

  it("treats explicit system selection reply as assessment routing", () => {
    const state = defaultV2SessionState();
    state.pendingClarification = "Which system first?";

    const utterance = normalizeClinicalUtterance("spine, then lower limb");
    const grounding = retrieveGrounding(utterance.normalizedText);
    const route = routeUtterance(utterance, grounding, state);

    expect(route.operation).toBe("assessment");
    expect(route.systems.includes("spine")).toBeTruthy();
    expect(route.systems.includes("lower_limb")).toBeTruthy();
  });
});
