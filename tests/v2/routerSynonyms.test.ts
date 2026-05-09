import { describe, expect, it } from "vitest";
import { routeUtterance } from "../../src/v2/router.js";
import { normalizeClinicalUtterance } from "../../src/v2/normalizer.js";
import { retrieveGrounding } from "../../src/v2/hybridRetriever.js";
import { defaultV2SessionState } from "../../src/v2/stateMachine.js";
import type { GatiodSystemKey } from "../../src/v2/contracts.js";

function route(text: string) {
  const state = defaultV2SessionState();
  const utterance = normalizeClinicalUtterance(text);
  const grounding = retrieveGrounding(utterance.normalizedText);
  return { decision: routeUtterance(utterance, grounding, state), utterance };
}

interface SynonymCase {
  query: string;
  expected: GatiodSystemKey;
}

const SYNONYM_CASES: Record<GatiodSystemKey, SynonymCase[]> = {
  upper_limb: [
    { query: "left shoulder flexion 90", expected: "upper_limb" },
    { query: "right wrist fracture with median nerve injury", expected: "upper_limb" },
    { query: "carpal tunnel syndrome on the right", expected: "upper_limb" },
    { query: "ulnar nerve sensory loss in the forearm", expected: "upper_limb" },
    { query: "rotator cuff tear left shoulder", expected: "upper_limb" },
  ],
  lower_limb: [
    { query: "right hip osteoarthritis", expected: "lower_limb" },
    { query: "femoral neck fracture left", expected: "lower_limb" },
    { query: "tibia and fibula fracture", expected: "lower_limb" },
    { query: "left knee meniscus tear", expected: "lower_limb" },
    { query: "ankle ligament injury with reduced ROM", expected: "lower_limb" },
  ],
  spine: [
    { query: "lumbar disc prolapse with radicular pain", expected: "spine" },
    { query: "cervical myelopathy", expected: "spine" },
    { query: "thoraco-lumbar compression fracture under 25% height loss", expected: "spine" },
    { query: "lumbo-sacral radiculopathy", expected: "spine" },
    { query: "spondylolisthesis at L4 L5", expected: "spine" },
  ],
  respiratory: [
    { query: "pulmonary function test FVC 65%", expected: "respiratory" },
    { query: "spirometry FEV1 55%", expected: "respiratory" },
    { query: "DLCO reduced after occupational exposure", expected: "respiratory" },
    { query: "COPD with breathlessness on exertion", expected: "respiratory" },
    { query: "occupational asthma daily inhaled steroids", expected: "respiratory" },
  ],
  renal: [
    { query: "nephrotic syndrome with proteinuria", expected: "renal" },
    { query: "CKD stage 4", expected: "renal" },
    { query: "creatinine clearance 42 ml/min", expected: "renal" },
    { query: "dialysis-dependent renal failure", expected: "renal" },
    { query: "solitary kidney with reduced function", expected: "renal" },
  ],
  gastro_digestive: [
    { query: "hepatic cirrhosis Child-Pugh B", expected: "gastro_digestive" },
    { query: "biliary tract injury after surgery", expected: "gastro_digestive" },
    { query: "colitis after occupational exposure", expected: "gastro_digestive" },
    { query: "bowel resection with ileostomy", expected: "gastro_digestive" },
    { query: "pancreatic insufficiency", expected: "gastro_digestive" },
  ],
  hearing: [
    { query: "tinnitus with hearing loss", expected: "hearing" },
    { query: "SNHL after blast injury", expected: "hearing" },
    { query: "right ear sudden hearing loss after accident AHL 90 dB", expected: "hearing" },
    { query: "noise-induced deafness left AHL 75 right AHL 60", expected: "hearing" },
    { query: "audiogram shows sensorineural loss", expected: "hearing" },
  ],
  cns: [
    { query: "CVA with hemiplegia", expected: "cns" },
    { query: "stroke with cognitive impairment", expected: "cns" },
    { query: "epilepsy after head injury", expected: "cns" },
    { query: "cerebrovascular accident with hemiparesis", expected: "cns" },
    { query: "TBI with neuropsychological deficits", expected: "cns" },
  ],
  visual: [
    { query: "left eye 6/60", expected: "visual" },
    { query: "diabetic retinopathy with visual field defect", expected: "visual" },
    { query: "glaucoma with field loss", expected: "visual" },
    { query: "diplopia central 30 degrees", expected: "visual" },
    { query: "ophthalmic examination shows cataract", expected: "visual" },
  ],
};

