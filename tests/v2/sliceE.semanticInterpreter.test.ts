import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSemanticTaxonomyPromptSection,
  getSemanticSystemStatus,
  SEMANTIC_SYSTEM_TAXONOMY,
} from "../../src/v2/semanticSystemTaxonomy.js";
import {
  parseSemanticInterpretation,
  SemanticInterpretationSchema,
} from "../../src/v2/semanticSchemas.js";
import {
  validateSemanticInterpretation,
} from "../../src/v2/semanticInterpreterValidator.js";
import {
  renderSemanticConsensus,
} from "../../src/v2/semanticInterpreterRenderer.js";
import {
  runSemanticInterpreter,
  type SemanticModelClient,
} from "../../src/v2/semanticInterpreter.js";
import {
  buildSemanticInterpreterSystemPrompt,
  buildSemanticInterpreterUserMessage,
} from "../../src/v2/semanticInterpreterPrompt.js";
import type { SemanticInterpretation } from "../../src/v2/contracts.js";

// Slice E — semantic interpreter shadow components (REQ-SC-OUTPUT-001,
// REQ-SC-PROMPT-001). All tests use mocked model output; no real LLM call.

const SOURCE_TEXT =
  "Heavy object strike: Left common peroneal nerve lesion with combined sensory and motor deficit; Complete anosmia due to traumatic olfactory nerve injury.";

