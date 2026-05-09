import { describe, expect, it } from "vitest";
import { validateRespiratoryReadiness } from "../../../src/v2/readiness/respiratory.js";
import { buildRespiratoryArgs } from "../../../src/v2/argBuilders/respiratory.js";
import { defaultV2SessionState } from "../../../src/v2/stateMachine.js";
import type { V2SystemFacts, V2SystemState } from "../../../src/v2/contracts.js";
import {
  RESP_FK_DIAGNOSIS,
  RESP_FK_FVC,
  RESP_FK_FEV1,
  RESP_FK_DLCO,
  RESP_FK_VO2MAX,
  RESP_FK_ASTHMA_MAINT,
  RESP_FK_ASTHMA_TRANSFER,
  RESP_FK_ASTHMA_IMPROVE,
  RESP_FK_ASTHMA_MED,
  RESP_FK_ASBESTOSIS_RADIO,
  RESP_FK_ASBESTOSIS_PROFUSION,
} from "../../../src/v2/extractors/respiratory.js";
import type { RespiratoryValue } from "../../../src/engine/respiratoryData.js";

function nowIso() { return new Date().toISOString(); }
function fact<T>(value: T) {
  const now = nowIso();
  return { value, sourceText: "test", confidence: 1, extractionMethod: "regex" as const, createdAt: now, updatedAt: now };
}

function stateWith(facts: V2SystemFacts): V2SystemState {
  return { ...defaultV2SessionState().systems.respiratory, extractedFacts: facts };
}

// ── Readiness validator ────────────────────────────────────────────────────────

describe("validateRespiratoryReadiness", () => {
  it("blocks when pending observations exist", () => {
    const state: V2SystemState = {
      ...defaultV2SessionState().systems.respiratory,
      pendingObservations: [{
        id: "obs1", system: "respiratory", type: "other",
        sourceText: "test", parsed: {}, missingFields: [],
        clarificationQuestion: "?", createdAt: nowIso(), updatedAt: nowIso(),
      }],
    };
    const r = validateRespiratoryReadiness(state);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("pending_observations");
  });

  it("blocks when no PFT values for standard pathway", () => {
    const r = validateRespiratoryReadiness(stateWith({}));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_input");
  });

  it("is ready with FVC only (standard)", () => {
    const r = validateRespiratoryReadiness(stateWith({ [RESP_FK_FVC]: fact(65) }));
    expect(r.ready).toBe(true);
  });

  it("is ready with FEV1 only (standard)", () => {
    const r = validateRespiratoryReadiness(stateWith({ [RESP_FK_FEV1]: fact(72) }));
    expect(r.ready).toBe(true);
  });

  it("is ready with DLCO and VO2Max (standard)", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DLCO]:   fact(55),
      [RESP_FK_VO2MAX]: fact(18),
    }));
    expect(r.ready).toBe(true);
  });

  it("blocks occupational asthma with no PFT and incomplete prerequisites", () => {
    // Slice-17 — readiness rejects incomplete prereqs first, asks about
    // prereqs (not "no_assessable_input" which was the old generic reason).
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]: fact("occupational_asthma"),
      [RESP_FK_ASTHMA_MAINT]: fact(true),
      // missing transfer and improve
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_asthma_prerequisites");
  });

  it("blocks occupational asthma with prerequisites but no medication and no PFT", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]:     fact("occupational_asthma"),
      [RESP_FK_ASTHMA_MAINT]:  fact(true),
      [RESP_FK_ASTHMA_TRANSFER]: fact(true),
      [RESP_FK_ASTHMA_IMPROVE]: fact(true),
      // no PFT, no medication
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_asthma_medication");
    expect(r.candidateAnswers).toContain("Oral steroids");
  });

  it("blocks occupational asthma with all prereqs + medication but no PFT (slice-17)", () => {
    // Slice-17 — engine requires FEV1 > 80 for the medication-based asthma
    // override. Without PFT, readiness now blocks rather than letting the
    // engine silently return 0%.
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]:       fact("occupational_asthma"),
      [RESP_FK_ASTHMA_MAINT]:    fact(true),
      [RESP_FK_ASTHMA_TRANSFER]: fact(true),
      [RESP_FK_ASTHMA_IMPROVE]:  fact(true),
      [RESP_FK_ASTHMA_MED]:      fact("oral_steroids"),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("missing_pft_for_asthma");
  });

  it("is ready occupational asthma with all prerequisites and medication", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]:      fact("occupational_asthma"),
      [RESP_FK_FEV1]:           fact(85),
      [RESP_FK_ASTHMA_MAINT]:   fact(true),
      [RESP_FK_ASTHMA_TRANSFER]: fact(true),
      [RESP_FK_ASTHMA_IMPROVE]: fact(true),
      [RESP_FK_ASTHMA_MED]:     fact("oral_steroids"),
    }));
    expect(r.ready).toBe(true);
  });

  it("blocks asbestosis with no PFT and missing radiological qualifier", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]: fact("asbestosis_silicosis"),
    }));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("no_assessable_input");
  });

  it("is ready asbestosis with FVC", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]: fact("asbestosis_silicosis"),
      [RESP_FK_FVC]:       fact(65),
    }));
    expect(r.ready).toBe(true);
  });

  it("is ready asbestosis with radiological + at_least_1_1 profusion (no PFT needed)", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]:           fact("asbestosis_silicosis"),
      [RESP_FK_ASBESTOSIS_RADIO]:    fact(true),
      [RESP_FK_ASBESTOSIS_PROFUSION]: fact("at_least_1_1"),
    }));
    expect(r.ready).toBe(true);
  });

  it("blocks asbestosis radiologically definite but profusion below_1_1 with no PFT", () => {
    const r = validateRespiratoryReadiness(stateWith({
      [RESP_FK_DIAGNOSIS]:           fact("asbestosis_silicosis"),
      [RESP_FK_ASBESTOSIS_RADIO]:    fact(true),
      [RESP_FK_ASBESTOSIS_PROFUSION]: fact("below_1_1"),
    }));
    expect(r.ready).toBe(false);
  });
});

