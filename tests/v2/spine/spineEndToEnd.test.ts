// Reproduces the live failure:
//  1. multi-system input (spine + hearing)
//  2. severity chip resolution
//  3. confirmation
//  4. assess_spine tool execution
//  5. result rendering
//
// The user reported the confirmation showed "[Object Object]" for entries and
// the post-confirm step crashed with "Cannot read properties of undefined
// (reading 'find')". This test exercises every step against in-memory state.
import { describe, expect, it } from "vitest";
import { normalizeClinicalUtterance } from "../../../src/v2/normalizer.js";
import { retrieveGrounding } from "../../../src/v2/hybridRetriever.js";
import { routeUtterance } from "../../../src/v2/router.js";
import { extractSpine, SP_FK_ENTRIES, SP_FK_REGION } from "../../../src/v2/extractors/spine.js";
import { applyStructuredExtraction, defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import { tryResolvePendingObservation } from "../../../src/v2/pendingObservationResolver.js";
import { validateSpineReadiness } from "../../../src/v2/readiness/spine.js";
import { buildSpineArgs } from "../../../src/v2/argBuilders/spine.js";
import { handleToolCall } from "../../../src/tools/toolHandlers.js";
import { renderSpineResult } from "../../../src/v2/renderers/spineResult.js";
import { buildStructuredConfirmationMessage } from "../../../src/v2/confirmationBuilder.js";
import type { V2SessionState } from "../../../src/v2/contracts.js";

describe("Spine end-to-end flow (reproduces live failure)", () => {
  it("scaffold collapse → severity chip → confirm → assess → render does not crash", () => {
    let state: V2SessionState = defaultV2SessionState();

    // Turn 1 — initial multi-system input
    const t1 = normalizeClinicalUtterance(
      "Scaffold collapse: Thoraco-lumbar compression/burst fracture <25% height loss with residual pain; Right ear sudden hearing loss after accident; AHL 90 dB."
    );
    const grounding1 = retrieveGrounding(t1.normalizedText);
    const route1 = routeUtterance(t1, grounding1, state);
    expect(route1.systems).toContain("spine");

    const ext1 = extractSpine(t1, state.systems.spine, grounding1.ontologyMatches);
    state = applyStructuredExtraction(state, "spine", ext1);

    // Spine extractor should have created a severity-bracket pending obs
    expect(state.systems.spine.pendingObservations.length).toBeGreaterThan(0);
    const obs = state.systems.spine.pendingObservations[0];
    expect(obs.type).toBe("severity_bracket");

    // Turn 2 — user picks the severity chip
    const t2 = normalizeClinicalUtterance("Compression or burst fractures of <25% with residual pain");
    const resolution = tryResolvePendingObservation(state, "spine", t2);
    expect(resolution.resolved).toBe(true);
    state = resolution.state;
    expect(state.systems.spine.pendingObservations.length).toBe(0);

    // Confirmation should render WITHOUT [Object Object]
    const confirmMsg = buildStructuredConfirmationMessage("spine", state.systems.spine.extractedFacts);
    expect(confirmMsg, "spine confirmation should not contain [Object Object]")
      .not.toMatch(/\[Object Object\]/i);
    expect(confirmMsg.toLowerCase()).toContain("fractures");

    // Readiness should be ready
    const readiness = validateSpineReadiness(state.systems.spine);
    expect(readiness.ready, `readiness blocked: ${readiness.reason}`).toBe(true);

    // Build args
    const built = buildSpineArgs(state.systems.spine.extractedFacts);
    expect(built.ok, `arg builder failed: ${(built as { warnings?: string[] }).warnings?.join("; ") ?? ""}`).toBe(true);
    if (!built.ok) return;

    // Execute the tool — must not throw, and validation must succeed
    const result = handleToolCall("assess_spine", built.args as Record<string, unknown>);
    expect(result.success, `tool execution failed: ${result.error}`).toBe(true);
    expect(result.error, "tool error should be absent").toBeUndefined();

    // Render — must not throw the "Cannot read properties of undefined (reading 'find')" error
    const rendered = renderSpineResult(result.data, state.systems.spine);
    expect(rendered.message).toContain("PI%");
    expect(rendered.message).not.toMatch(/\[Object Object\]/i);
  });

  it("buildStructuredConfirmationMessage formats spine entries readably", () => {
    let state: V2SessionState = defaultV2SessionState();
    const t1 = normalizeClinicalUtterance("Thoraco-lumbar compression fracture less than 25% with residual pain");
    const ext = extractSpine(t1, state.systems.spine, []);
    state = applyStructuredExtraction(state, "spine", ext);

    if (state.systems.spine.pendingObservations.length > 0) {
      const r = tryResolvePendingObservation(
        state,
        "spine",
        normalizeClinicalUtterance("Compression or burst fractures of <25% with residual pain")
      );
      if (r.resolved) state = r.state;
    }

    const msg = buildStructuredConfirmationMessage("spine", state.systems.spine.extractedFacts);
    expect(msg).not.toMatch(/\[Object Object\]/i);
    expect(msg.toLowerCase()).toContain("region");
    // Entries should have category + severity rendered, not stringified
    expect(msg.toLowerCase()).toMatch(/fractures|dislocations|compression|burst/i);
  });
});