function validInterpretation(overrides?: Partial<SemanticInterpretation>): SemanticInterpretation {
  return {
    id: "interp-1",
    sourceText: SOURCE_TEXT,
    sourceHash: "h",
    candidateSystems: [
      {
        system: "lower_limb",
        confidence: 0.9,
        status: "structured_supported",
        evidence: ["common peroneal nerve lesion"],
        rationale: "Left common peroneal nerve lesion with combined deficit.",
      },
      {
        system: "cns",
        confidence: 0.85,
        status: "structured_supported",
        evidence: ["complete anosmia"],
        rationale: "CNS olfactory finding, structured_live as of Sprint 6.",
      },
    ],
    candidateFindings: [
      {
        system: "lower_limb",
        sourceSpan: "Left common peroneal nerve lesion with combined sensory and motor deficit",
        findingType: "neurological",
        proposedMapping: "Lower-limb common peroneal nerve, combined sensory/motor deficit",
        systemConfidence: 0.9,
        mappingConfidence: 0.85,
        completeness: "missing_calculation_fields",
        explicitlyStatedFields: ["side: left", "nerve: common peroneal", "deficit: combined"],
        inferredFields: [],
        missingFields: ["partial vs total loss"],
        calculationReady: false,
      },
      {
        system: "cns",
        sourceSpan: "Complete anosmia due to traumatic olfactory nerve injury",
        findingType: "cns_component",
        proposedMapping: "CNS Section B olfactory component",
        systemConfidence: 0.85,
        mappingConfidence: 0.8,
        completeness: "unsupported",
        explicitlyStatedFields: ["complete anosmia", "olfactory nerve"],
        inferredFields: [],
        missingFields: [],
        calculationReady: false,
      },
    ],
    unsupportedTerms: [],
    assumptions: [],
    requiresUserConsensus: true,
    createdAt: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

// ── Taxonomy tests ─────────────────────────────────────────────────────────

describe("Slice E — semanticSystemTaxonomy", () => {
  it("provides one entry per GATIOD system", () => {
    const keys = Object.keys(SEMANTIC_SYSTEM_TAXONOMY).sort();
    expect(keys).toEqual([
      "cns",
      "gastro_digestive",
      "hearing",
      "lower_limb",
      "renal",
      "respiratory",
      "spine",
      "upper_limb",
      "visual",
    ]);
  });

  it("derives semanticStatus from V2_SYSTEM_REGISTRY mode (all 9 structured_supported after Sprint 6)", () => {
    expect(getSemanticSystemStatus("cns")).toBe("structured_supported");
    expect(getSemanticSystemStatus("visual")).toBe("structured_supported");
    expect(getSemanticSystemStatus("hearing")).toBe("structured_supported");
    expect(getSemanticSystemStatus("spine")).toBe("structured_supported");
  });

  it("buildSemanticTaxonomyPromptSection includes registry-backed status for every system", () => {
    const text = buildSemanticTaxonomyPromptSection();
    expect(text).toContain("Known GATIOD systems:");
    expect(text).toContain("cns — Central Nervous System — structured_supported");
    expect(text).toContain("hearing — Hearing — structured_supported");
    expect(text).toContain("Clinical signals:");
    expect(text).toContain("Example source span:");
    expect(text).toContain("Common missing fields:");
  });

  it("never includes PI tables, CVC formulas, or assess_* tools in the taxonomy text", () => {
    const text = buildSemanticTaxonomyPromptSection().toLowerCase();
    expect(text).not.toContain("piPercent");
    expect(text).not.toContain("cvc");
    expect(text).not.toContain("assess_");
    expect(text).not.toContain("combined values chart");
  });
});

// ── Prompt builder tests ───────────────────────────────────────────────────

describe("Slice E — prompt builder", () => {
  it("includes all four hard rules in the system prompt", () => {
    const prompt = buildSemanticInterpreterSystemPrompt();
    expect(prompt).toContain("calculationReady");
    expect(prompt).toContain("assess_*");
    expect(prompt).toContain("requiresUserConsensus");
    expect(prompt).toContain("verbatim substring");
  });

  it("does not include PI tables, CVC formulas, or final percentages", () => {
    const prompt = buildSemanticInterpreterSystemPrompt();
    expect(prompt).not.toMatch(/Combined Values Chart/i);
    expect(prompt).not.toMatch(/AHL\s*=\s*\d+%/);
    expect(prompt).not.toContain("piPercent calculation");
  });

  it("user message is single-shot when no edit context is provided", () => {
    const msg = buildSemanticInterpreterUserMessage({ sourceText: SOURCE_TEXT });
    expect(msg).toContain("Clinical input from the doctor:");
    expect(msg).toContain(SOURCE_TEXT);
    expect(msg).not.toContain("Previous interpretation");
  });

  it("user message includes revision context when provided", () => {
    const msg = buildSemanticInterpreterUserMessage({
      sourceText: SOURCE_TEXT,
      previousInterpretationJson: '{"id":"prev"}',
      doctorEditInstruction: "Actually CNS is wrong, ignore it.",
    });
    expect(msg).toContain("Previous interpretation JSON:");
    expect(msg).toContain('{"id":"prev"}');
    expect(msg).toContain("Doctor's edit instruction:");
    expect(msg).toContain("Actually CNS is wrong");
  });
});

// ── Schema tests ───────────────────────────────────────────────────────────

describe("Slice E — Zod schema", () => {
  it("accepts a valid SemanticInterpretation", () => {
    const result = parseSemanticInterpretation(validInterpretation());
    expect(result.ok).toBe(true);
  });

  it("rejects calculationReady: true on a finding", () => {
    const bad = validInterpretation({
      candidateFindings: [
        {
          ...validInterpretation().candidateFindings[0],
          calculationReady: true as unknown as false,
        },
      ],
    });
    const result = parseSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((s) => s.includes("calculationReady"))).toBe(true);
    }
  });

  it("rejects requiresUserConsensus: false", () => {
    const bad = validInterpretation({ requiresUserConsensus: false as unknown as true });
    const result = parseSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects unknown system in candidateSystems", () => {
    const bad = {
      ...validInterpretation(),
      candidateSystems: [
        {
          system: "not_a_real_system",
          confidence: 0.5,
          status: "structured_supported",
          evidence: [],
          rationale: "x",
        },
      ],
    };
    const result = parseSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects extra unknown properties (additionalProperties: false)", () => {
    const bad = {
      ...validInterpretation(),
      smuggledField: "should be rejected",
    };
    const result = SemanticInterpretationSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects empty sourceSpan", () => {
    const bad = validInterpretation({
      candidateFindings: [
        { ...validInterpretation().candidateFindings[0], sourceSpan: "" },
      ],
    });
    const result = parseSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
  });
});

// ── Safety validator tests ─────────────────────────────────────────────────

