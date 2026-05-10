import { describe, expect, it } from "vitest";
import { runConsensusOrchestrator } from "../../src/v2/consensusOrchestrator.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import type { SemanticModelClient } from "../../src/v2/semanticInterpreter.js";
import type { SemanticInterpretation } from "../../src/v2/contracts.js";

// P1 follow-up — `semantic_interpretation_created` audit-event payload now
// carries the full structured interpretation (candidateSystems and
// candidateFindings) so downstream replay/shadow pipelines can mine real
// proposals. Privacy: source text plaintext stays out of the audit log —
// joinable via interpretationId → pendingConsensus.sourceText.

const SOURCE_TEXT =
  "Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.";

const NOW = "2026-05-10T00:00:00.000Z";

function validInterpretation(): SemanticInterpretation {
  return {
    id: "interp-payload-test",
    sourceText: SOURCE_TEXT,
    sourceHash: "model-supplied-hash",
    candidateSystems: [
      {
        system: "lower_limb",
        confidence: 0.92,
        status: "structured_supported",
        evidence: ["common peroneal nerve lesion"],
        rationale: "Left common peroneal nerve lesion with combined deficit.",
      },
      {
        system: "cns",
        confidence: 0.88,
        status: "legacy_deferred",
        evidence: ["complete anosmia"],
        rationale: "CNS olfactory finding, currently legacy/deferred.",
      },
    ],
    candidateFindings: [
      {
        system: "lower_limb",
        sourceSpan: "Left common peroneal nerve lesion with combined sensory and motor deficit",
        findingType: "neurological",
        proposedMapping: "Lower-limb common peroneal nerve, combined sensory/motor deficit",
        systemConfidence: 0.92,
        mappingConfidence: 0.85,
        completeness: "missing_calculation_fields",
        explicitlyStatedFields: ["side: left", "nerve: common peroneal"],
        inferredFields: [],
        missingFields: ["partial vs total loss"],
        calculationReady: false,
      },
      {
        system: "cns",
        sourceSpan: "Complete anosmia due to traumatic olfactory nerve injury",
        findingType: "cns_component",
        proposedMapping: "CNS Section B olfactory component",
        systemConfidence: 0.88,
        mappingConfidence: 0.8,
        completeness: "unsupported",
        explicitlyStatedFields: ["complete anosmia"],
        inferredFields: [],
        missingFields: [],
        calculationReady: false,
      },
    ],
    unsupportedTerms: ["traumatic olfactory nerve injury"],
    assumptions: ["interpreting 'lesion' as a nerve injury"],
    requiresUserConsensus: true,
    createdAt: NOW,
  };
}

function mockClient(output: string): SemanticModelClient {
  return { async generate() { return output; } };
}

describe("P1 follow-up — semantic_interpretation_created audit payload expansion", () => {
  it("includes the full structured candidateSystems list, not just system keys", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });

    const audit = result.auditEvents.find(
      (e) => e.eventType === "semantic_interpretation_created",
    );
    expect(audit).toBeDefined();

    const payload = audit!.payload;
    const candidateSystems = payload.candidateSystems as Array<{
      system: string;
      confidence: number;
      status: string;
      evidence: string[];
      rationale: string;
    }>;
    expect(Array.isArray(candidateSystems)).toBe(true);
    expect(candidateSystems).toHaveLength(2);
    // Old-shape test would have asserted candidateSystems = ["lower_limb", "cns"].
    // New shape: full system records.
    expect(candidateSystems[0].system).toBe("lower_limb");
    expect(candidateSystems[0].confidence).toBe(0.92);
    expect(candidateSystems[0].status).toBe("structured_supported");
    expect(candidateSystems[0].rationale).toContain("Left common peroneal");
    expect(candidateSystems[1].system).toBe("cns");
    expect(candidateSystems[1].status).toBe("legacy_deferred");
  });

  it("includes the full candidateFindings list with source spans and missing fields", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });

    const audit = result.auditEvents.find(
      (e) => e.eventType === "semantic_interpretation_created",
    );
    const findings = audit!.payload.candidateFindings as Array<{
      system: string;
      sourceSpan: string;
      findingType: string;
      proposedMapping: string;
      missingFields: string[];
      calculationReady: false;
    }>;
    expect(Array.isArray(findings)).toBe(true);
    expect(findings).toHaveLength(2);
    expect(findings[0].sourceSpan).toContain("Left common peroneal");
    expect(findings[0].findingType).toBe("neurological");
    expect(findings[0].missingFields).toEqual(["partial vs total loss"]);
    expect(findings[0].calculationReady).toBe(false);
  });

  it("includes unsupportedTerms, assumptions, count, and createdAt", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });

    const audit = result.auditEvents.find(
      (e) => e.eventType === "semantic_interpretation_created",
    );
    expect(audit!.payload.unsupportedTerms).toEqual([
      "traumatic olfactory nerve injury",
    ]);
    expect(audit!.payload.assumptions).toEqual([
      "interpreting 'lesion' as a nerve injury",
    ]);
    expect(audit!.payload.candidateFindingCount).toBe(2);
    expect(typeof audit!.payload.interpretationCreatedAt).toBe("string");
  });

  it("does NOT include the plaintext sourceText in the audit payload", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });

    const audit = result.auditEvents.find(
      (e) => e.eventType === "semantic_interpretation_created",
    );
    // Privacy stance: source text plaintext lives in
    // gatiod_sessions.system_states.pendingConsensus.sourceText (joinable
    // via interpretationId), NOT in the audit log payload. The audit payload
    // carries only a hash + structured interpretation fields.
    expect(audit!.payload.sourceText).toBeUndefined();
    expect(typeof audit!.payload.sourceTextHash).toBe("string");
    expect((audit!.payload.sourceTextHash as string).length).toBe(64); // sha256 hex
  });

  it("interpretationId in the audit matches the persisted pendingConsensus.interpretationId (replay join key)", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });

    expect(result.kind).toBe("respond");
    if (result.kind !== "respond") return;
    const audit = result.auditEvents.find(
      (e) => e.eventType === "semantic_interpretation_created",
    );
    expect(audit!.payload.interpretationId).toBe(
      result.state.pendingConsensus?.interpretationId,
    );
  });

  it("payload survives JSON.stringify round-trip (audit-log persistence is JSON.stringify(eventData))", async () => {
    const client = mockClient(JSON.stringify(validInterpretation()));
    const norm = normalizeClinicalUtterance(SOURCE_TEXT);
    const result = await runConsensusOrchestrator({
      state: defaultV2SessionState(),
      replyText: SOURCE_TEXT,
      normalized: norm,
      modelClient: client,
      forceConsensusEnabled: true,
      forceInterpreterEnabled: true,
    });

    const audit = result.auditEvents.find(
      (e) => e.eventType === "semantic_interpretation_created",
    );
    const serialised = JSON.stringify(audit!.payload);
    const parsed = JSON.parse(serialised) as Record<string, unknown>;
    expect((parsed.candidateFindings as unknown[]).length).toBe(2);
    expect(((parsed.candidateFindings as Array<Record<string, unknown>>)[0])
      .sourceSpan as string).toContain("Left common peroneal");
  });
});
