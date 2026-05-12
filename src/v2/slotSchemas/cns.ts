/**
 * CNS slot schema — ADR-0004.
 *
 * Single source of truth for CNS fact keys, value types, D2 inference
 * boundary, clarification specs, and required_when conditions.
 *
 * Three sections:
 *   Section A — cerebral impairment (Groups 1–4)
 *   Section B — cranial nerve / neurological functions (six components)
 *   Section C — paralysed limbs
 *
 * Policy fix §1 applied: Section B components are olfaction, facial nerve,
 * equilibrium, swallowing, station-gait, and respiration — NOT bladder/bowel/
 * sexual/spasms/pressure sores (those are spine complications).
 *
 * Severity bracket IDs are D2 boundary — the doctor must state or select from
 * offered chips. candidateAnswers: [] indicates chips are populated dynamically
 * from the engine bracket data at runtime.
 *
 * Consumers:
 *   - LLM slot extractor (prompt context)
 *   - deriveReadinessValidator (always: "never" — cross-slot guards handle CNS)
 *   - validateCnsReadinessFromSchema wrapper (specialist confirmation gates)
 *   - arg builder (slot presence assertions)
 */

import type { SlotDefinition } from "./types.js";

// ── Fact key union ────────────────────────────────────────────────────────────

export type CnsFactKey =
  // Section A
  | "cns_g1a_bracketId"
  | "cns_g1b_bracketId"
  | "cns_g1c_bracketId"
  | "cns_g2_bracketId"
  | "cns_g2_neuro_confirmed"
  | "cns_g3_bracketId"
  | "cns_g4_bracketId"
  | "cns_g4_psych_confirmed"
  // Section B
  | "cns_b_olfaction_bracketId"
  | "cns_b_facial_bracketId"
  | "cns_b_equilibrium_bracketId"
  | "cns_b_equilibrium_ent_confirmed"
  | "cns_b_swallowing_bracketId"
  | "cns_b_station_gait_bracketId"
  | "cns_b_respiration_bracketId"
  // Section C
  | "cns_c_paralysed_limbs";

// ── Schema ────────────────────────────────────────────────────────────────────