describe("Slice E — safety validator", () => {
  it("accepts a clean interpretation", () => {
    const result = validateSemanticInterpretation(validInterpretation());
    expect(result.ok).toBe(true);
  });

  it("rejects a sourceSpan that is not in the source text", () => {
    const bad = validInterpretation({
      candidateFindings: [
        {
          ...validInterpretation().candidateFindings[0],
          sourceSpan: "totally fabricated finding not in source",
        },
        validInterpretation().candidateFindings[1],
      ],
    });
    const result = validateSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.kind === "source_span_not_in_text")).toBe(true);
    }
  });

  it("accepts a sourceSpan with whitespace/case normalization", () => {
    const bad = validInterpretation({
      candidateFindings: [
        {
          ...validInterpretation().candidateFindings[0],
          // Same content, different whitespace + casing.
          sourceSpan: "left common peroneal NERVE lesion with combined sensory and motor deficit",
        },
        validInterpretation().candidateFindings[1],
      ],
    });
    const result = validateSemanticInterpretation(bad);
    expect(result.ok).toBe(true);
  });

  it("rejects a forbidden PI token in rationale", () => {
    const bad = validInterpretation();
    bad.candidateSystems[0].rationale = "This is approximately piPercent 30%";
    const result = validateSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.kind === "forbidden_pi_token")).toBe(true);
    }
  });

  it("rejects a forbidden tool token in proposedMapping", () => {
    const bad = validInterpretation();
    bad.candidateFindings[0].proposedMapping = "Call assess_lower_limb to compute";
    const result = validateSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.kind === "forbidden_tool_token")).toBe(true);
    }
  });

  it("rejects when a finding's system is not declared in candidateSystems", () => {
    const bad = validInterpretation();
    bad.candidateFindings.push({
      system: "renal",
      sourceSpan: "Heavy object strike",
      findingType: "renal_function",
      proposedMapping: "renal stuff",
      systemConfidence: 0.5,
      mappingConfidence: 0.5,
      completeness: "missing_calculation_fields",
      explicitlyStatedFields: [],
      inferredFields: [],
      missingFields: [],
      calculationReady: false,
    });
    const result = validateSemanticInterpretation(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((i) => i.kind === "finding_system_not_in_candidates"),
      ).toBe(true);
    }
  });

  it("no legacy systems remain after Sprint 6 — legacy_system_not_labelled never fires", () => {
    // All 9 systems are now structured_live. The validator's legacy_system_not_labelled
    // check will not fire for any current system. The valid fixture (all structured_supported)
    // should pass without that issue.
    const good = validInterpretation();
    const result = validateSemanticInterpretation(good);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect(
        result.issues.every((i) => i.kind !== "legacy_system_not_labelled"),
      ).toBe(true);
    }
  });
});

// ── Renderer tests ─────────────────────────────────────────────────────────

describe("Slice E — proposal renderer", () => {
  it("renders all candidate systems with source spans and missing fields", () => {
    const rendered = renderSemanticConsensus(validInterpretation());
    expect(rendered.message).toContain("2 GATIOD assessment areas");
    expect(rendered.message).toContain("Lower Limb");
    expect(rendered.message).toContain("Central Nervous System");
    // No legacy systems after Sprint 6 — no "legacy/deferred" text.
    expect(rendered.message).not.toContain("legacy/deferred");
    expect(rendered.message).toContain(
      'Source: "Left common peroneal nerve lesion',
    );
    expect(rendered.message).toContain("Missing: partial vs total loss");
  });

  it("includes proposal-kind-specific action chips (multi_system — all structured after Sprint 6)", () => {
    // Fixture: lower_limb (structured_supported) + cns (structured_supported)
    // → multi_system chips per ADR-0003 §6 (no legacy systems remain).
    const rendered = renderSemanticConsensus(validInterpretation());
    expect(rendered.chips).toEqual([
      "Assess Lower Limb first",
      "Assess Central Nervous System first",
      "Proceed",
      "Edit interpretation",
      "Reject",
    ]);
  });

  it("returns candidateSystems in display order", () => {
    const rendered = renderSemanticConsensus(validInterpretation());
    expect(rendered.candidateSystems).toEqual(["lower_limb", "cns"]);
  });

  it("does not render any PI% or assess_* mentions", () => {
    const rendered = renderSemanticConsensus(validInterpretation());
    expect(rendered.message).not.toMatch(/\d+%/);
    expect(rendered.message.toLowerCase()).not.toContain("assess_");
    expect(rendered.message).not.toContain("piPercent");
  });
});

