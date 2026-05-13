import { describe, expect, it } from "vitest";
import { searchOntology } from "../../src/v2/ontologyIndex.js";

describe("ontology retrieval", () => {
  it("finds lower limb DBE avascular necrosis mapping", () => {
    const results = searchOntology("femoral neck head avascular necrosis", 10);
    const hit = results.find((r) => r.canonicalId.includes("femoral_neck_head_avascular_necrosis"));
    expect(hit).toBeTruthy();
    expect(hit?.system).toBe("lower_limb");
  });

  it("finds upper limb nerve alias", () => {
    const results = searchOntology("suprascapular nerve deficit", 10);
    const hit = results.find((r) => r.canonicalId === "suprascapular");
    expect(hit).toBeTruthy();
    expect(hit?.type).toBe("nerve");
  });
});