export const cnsSlotSchema: SlotDefinition<CnsFactKey>[] = [

  // ── Section A — Group 1: Consciousness / Episodic / Arousal ─────────────────

  {
    factKey: "cns_g1a_bracketId",
    label: "Section A — Group 1A: Consciousness impairment bracket",
    description:
      'Severity bracket ID for consciousness / awareness impairment.\n\n' +
      'Trigger keywords: "consciousness", "awareness", "coma", "semi-coma", ' +
      '"vegetative state", "altered consciousness"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. The doctor must state or ' +
      'select a severity bracket. Do NOT infer from clinical descriptions.\n' +
      'The bracket ID is an opaque engine value (e.g. "c_none", "c_mild"). ' +
      'Emit a PendingObservation with chips populated dynamically at runtime.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the consciousness impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_g1a_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_g1b_bracketId",
    label: "Section A — Group 1B: Episodic neurological impairment bracket",
    description:
      'Severity bracket ID for episodic neurological impairment (epilepsy / seizures).\n\n' +
      'Trigger keywords: "epilepsy", "epileptic", "seizure", "fits", ' +
      '"paroxysmal neurological", "episodic neurological"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the episodic neurological impairment (epilepsy/seizures)?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_g1b_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_g1c_bracketId",
    label: "Section A — Group 1C: Arousal/sleep disorder bracket",
    description:
      'Severity bracket ID for arousal or sleep disorder impairment.\n\n' +
      'Trigger keywords: "arousal", "sleep disorder", "narcolepsy", "hypersomnia", ' +
      '"somnolence", "altered alertness"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the arousal/sleep disorder impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_g1c_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  // ── Section A — Group 2: Mental status / Cognition ──────────────────────────

  {
    factKey: "cns_g2_bracketId",
    label: "Section A — Group 2: Mental status / cognition bracket",
    description:
      'Severity bracket ID for mental status or cognitive impairment.\n\n' +
      'Trigger keywords: "cognitive impairment", "cognition", "dementia", ' +
      '"memory loss", "memory impairment", "neuropsychological"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.\n\n' +
      'Important: a non-zero bracket requires neuropsychologist confirmation ' +
      '(cns_g2_neuro_confirmed). The readiness validator enforces this gate.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the mental status / cognitive impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_g2_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_g2_neuro_confirmed",
    label: "Group 2: Neuropsychologist confirmation",
    description:
      'Whether the cognitive impairment has been confirmed by a neuropsychologist.\n\n' +
      'true — "confirmed by neuropsychologist", "neuropsychologist confirmed", ' +
      '"neuropsychological assessment confirmed"\n\n' +
      'Required whenever cns_g2_bracketId is a non-"none" bracket.\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Must be explicitly confirmed.',
    valueType: "boolean",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "Has the cognitive impairment been confirmed by a neuropsychologist?",
      candidateAnswers: ["Yes, neuropsychologist confirmed", "No"],
      expectedAnswer: { kind: "boolean", factKey: "cns_g2_neuro_confirmed" },
    },
    required_when: { fact: "cns_g2_bracketId", present: true },
  },

  // ── Section A — Group 3: Dysphasia / Aphasia ────────────────────────────────

  {
    factKey: "cns_g3_bracketId",
    label: "Section A — Group 3: Dysphasia / aphasia bracket",
    description:
      'Severity bracket ID for dysphasia or aphasia.\n\n' +
      'Trigger keywords: "dysphasia", "aphasia", "language impairment", ' +
      '"speech production", "expressive aphasia", "receptive aphasia"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the dysphasia / aphasia?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_g3_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  // ── Section A — Group 4: Emotional / behavioural ────────────────────────────

  {
    factKey: "cns_g4_bracketId",
    label: "Section A — Group 4: Emotional / behavioural impairment bracket",
    description:
      'Severity bracket ID for emotional or behavioural impairment.\n\n' +
      'Trigger keywords: "emotional impairment", "behavioural impairment", ' +
      '"psychiatric impairment", "mood impairment", "personality change", ' +
      '"confirmed by psychiatrist"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.\n\n' +
      'Important: a non-zero bracket requires psychiatrist confirmation ' +
      '(cns_g4_psych_confirmed).',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the emotional / behavioural impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_g4_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_g4_psych_confirmed",
    label: "Group 4: Psychiatrist confirmation",
    description:
      'Whether the emotional/behavioural impairment has been confirmed by a psychiatrist.\n\n' +
      'true — "confirmed by psychiatrist", "psychiatrist confirmed", ' +
      '"psychiatric assessment confirmed"\n\n' +
      'Required whenever cns_g4_bracketId is a non-"none" bracket.\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Must be explicitly confirmed.',
    valueType: "boolean",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "Has the emotional/behavioural impairment been confirmed by a psychiatrist?",
      candidateAnswers: ["Yes, psychiatrist confirmed", "No"],
      expectedAnswer: { kind: "boolean", factKey: "cns_g4_psych_confirmed" },
    },
    required_when: { fact: "cns_g4_bracketId", present: true },
  },

  // ── Section B — Cranial nerve / neurological functions ──────────────────────
  //
  // Policy fix §1: Section B components are olfaction, facial nerve, equilibrium,
  // swallowing, station-gait, and respiration. NOT bladder/bowel/sexual/spasms/
  // pressure sores (those are spine complications, not CNS Section B).

  {
    factKey: "cns_b_olfaction_bracketId",
    label: "Section B — Olfaction impairment bracket",
    description:
      'Severity bracket ID for olfaction (smell) impairment.\n\n' +
      'Trigger keywords: "olfaction", "anosmia", "hyposmia", "smell impairment", ' +
      '"loss of smell", "decreased smell"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the olfaction (smell) impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_b_olfaction_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_b_facial_bracketId",
    label: "Section B — Facial nerve impairment bracket",
    description:
      'Severity bracket ID for facial nerve impairment.\n\n' +
      'Trigger keywords: "facial nerve", "facial palsy", "Bell\'s palsy", ' +
      '"facial paralysis", "facial weakness"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the facial nerve impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_b_facial_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_b_equilibrium_bracketId",
    label: "Section B — Equilibrium impairment bracket",
    description:
      'Severity bracket ID for equilibrium (balance/vestibular) impairment.\n\n' +
      'Trigger keywords: "equilibrium", "balance disorder", "vestibular", ' +
      '"vertigo", "dizziness with balance", "labyrinthitis"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.\n\n' +
      'Important: a non-zero bracket requires ENT specialist confirmation ' +
      '(cns_b_equilibrium_ent_confirmed).',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the equilibrium impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_b_equilibrium_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_b_equilibrium_ent_confirmed",
    label: "Equilibrium: ENT specialist confirmation",
    description:
      'Whether the equilibrium impairment has been confirmed by an ENT specialist.\n\n' +
      'true — "confirmed by ENT", "ENT confirmed", "ENT specialist assessment"\n\n' +
      'Required whenever cns_b_equilibrium_bracketId is a non-"none" bracket.\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Must be explicitly confirmed.',
    valueType: "boolean",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "Has the equilibrium impairment been confirmed by an ENT specialist?",
      candidateAnswers: ["Yes, ENT confirmed", "No"],
      expectedAnswer: { kind: "boolean", factKey: "cns_b_equilibrium_ent_confirmed" },
    },
    required_when: { fact: "cns_b_equilibrium_bracketId", present: true },
  },

  {
    factKey: "cns_b_swallowing_bracketId",
    label: "Section B — Swallowing impairment bracket",
    description:
      'Severity bracket ID for swallowing (deglutition) impairment.\n\n' +
      'Trigger keywords: "swallowing", "dysphagia", "deglutition", ' +
      '"difficulty swallowing", "swallowing disorder"\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the swallowing impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_b_swallowing_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_b_station_gait_bracketId",
    label: "Section B — Station and gait impairment bracket",
    description:
      'Severity bracket ID for station and gait impairment.\n\n' +
      'Trigger keywords: "station and gait", "gait disturbance", ' +
      '"ataxia", "gait impairment", "cerebellar gait", "walking impairment"\n\n' +
      'Note: station-gait is a CNS Section B finding. Do NOT confuse with spine ' +
      'walking limitation — look for neurological gait descriptors.\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the station and gait impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_b_station_gait_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  {
    factKey: "cns_b_respiration_bracketId",
    label: "Section B — CNS-related respiration impairment bracket",
    description:
      'Severity bracket ID for CNS-related respiration impairment (neurological control).\n\n' +
      'Trigger keywords: "respiratory impairment" in CNS context, ' +
      '"neurogenic respiratory", "CNS-related breathing"\n\n' +
      'Important: this is the CNS Section B respiration bracket for neurological ' +
      'respiratory control — NOT pulmonary function (PFT values belong to respiratory system).\n\n' +
      'D2 boundary — clinicalInferenceAllowed: false. Emit PendingObservation with chips.',
    valueType: "string",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "What is the severity bracket for the CNS-related respiration impairment?",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_b_respiration_bracketId",
        choices: [],
      },
    },
    required_when: "never",
  },

  // ── Section C — Paralysed limbs ──────────────────────────────────────────────

  {
    factKey: "cns_c_paralysed_limbs",
    label: "Section C — Paralysed limbs",
    description: `Array of paralysed limb identifiers for Section C.

The doctor selects which limbs are paralysed. Each entry is a limb option label
from the engine's PARALYSED_LIMB_OPTIONS list. Chips are populated at runtime.

Extraction rules:
  - Extract from explicit paralysis mentions: "right arm paralysed", "left leg paralysis",
    "monoplegia right arm", "hemiplegia", "paraplegia", "quadriplegia".
  - Do NOT extract weakness or reduced ROM as paralysis — paralysis implies complete/near-complete loss.
  - Multiple limbs may be extracted from a single utterance.

D2 boundary: the specific limb option IDs must match the engine's PARALYSED_LIMB_OPTIONS.
If uncertain which option applies, emit a PendingObservation.`,
    valueType: "array",
    clinicalInferenceAllowed: false,
    clarification: {
      question: "Which limbs are paralysed? Please select all that apply.",
      candidateAnswers: [],
      expectedAnswer: {
        kind: "enum",
        factKey: "cns_c_paralysed_limbs",
        choices: [],
      },
    },
    required_when: "never",
  },
];