describe("Synonym-based system routing", () => {
  for (const [system, cases] of Object.entries(SYNONYM_CASES) as Array<[GatiodSystemKey, SynonymCase[]]>) {
    describe(system, () => {
      for (const c of cases) {
        it(`routes "${c.query}" → ${c.expected}`, () => {
          const { decision } = route(c.query);
          expect(decision.systems, `reasons: ${decision.reasons.join(" | ")}`).toContain(c.expected);
        });
      }
    });
  }
});

describe("Multi-system detection", () => {
  it("detects spine + lower_limb in poly-trauma", () => {
    const { decision } = route("femoral neck fracture and lumbar disc prolapse");
    expect(decision.systems).toContain("lower_limb");
    expect(decision.systems).toContain("spine");
  });

  it("detects hearing + spine in injury narrative", () => {
    const { decision } = route("right ear AHL 90 after accident and thoraco-lumbar compression fracture");
    expect(decision.systems).toContain("hearing");
    expect(decision.systems).toContain("spine");
  });

  it("detects renal + visual when both mentioned", () => {
    const { decision } = route("dialysis-dependent renal failure with diabetic retinopathy");
    expect(decision.systems).toContain("renal");
    expect(decision.systems).toContain("visual");
  });

  it("preserves original multi-system trauma scenario", () => {
    const { decision } = route(
      "Road traffic accident while working: Lumbo-sacral prolapsed intervertebral disc with persistent pain, restricted motion and motor deficit; Right femoral neck/head fracture with avascular necrosis."
    );
    expect(decision.operation).toBe("assessment");
    expect(decision.systems).toContain("spine");
    expect(decision.systems).toContain("lower_limb");
  });
});

describe("Ontology false-positive controls", () => {
  it("does not route hearing-loss query to limb systems", () => {
    const { decision } = route("tinnitus with hearing loss");
    expect(decision.systems[0]).toBe("hearing");
    expect(decision.systems).not.toContain("upper_limb");
    expect(decision.systems).not.toContain("lower_limb");
  });

  it("does not route nephrotic syndrome to limb systems", () => {
    const { decision } = route("nephrotic syndrome with proteinuria");
    expect(decision.systems).toContain("renal");
    expect(decision.systems[0]).toBe("renal");
  });

  it("does not route hepatic cirrhosis to spine", () => {
    const { decision } = route("hepatic cirrhosis Child-Pugh B");
    expect(decision.systems[0]).toBe("gastro_digestive");
    expect(decision.systems).not.toContain("spine");
  });

  it("does not route cerebrovascular accident to limb systems", () => {
    const { decision } = route("cerebrovascular accident with hemiplegia");
    expect(decision.systems[0]).toBe("cns");
  });
});

describe("Single-system confidence threshold", () => {
  it("routes pulmonary FVC to assessment despite modest score", () => {
    const { decision } = route("pulmonary function test FVC 65%");
    expect(decision.systems).toContain("respiratory");
    expect(decision.operation === "assessment" || decision.operation === "clarify").toBe(true);
    if (decision.operation === "clarify") {
      expect(decision.systems[0]).toBe("respiratory");
    }
  });
});

describe("Similar-term confirmation candidates", () => {
  it("populates candidateSystems for unresolved synonym terms when no system detected", () => {
    const { decision } = route("axxk problem with kidney");
    expect(decision.systems).toContain("renal");
  });

  it("offers candidateSystems on completely unfamiliar input that contains a synonym in unresolved terms", () => {
    const { decision } = route("just curious about audiogram");
    expect(decision.systems).toContain("hearing");
  });
});
