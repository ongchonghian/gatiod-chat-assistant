import type { ReadinessResult, V2SystemState } from "../contracts.js";
import { SP_FK_REGION, SP_FK_ENTRIES, type SpineCategoryEntryFact } from "../extractors/spine.js";
import { isMonoparesisApplicableSeverity, isBladderBowelApplicableSeverity, type SeverityKey } from "../../engine/spineAssessmentData.js";

export function validateSpineReadiness(systemState: V2SystemState): ReadinessResult {
  const facts = systemState.extractedFacts;

  if (systemState.pendingObservations.length > 0) {
    const first = systemState.pendingObservations[0];
    return {
      ready: false,
      reason: "pending_observations",
      missingFields: first.missingFields,
      clarificationQuestion: first.clarificationQuestion,
      candidateAnswers: first.candidateAnswers,
    };
  }

  if (!facts[SP_FK_REGION]) {
    return {
      ready: false,
      reason: "missing_region",
      missingFields: ["spine_region"],
      clarificationQuestion: "Which spinal region is affected?",
      candidateAnswers: ["Cervical (C1–C7)", "Thoraco-Lumbar (T1–L1)", "Lumbo-Sacral (L2–S1)"],
    };
  }

  const entries = (facts[SP_FK_ENTRIES]?.value ?? []) as SpineCategoryEntryFact[];

  if (entries.length === 0) {
    const choices = [
      "Fractures / Dislocations",
      "Spinal Cord / Cauda Equina Injury",
      "Intervertebral Disc",
      "Spondylolysis / Spondylolisthesis",
      "Chronic Pain with Normal MRI",
    ];
    return {
      ready: false,
      reason: "no_assessable_finding",
      missingFields: ["diagnosis_category"],
      clarificationQuestion:
        "What is the spinal diagnosis? (e.g. fracture/dislocation, cord injury, disc prolapse, spondylolysis, or chronic pain with normal MRI)",
      candidateAnswers: choices,
      expectedAnswer: {
        kind: "enum",
        choices,
        factKey: "spine_diagnosis_category",
      },
    };
  }

  // All entries must have a severity key
  for (const entry of entries) {
    if (!entry.severityKey) {
      return {
        ready: false,
        reason: "missing_severity",
        missingFields: ["severityKey"],
        clarificationQuestion: `Which severity row applies for the ${entry.diagnosisCategory.replace(/_/g, " ")} diagnosis?`,
        candidateAnswers: [],
      };
    }
  }

  // D2: ASIA grade implies monoparesis gate must be answered (default false is acceptable
  // when not stated — monoparesis is an explicit yes, absence = no).
  // Disc cord involvement gate: if category is disc but cord is involved, should route to cord injury.
  for (const entry of entries) {
    if (
      entry.diagnosisCategory === "intervertebral_disc" &&
      entry.discCordInvolvement
    ) {
      return {
        ready: false,
        reason: "disc_cord_reroute",
        missingFields: ["diagnosisCategory"],
        clarificationQuestion:
          "Cord or cauda equina involvement is present. This should be scored under Spinal Cord Injury (Section 2), not the Intervertebral Disc section. Please confirm or correct the diagnosis category.",
        candidateAnswers: ["Use Spinal Cord Injury", "Keep Intervertebral Disc"],
      };
    }
  }

  return { ready: true };
}
