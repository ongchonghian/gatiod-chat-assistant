import { processChatV2 } from "../src/chat/chatServiceV2.js";
import { loadExcelFixture, singleSystemScenariosFor } from "../tests/v2/excelScenarios/loadFixture.js";

async function main() {
  process.env.GATIOD_DB_PATH = ":memory:";
  const all = singleSystemScenariosFor("lower_limb");
  const SAMPLE = 30;
  const stride = Math.max(1, Math.floor(all.length / SAMPLE));
  const sample = [];
  for (let i = 0; sample.length < SAMPLE && i < all.length; i += stride) sample.push(all[i]);

  const wrongPi = [];
  for (const sc of sample) {
    const c = sc.components[0];
    if (c.outcomeClass !== "exact_calculation") continue;
    const sid = "trace-" + sc.rowId;
    let r = await processChatV2(sid, sc.inputText, { shadow: true });
    if (r.needsClarification && /\*\*Confirmation —/.test(r.message)) {
      r = await processChatV2(sid, "Confirmed", { shadow: true });
    } else if (/please\s+confirm\s+if\s+you\s+want\s+me\s+to\s+proceed/i.test(r.message)) {
      r = await processChatV2(sid, "Confirmed", { shadow: true });
    }
    const assess = r.toolPlan.actual.find((c) => c.name === "assess_lower_limb" && c.status === "executed");
    if (!assess) continue;
    const result = (assess.result ?? {}) as Record<string, unknown>;
    const observed = typeof result.finalPercent === "number" ? result.finalPercent : null;
    let matches = false;
    if (observed !== null) {
      if (typeof c.expectedPiPercent === "number") matches = Math.abs(observed - c.expectedPiPercent) < 0.5;
      else if (c.expectedPiRange) matches = observed >= c.expectedPiRange[0] - 0.5 && observed <= c.expectedPiRange[1] + 0.5;
    }
    if (!matches) {
      wrongPi.push({
        rowId: sc.rowId,
        input: sc.inputText.slice(0, 100),
        expected: c.expectedPiPercent ?? c.expectedPiRange,
        observed,
      });
    }
  }
  for (const w of wrongPi) {
    console.log(w.rowId + ": expected=" + JSON.stringify(w.expected) + " observed=" + w.observed);
    console.log("  " + w.input);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
