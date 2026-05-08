import type { BuildResult, V2SystemFacts } from "../contracts.js";
import { hashExtractedFacts } from "../stateMachine.js";
import { RespiratoryValueSchema, type RespiratoryValue } from "../../engine/respiratoryData.js";
import {
  RESP_FK_DIAGNOSIS,
  RESP_FK_FVC,
  RESP_FK_FEV1,
  RESP_FK_DLCO,
  RESP_FK_VO2MAX,
  RESP_FK_DYSPNOEA,
  RESP_FK_ASTHMA_MAINT,
  RESP_FK_ASTHMA_TRANSFER,
  RESP_FK_ASTHMA_IMPROVE,
  RESP_FK_ASTHMA_MED,
  RESP_FK_ASBESTOSIS_RADIO,
  RESP_FK_ASBESTOSIS_PROFUSION,
} from "../extractors/respiratory.js";

export function buildRespiratoryArgs(facts: V2SystemFacts): BuildResult<RespiratoryValue> {
  const userSupplied: string[] = [];
  const builderZeroFilled: string[] = [];

  function read<T>(key: string, fallback: T): T {
    if (facts[key] !== undefined) {
      userSupplied.push(key);
      return facts[key].value as T;
    }
    builderZeroFilled.push(key);
    return fallback;
  }

  const args: RespiratoryValue = {
    diagnosis:                            read<RespiratoryValue["diagnosis"]>(RESP_FK_DIAGNOSIS, "standard"),
    fvc:                                  read<number | null>(RESP_FK_FVC,   null),
    fev1:                                 read<number | null>(RESP_FK_FEV1,  null),
    dlco:                                 read<number | null>(RESP_FK_DLCO,  null),
    vo2Max:                               read<number | null>(RESP_FK_VO2MAX, null),
    dyspnoea:                             read<RespiratoryValue["dyspnoea"]>(RESP_FK_DYSPNOEA, null),
    asthmaRequiresDailyMaintenance:       read<boolean>(RESP_FK_ASTHMA_MAINT,    false),
    asthmaTransferredFromExposureOneYear: read<boolean>(RESP_FK_ASTHMA_TRANSFER, false),
    asthmaUnlikelyFurtherImprovement:     read<boolean>(RESP_FK_ASTHMA_IMPROVE,  false),
    asthmaMedication:                     read<RespiratoryValue["asthmaMedication"]>(RESP_FK_ASTHMA_MED, null),
    asbestosisRadiologicallyDefinite:     read<boolean>(RESP_FK_ASBESTOSIS_RADIO, false),
    asbestosisProfusion:                  read<RespiratoryValue["asbestosisProfusion"]>(RESP_FK_ASBESTOSIS_PROFUSION, "below_1_1"),
    selectedPi:                           null,
  };

  const parsed = RespiratoryValueSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: ["Schema validation failed."],
      zodErrors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return {
    ok: true,
    toolName: "assess_respiratory",
    args: parsed.data,
    warnings: [],
    provenance: {
      userSupplied,
      builderZeroFilled,
      factsHash: hashExtractedFacts(facts),
    },
  };
}
