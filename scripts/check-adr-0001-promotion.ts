// CI-time ADR-0001 promotion gate. Reads the latest per-system calibration
// reports under tests/v2/excelScenarios/<system>.calibration.generated.json
// and feeds them to validateStructuredLivePromotion() in evidence mode.
//
// Run via `npm run check:adr-0001-promotion`. Designed for CI to catch:
//   - A system flipped to structured_live without running the shadow runner
//   - A system whose latest evidence dropped below threshold
//   - A drift between the registry's allowlist and the actual evidence
//
// The shadow runner is opt-in (GATIOD_RUN_EXCEL_SCENARIOS=true), so this
// script only validates whatever calibration files are checked in. Run
// `npm run test:excel-shadow` first to refresh evidence; commit the
// resulting *.calibration.generated.json files.

import { validateStructuredLivePromotion } from "../src/v2/systemRegistry.js";
import { FileCalibrationEvidenceReader } from "./calibration/fileCalibrationEvidenceReader.js";

const fileEvidence = new FileCalibrationEvidenceReader();

function main(): void {
  const result = validateStructuredLivePromotion(fileEvidence);

  if (result.warnings.length > 0) {
    console.log("ADR-0001 promotion warnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  if (result.failures.length > 0) {
    console.error("");
    console.error("✗ ADR-0001 promotion check failed:");
    for (const f of result.failures) console.error(`  - ${f}`);
    console.error("");
    console.error("Each failure means a system is currently `structured_live`");
    console.error("but lacks ADR-0001 promotion evidence at threshold.");
    console.error("Either improve the system, demote it, or update the policy.");
    process.exit(1);
  }

  console.log("✓ ADR-0001 promotion check passed.");
}

main();
