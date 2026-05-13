import { describe, expect, it } from "vitest";
import { extractSpine } from "../../../src/v2/extractors/spine.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { NormalizedUtterance } from "../../../src/v2/contracts.js";
import type { SpineCategoryEntryFact } from "../../../src/v2/extractors/spine.js";

function utt(text: string): NormalizedUtterance {
  return {
    raw: text,
    normalizedText: text.toLowerCase(),
    tokens: text.split(/\s+/),
    mappedTokens: [],
    unresolvedTerms: [],
    confidence: 0.9,
  };
}

function emptySystemState() {
  return defaultV2SessionState().systems.spine;
}

// ── Region extraction ─────────────────────────────────────────────────────────

describe("region extraction", () => {
  it("extracts cervical", () => {
    const r = extractSpine(utt("cervical spine fracture"), emptySystemState());
    expect(r.extractedFactsPatch["spine_region"]?.value).toBe("cervical");
    expect(r.slotSignalsPatch.region).toBe(true);
  });

  it("extracts thoraco_lumbar", () => {
    const r = extractSpine(utt("thoracolumbar fracture T12"), emptySystemState());
    expect(r.extractedFactsPatch["spine_region"]?.value).toBe("thoraco_lumbar");
  });

  it("extracts lumbo_sacral for lumbar", () => {
    const r = extractSpine(utt("lumbar disc prolapse"), emptySystemState());
    expect(r.extractedFactsPatch["spine_region"]?.value).toBe("lumbo_sacral");
  });

  it("extracts lumbo_sacral for lumbosacral", () => {
    const r = extractSpine(utt("lumbosacral spondylolisthesis"), emptySystemState());
    expect(r.extractedFactsPatch["spine_region"]?.value).toBe("lumbo_sacral");
  });
});

// ── Category + severity extraction ───────────────────────────────────────────

describe("fractures_dislocations", () => {
  it("extracts fracture category with ASIA D severity", () => {
    const r = extractSpine(utt("cervical fracture dislocation ASIA D"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries).toHaveLength(1);
    expect(entries[0].diagnosisCategory).toBe("fractures_dislocations");
    expect(entries[0].severityKey).toBe("asia_d");
  });

  it("extracts fracture with ASIA B (paraplegia)", () => {
    const r = extractSpine(utt("cervical fracture paraplegia"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].severityKey).toBe("asia_ba");
  });

  it("extracts compression fracture >25%", () => {
    const r = extractSpine(utt("cervical compression fracture greater than 25%"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].severityKey).toBe("compression_gt25");
  });

  it("extracts compression fracture <25%", () => {
    const r = extractSpine(utt("lumbar compression fracture less than 25%"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].severityKey).toBe("compression_lt25");
  });

  it("extracts monoparesis modifier on ASIA D", () => {
    const r = extractSpine(utt("cervical fracture ASIA D monoparesis"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].monoparesisHalving).toBe(true);
  });

  it("extracts bladder and bowel incontinence", () => {
    const r = extractSpine(utt("cervical fracture ASIA C incomplete bladder and bowel incontinence"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].bladderBowelSeverity).toBe("incomplete_both");
  });

  it("creates severity_bracket pending obs when severity missing", () => {
    const r = extractSpine(utt("cervical fracture dislocation"), emptySystemState());
    expect(r.extractedFactsPatch["spine_entries"]).toBeUndefined();
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("severity_bracket");
    expect(r.pendingObservationsToAdd[0].parsed["diagnosisCategory"]).toBe("fractures_dislocations");
    expect(r.pendingObservationsToAdd[0].candidateAnswers?.length).toBeGreaterThan(0);
  });
});

describe("spinal_cord_injury", () => {
  it("extracts cord injury category with ASIA C", () => {
    const r = extractSpine(utt("lumbar spinal cord injury ASIA C"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].diagnosisCategory).toBe("spinal_cord_injury");
    expect(entries[0].severityKey).toBe("asia_c");
  });

  it("extracts cauda equina with radicular severity", () => {
    const r = extractSpine(utt("lumbar cauda equina persistent radicular pain"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].diagnosisCategory).toBe("spinal_cord_injury");
    expect(entries[0].severityKey).toBe("persistent_radicular");
  });

  it("extracts myelopathy as cord injury", () => {
    const r = extractSpine(utt("cervical myelopathy mild sensory motor"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].diagnosisCategory).toBe("spinal_cord_injury");
    expect(entries[0].severityKey).toBe("mild_sensory_motor");
  });
});

describe("intervertebral_disc", () => {
  it("extracts prolapsed disc with motor deficit", () => {
    const r = extractSpine(utt("lumbar disc prolapse persistent pain motor deficit"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].diagnosisCategory).toBe("intervertebral_disc");
    expect(entries[0].severityKey).toBe("disc31_persistent_motor_or_motor_sensory");
  });

  it("extracts disc with residual pain", () => {
    const r = extractSpine(utt("cervical intervertebral disc residual pain"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].severityKey).toBe("disc31_residual");
  });

  it("extracts disc with sensory deficit", () => {
    const r = extractSpine(utt("lumbar disc prolapse persistent sensory deficit"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].severityKey).toBe("disc31_persistent_sensory");
  });

  it("marks cord involvement for disc", () => {
    // Include severity so the entry graduates to extractedFacts
    const r = extractSpine(utt("cervical disc prolapse cord involvement residual pain"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[] | undefined;
    expect(entries).toBeDefined();
    expect(entries![0].discCordInvolvement).toBe(true);
    expect(entries![0].diagnosisCategory).toBe("intervertebral_disc");
  });
});

describe("spondylolysis_spondylolisthesis", () => {
  it("extracts spondylolisthesis with pre-existing pathway", () => {
    const r = extractSpine(utt("lumbar spondylolisthesis pre-existing residual pain"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].diagnosisCategory).toBe("spondylolysis_spondylolisthesis");
    expect(entries[0].severityKey).toBe("spondy_preexisting_residual");
    expect(entries[0].spondylolysisPathway).toBe("pre_existing_superimposed");
  });

  it("creates severity_bracket pending obs for spondylolisthesis without severity", () => {
    const r = extractSpine(utt("lumbar spondylolisthesis"), emptySystemState());
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].type).toBe("severity_bracket");
    expect(r.pendingObservationsToAdd[0].parsed["diagnosisCategory"]).toBe("spondylolysis_spondylolisthesis");
  });
});

describe("chronic_pain_normal_mri", () => {
  it("extracts chronic pain attributable", () => {
    const r = extractSpine(utt("chronic pain normal MRI attributable to injury"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].diagnosisCategory).toBe("chronic_pain_normal_mri");
    expect(entries[0].severityKey).toBe("chronic_pain_attributable");
  });

  it("extracts chronic pain not attributable", () => {
    const r = extractSpine(utt("chronic spinal pain normal MRI not attributable"), emptySystemState());
    const entries = r.extractedFactsPatch["spine_entries"]?.value as SpineCategoryEntryFact[];
    expect(entries[0].severityKey).toBe("chronic_pain_not_attributable");
  });
});

describe("region-less severity pending obs", () => {
  it("creates spine_region obs when category known but region unknown", () => {
    const r = extractSpine(utt("fracture dislocation no region stated"), emptySystemState());
    // No region → asks for region first
    expect(r.pendingObservationsToAdd).toHaveLength(1);
    expect(r.pendingObservationsToAdd[0].parsed["subtype"]).toBe("spine_region");
    expect(r.pendingObservationsToAdd[0].candidateAnswers).toContain("Cervical (C1–C7)");
  });
});