// ── Arg builder ────────────────────────────────────────────────────────────────

describe("buildRespiratoryArgs", () => {
  it("builds valid args for standard FVC", () => {
    const r = buildRespiratoryArgs({ [RESP_FK_FVC]: fact(65) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RespiratoryValue;
      expect(args.diagnosis).toBe("standard");
      expect(args.fvc).toBe(65);
      expect(args.fev1).toBeNull();
      expect(r.toolName).toBe("assess_respiratory");
      expect(r.provenance.factsHash).toHaveLength(16);
    }
  });

  it("zero-fills boolean asthma flags as false", () => {
    const r = buildRespiratoryArgs({ [RESP_FK_FVC]: fact(65) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RespiratoryValue;
      expect(args.asthmaRequiresDailyMaintenance).toBe(false);
      expect(args.asthmaTransferredFromExposureOneYear).toBe(false);
      expect(args.asthmaUnlikelyFurtherImprovement).toBe(false);
    }
  });

  it("builds valid args for occupational asthma with medication", () => {
    const r = buildRespiratoryArgs({
      [RESP_FK_DIAGNOSIS]:       fact("occupational_asthma"),
      [RESP_FK_FEV1]:            fact(85),
      [RESP_FK_ASTHMA_MAINT]:    fact(true),
      [RESP_FK_ASTHMA_TRANSFER]: fact(true),
      [RESP_FK_ASTHMA_IMPROVE]:  fact(true),
      [RESP_FK_ASTHMA_MED]:      fact("oral_steroids"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RespiratoryValue;
      expect(args.diagnosis).toBe("occupational_asthma");
      expect(args.asthmaMedication).toBe("oral_steroids");
      expect(args.asthmaRequiresDailyMaintenance).toBe(true);
    }
  });

  it("builds valid args for asbestosis with profusion", () => {
    const r = buildRespiratoryArgs({
      [RESP_FK_DIAGNOSIS]:            fact("asbestosis_silicosis"),
      [RESP_FK_FVC]:                  fact(65),
      [RESP_FK_ASBESTOSIS_RADIO]:     fact(true),
      [RESP_FK_ASBESTOSIS_PROFUSION]: fact("at_least_1_1"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RespiratoryValue;
      expect(args.diagnosis).toBe("asbestosis_silicosis");
      expect(args.asbestosisRadiologicallyDefinite).toBe(true);
      expect(args.asbestosisProfusion).toBe("at_least_1_1");
    }
  });

  it("defaults asbestosisProfusion to below_1_1 when not supplied", () => {
    const r = buildRespiratoryArgs({
      [RESP_FK_DIAGNOSIS]: fact("asbestosis_silicosis"),
      [RESP_FK_FVC]:       fact(65),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as RespiratoryValue;
      expect(args.asbestosisProfusion).toBe("below_1_1");
    }
  });

  it("includes provenance with user-supplied keys", () => {
    const r = buildRespiratoryArgs({
      [RESP_FK_FVC]:  fact(65),
      [RESP_FK_FEV1]: fact(58),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.userSupplied).toContain(RESP_FK_FVC);
      expect(r.provenance.userSupplied).toContain(RESP_FK_FEV1);
    }
  });
});