// ── Adapter pipeline tests ─────────────────────────────────────────────────

function makeMockClient(modelOutput: string | (() => Promise<string>)): SemanticModelClient {
  return {
    async generate() {
      if (typeof modelOutput === "function") return modelOutput();
      return modelOutput;
    },
  };
}

describe("Slice E — runSemanticInterpreter pipeline", () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.SEMANTIC_INTERPRETER_ENABLED; delete process.env.SEMANTIC_INTERPRETER_ENABLED; });
  afterEach(() => { if (saved !== undefined) process.env.SEMANTIC_INTERPRETER_ENABLED = saved; else delete process.env.SEMANTIC_INTERPRETER_ENABLED; });

  it("returns feature_flag_disabled when env var is unset", async () => {
    const client = makeMockClient("{}");
    const res = await runSemanticInterpreter({ client, sourceText: SOURCE_TEXT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("feature_flag_disabled");
  });

  it("returns model_returned_non_json on garbage output", async () => {
    const client = makeMockClient("definitely not json");
    const res = await runSemanticInterpreter({
      client,
      sourceText: SOURCE_TEXT,
      forceEnabled: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("model_returned_non_json");
  });

  it("returns schema_validation_failed on a missing required field", async () => {
    // Missing candidateSystems entirely.
    const minimal = JSON.stringify({
      candidateFindings: [],
      unsupportedTerms: [],
      assumptions: [],
    });
    const client = makeMockClient(minimal);
    const res = await runSemanticInterpreter({
      client,
      sourceText: SOURCE_TEXT,
      forceEnabled: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("schema_validation_failed");
  });

  it("returns safety_validation_failed when a sourceSpan is fabricated", async () => {
    const fabricated: SemanticInterpretation = validInterpretation({
      candidateFindings: [
        {
          ...validInterpretation().candidateFindings[0],
          sourceSpan: "NOT IN SOURCE TEXT",
        },
        validInterpretation().candidateFindings[1],
      ],
    });
    const client = makeMockClient(JSON.stringify(fabricated));
    const res = await runSemanticInterpreter({
      client,
      sourceText: SOURCE_TEXT,
      forceEnabled: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe("safety_validation_failed");
      expect(res.safetyIssues?.some((i) => i.kind === "source_span_not_in_text")).toBe(true);
    }
  });

  it("returns ok with backfilled server fields on a clean response", async () => {
    const clean = validInterpretation();
    // Strip server-controlled fields so the adapter must backfill them.
    const stripped = {
      ...clean,
      id: "",
      sourceHash: "wrong",
      createdAt: "wrong",
      sourceText: "WRONG — model echoed wrong source",
    };
    const client = makeMockClient(JSON.stringify(stripped));
    const res = await runSemanticInterpreter({
      client,
      sourceText: SOURCE_TEXT,
      forceEnabled: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.interpretation.sourceText).toBe(SOURCE_TEXT);
      expect(res.interpretation.id.length).toBeGreaterThan(0);
      expect(res.interpretation.sourceHash.length).toBe(64); // sha256 hex
      expect(res.interpretation.requiresUserConsensus).toBe(true);
    }
  });

  it("strips ```json fences from model output before parsing", async () => {
    const fenced = "```json\n" + JSON.stringify(validInterpretation()) + "\n```";
    const client = makeMockClient(fenced);
    const res = await runSemanticInterpreter({
      client,
      sourceText: SOURCE_TEXT,
      forceEnabled: true,
    });
    expect(res.ok).toBe(true);
  });

  it("returns model_call_failed when the client throws", async () => {
    const client: SemanticModelClient = {
      async generate() {
        throw new Error("network error");
      },
    };
    const res = await runSemanticInterpreter({
      client,
      sourceText: SOURCE_TEXT,
      forceEnabled: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe("model_call_failed");
      expect(res.message).toContain("network error");
    }
  });
});
