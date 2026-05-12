/**
 * Gemini Function Calling Tool Schemas
 *
 * These define the tool interface the LLM uses to drive the calculation engine.
 * The LLM never does math — it extracts structured data and calls these tools.
 */

import { SchemaType } from "@google/generative-ai";

// The Gemini SDK's FunctionDeclaration types are stricter than the API requires
// (e.g. requiring `format` on enum strings). We define schemas correctly for the API
// and use a type assertion to satisfy TypeScript.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_DECLARATIONS: any[] = [
  {
    name: "assess_upper_limb",
    description:
      "Run the full GATIOD Upper Limb assessment calculation. Takes structured clinical findings and returns PI% with full breakdown including amputations, ROM, neurological, DBE, conflict resolution, CVC sequence, and final PI%. ONLY call this after the doctor has confirmed the extracted values.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        side: {
          type: SchemaType.STRING,
          enum: ["left", "right"],
          description: "Which upper limb is being assessed.",
        },
        amputations: {
          type: SchemaType.OBJECT,
          description: "Amputation findings. armLevel is 'none', 'above_elbow', 'below_elbow', or 'hand'. Each finger is 'none' or a phalanx level id.",
          properties: {
            armLevel: { type: SchemaType.STRING },
            fingers: {
              type: SchemaType.OBJECT,
              properties: {
                thumb: { type: SchemaType.STRING },
                index: { type: SchemaType.STRING },
                middle: { type: SchemaType.STRING },
                ring: { type: SchemaType.STRING },
                little: { type: SchemaType.STRING },
              },
              required: ["thumb", "index", "middle", "ring", "little"],
            },
          },
          required: ["armLevel", "fingers"],
        },
        rom: {
          type: SchemaType.OBJECT,
          description: "Range of Motion findings. Each joint has isAnkylosed flag and measurements mapping direction keys to angles in degrees.",
          properties: {
            joints: {
              type: SchemaType.OBJECT,
              description: "Map of joint keys to ROM joint values. Keys: shoulder, elbow, wrist, thumb_ip, thumb_mp, thumb_cmc, finger_dip::{finger}, finger_pip::{finger}, finger_mcp::{finger}.",
            },
          },
          required: ["joints"],
        },
        neurological: {
          type: SchemaType.OBJECT,
          description: "Neurological findings.",
          properties: {
            selectedNerves: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  nerveKey: { type: SchemaType.STRING, description: "Upper limb nerve identifier from GATIOD Chapter 3. Brachial plexus: brachial_c5_t1 (full C5–T1 / 'C5-C8, T1'), upper_trunk_c5_c6, middle_trunk_c7, lower_trunk_c8_t1. Peripheral: axillary, median_above, median_anterior_interosseous, median_below, musculocutaneous, radial_upper, radial_elbow, suprascapular, ulnar_above, ulnar_below. Digital: thumb_radial, thumb_ulnar, index_radial, index_ulnar, middle_radial, middle_ulnar, ring_radial, ring_ulnar, little_radial, little_ulnar. Entrapment: carpal_tunnel, cubital_tunnel, radial_tunnel." },
                  deficitType: { type: SchemaType.STRING, enum: ["sensory", "motor", "combined"] },
                  lossType: { type: SchemaType.STRING, enum: ["total", "partial"] },
                  severityId: { type: SchemaType.STRING, description: "For entrapment syndromes: 'mild', 'moderate', or 'severe'." },
                },
                required: ["nerveKey", "deficitType", "lossType"],
              },
            },
            romFromNerve: {
              type: SchemaType.BOOLEAN,
              description: "If true, ROM restrictions are attributed to nerve lesion and ROM stream is excluded from PI (Rule R0017).",
            },
          },
          required: ["selectedNerves", "romFromNerve"],
        },
        dbe: {
          type: SchemaType.OBJECT,
          description: "Diagnosis-Based Estimate conditions.",
          properties: {
            selectedConditions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  conditionId: { type: SchemaType.STRING, description: "DBE condition identifier." },
                  selectedAnatomicalKey: { type: SchemaType.STRING, description: "Target anatomical structure for multi-site conditions." },
                  selectedPercent: { type: SchemaType.NUMBER, description: "Selected PI% within the condition's allowed range." },
                },
                required: ["conditionId", "selectedPercent"],
              },
            },
          },
          required: ["selectedConditions"],
        },
      },
      required: ["side", "amputations", "rom", "neurological", "dbe"],
    },
  },
  {
    name: "lookup_rom_table",
    description:
      "Look up the PI% for a specific ROM measurement. Use this to validate a single value before running the full assessment.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        joint: { type: SchemaType.STRING, description: "Joint key: shoulder, elbow, wrist, thumb_ip, thumb_mp, thumb_cmc, finger_dip, finger_pip, finger_mcp." },
        direction: { type: SchemaType.STRING, description: "Movement direction key (e.g., flexion, extension, abduction, pronation)." },
        angle: { type: SchemaType.NUMBER, description: "Measured angle in degrees." },
        isAnkylosed: { type: SchemaType.BOOLEAN, description: "Whether the joint is fixed (ankylosed)." },
        finger: { type: SchemaType.STRING, description: "For finger joints: thumb, index, middle, ring, or little." },
      },
      required: ["joint", "direction", "angle", "isAnkylosed"],
    },
  },
  {
    name: "lookup_amputation_level",
    description: "Look up the PI% for an amputation level and what structures it suppresses.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        type: { type: SchemaType.STRING, enum: ["arm", "finger"], description: "Whether arm-level or finger-level." },
        level: { type: SchemaType.STRING, description: "Amputation level id. Arm: 'above_elbow', 'below_elbow', 'hand'. Thumb: 'ip' (one phalanx), 'mp' (both phalanges), 'cmc' (both phalanges + 1st metacarpal), 'mc_only' (1st metacarpal only). Fingers 2–5: 'dip' (one phalanx), 'pip' (two phalanges), 'mp' (three phalanges), 'mc' (three phalanges + metacarpal), 'mc_only' (metacarpal only)." },
        finger: { type: SchemaType.STRING, description: "For finger amputations: 'thumb', 'index', 'middle', 'ring', or 'little'." },
      },
      required: ["type", "level"],
    },
  },
  {
    name: "lookup_nerve",
    description: "Look up the maximum PI% for an upper limb nerve deficit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        nerveKey: { type: SchemaType.STRING, description: "Upper limb nerve identifier. Brachial plexus: brachial_c5_t1 (full plexus C5–T1), upper_trunk_c5_c6, middle_trunk_c7, lower_trunk_c8_t1. Peripheral: axillary, median_above, median_anterior_interosseous, median_below, musculocutaneous, radial_upper, radial_elbow, suprascapular, ulnar_above, ulnar_below. Digital: thumb_radial, thumb_ulnar, index_radial, index_ulnar, middle_radial, middle_ulnar, ring_radial, ring_ulnar, little_radial, little_ulnar. Entrapment: carpal_tunnel, cubital_tunnel, radial_tunnel." },
        deficitType: { type: SchemaType.STRING, enum: ["sensory", "motor", "combined"] },
        lossType: { type: SchemaType.STRING, enum: ["total", "partial"] },
        severityId: { type: SchemaType.STRING, description: "For entrapment: mild, moderate, or severe." },
      },
      required: ["nerveKey", "deficitType", "lossType"],
    },
  },
  {
    name: "lookup_dbe_condition",
    description: "Look up a DBE condition's PI% range and applicable joints.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        conditionId: { type: SchemaType.STRING, description: "DBE condition identifier." },
      },
      required: ["conditionId"],
    },
  },
  {
    name: "search_dictionary",
    description: "Search the GATIOD plain-language dictionary for a clinical term or concept. Returns definitions, usage context, and chapter references.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: "The term or concept to look up." },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_lower_amputation",
    description: "Look up the PI% for a lower limb amputation level (leg or toe). Use to verify correct amputation PI% before calling assess_lower_limb.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        type: { type: SchemaType.STRING, enum: ["leg", "toe"], description: "Whether leg-level or toe-level amputation." },
        level: { type: SchemaType.STRING, description: "Amputation level id. Leg: 'above_knee', 'below_knee', 'syme', 'midtarsal', 'transmetatarsal'. Toe: 'dip', 'pip', 'mtp', 'metatarsal' (great toe uses 'ip' instead of 'dip'/'pip')." },
        toe: { type: SchemaType.STRING, description: "For toe amputations: 'great', 'second', 'third', 'fourth', or 'fifth'." },
      },
      required: ["type", "level"],
    },
  },
  {
    name: "lookup_lower_nerve",
    description: "Look up the maximum PI% for a lower limb nerve deficit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        nerveKey: { type: SchemaType.STRING, description: "Lower limb nerve identifier." },
        deficitType: { type: SchemaType.STRING, enum: ["sensory", "motor", "combined"] },
        lossType: { type: SchemaType.STRING, enum: ["total", "partial"] },
      },
      required: ["nerveKey", "deficitType", "lossType"],
    },
  },
  {
    name: "lookup_shortening",
    description: "Look up the PI% for a lower limb LENGTH discrepancy. This is ONLY for measured leg-length differences in cm, NOT for amputations.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        discrepancyCm: { type: SchemaType.NUMBER, description: "Limb length discrepancy in centimetres." },
      },
      required: ["discrepancyCm"],
    },
  },
  {
    name: "lookup_lower_dbe_condition",
    description: "Look up a lower limb DBE condition's PI% and applicable anatomical keys.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        conditionId: { type: SchemaType.STRING, description: "DBE condition identifier or partial label to search." },
      },
      required: ["conditionId"],
    },
  },
];

// ─── Per-system assessment tools (Chapters 4–11) + Global CVC ───────────────


export const MULTI_SYSTEM_TOOL_DECLARATIONS: any[] = [
  {
    name: "assess_lower_limb",
    description: "Run the full GATIOD Lower Limb (Chapter 4) assessment. Takes structured findings and returns PI% with breakdown. ONLY call after doctor confirms. CRITICAL: Toe amputations go in the 'amputations' object, NOT 'shortening'. Shortening is ONLY for measured limb length discrepancy in cm.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        side: {
          type: SchemaType.STRING,
          enum: ["left", "right"],
          description: "Which lower limb is being assessed.",
        },
        amputations: {
          type: SchemaType.OBJECT,
          description: "Amputation findings. legLevel is 'none' or a level id. Each toe is 'none' or a phalanx level id. Toe amputation PI% values: Great toe: ip=3%, mtp=14%, metatarsal=23%. 2nd-5th toes: dip=1%, pip=2%, mtp=3%, metatarsal=7%. Map 'three phalanges' to 'mtp', 'two phalanges' to 'pip', 'one phalanx' to 'dip'.",
          properties: {
            legLevel: {
              type: SchemaType.STRING,
              description: "Leg-level amputation: 'none', 'above_knee' (75%), 'below_knee' (65%), 'syme' (55%), 'midtarsal' (35%), or 'transmetatarsal' (20%).",
            },
            toes: {
              type: SchemaType.OBJECT,
              description: "Per-toe amputation levels. Each value is 'none' or a level id: 'dip' (one phalanx), 'pip' (two phalanges), 'mtp' (three phalanges/all phalanges), 'metatarsal' (with metatarsal bone). Great toe uses: 'ip', 'mtp', 'metatarsal'.",
              properties: {
                great: { type: SchemaType.STRING, description: "Great toe: 'none', 'ip' (3%), 'mtp' (14%), 'metatarsal' (23%)." },
                second: { type: SchemaType.STRING, description: "2nd toe: 'none', 'dip' (1%), 'pip' (2%), 'mtp' (3%), 'metatarsal' (7%)." },
                third: { type: SchemaType.STRING, description: "3rd toe: 'none', 'dip' (1%), 'pip' (2%), 'mtp' (3%), 'metatarsal' (7%)." },
                fourth: { type: SchemaType.STRING, description: "4th toe: 'none', 'dip' (1%), 'pip' (2%), 'mtp' (3%), 'metatarsal' (7%)." },
                fifth: { type: SchemaType.STRING, description: "5th toe: 'none', 'dip' (1%), 'pip' (2%), 'mtp' (3%), 'metatarsal' (7%)." },
              },
              required: ["great", "second", "third", "fourth", "fifth"],
            },
          },
          required: ["legLevel", "toes"],
        },
        rom: {
          type: SchemaType.OBJECT,
          description: "Range of Motion findings. Each joint has isAnkylosed flag and measurements mapping direction keys to angles in degrees.",
          properties: {
            joints: {
              type: SchemaType.OBJECT,
              description: "Map of joint keys to ROM values. Keys: hip, knee, ankle, subtalar, great_toe_mtp, great_toe_ip, lesser_toes_mtp.",
            },
          },
          required: ["joints"],
        },
        neurological: {
          type: SchemaType.OBJECT,
          description: "Neurological findings.",
          properties: {
            selectedNerves: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  nerveKey: { type: SchemaType.STRING, description: "Nerve identifier: lumbosacral_l3_s1, femoral, obturator, superior_gluteal, inferior_gluteal, lateral_femoral_cutaneous, sciatic, common_peroneal, superficial_peroneal, deep_peroneal, tibial, sural, medial_plantar, lateral_plantar." },
                  deficitType: { type: SchemaType.STRING, enum: ["sensory", "motor", "combined"] },
                  lossType: { type: SchemaType.STRING, enum: ["total", "partial"] },
                },
                required: ["nerveKey", "deficitType", "lossType"],
              },
            },
            romFromNerve: {
              type: SchemaType.BOOLEAN,
              description: "If true, ROM restrictions are attributed to nerve lesion and ROM stream is excluded (Rule R0022).",
            },
          },
          required: ["selectedNerves", "romFromNerve"],
        },
        shortening: {
          type: SchemaType.OBJECT,
          description: "Lower limb LENGTH discrepancy ONLY. This is NOT for amputations — toe/leg amputations go in 'amputations'. Shortening requires a measured leg-length difference in cm (e.g. one leg is 2cm shorter than the other). If no limb length discrepancy, set discrepancyCm to 0.",
          properties: {
            discrepancyCm: {
              type: SchemaType.NUMBER,
              description: "Measured limb length discrepancy in centimetres. 0 if no shortening. Table: 0.5cm=2%, 1cm=4%, 2cm=8%, 3cm=12%, 5cm=20%, 7.5cm+=30%.",
            },
          },
          required: ["discrepancyCm"],
        },
        dbe: {
          type: SchemaType.OBJECT,
          description: "Diagnosis-Based Estimate conditions (fractures, ligament injuries, osteoarthritis).",
          properties: {
            selectedConditions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  conditionId: { type: SchemaType.STRING, description: "DBE condition identifier from Chapter 4 Section V tables." },
                  selectedAnatomicalKey: { type: SchemaType.STRING, description: "Target anatomical structure." },
                  selectedPercent: { type: SchemaType.NUMBER, description: "Selected PI% within condition's allowed range." },
                },
                required: ["conditionId", "selectedPercent"],
              },
            },
          },
          required: ["selectedConditions"],
        },
      },
      required: ["side", "amputations", "rom", "neurological", "shortening", "dbe"],
    },
  },
  {
    name: "assess_spine",
    description: "Run the GATIOD Spine (Chapter 5) assessment. Requires spinal region and category entries with diagnosis, severity, and modifiers.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        region: { type: SchemaType.STRING, description: "cervical, thoraco_lumbar, or lumbo_sacral" },
        categoryEntries: {
          type: SchemaType.ARRAY,
          description: "One entry per diagnosis category present.",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              diagnosisCategory: { type: SchemaType.STRING, description: "fractures_dislocations | spinal_cord_injury | intervertebral_disc | spondylolysis_spondylolisthesis | chronic_pain_normal_mri" },
              severityKey: { type: SchemaType.STRING, description: "Severity ID for the category. Fractures/cord: mild_sensory_motor | persistent_radicular | asia_d | asia_c | asia_ba | compression_gt25 | compression_lt25. Disc: disc31_residual | disc31_persistent_no_neuro | disc31_persistent_sensory | disc31_persistent_motor_or_motor_sensory | disc32_residual | disc32_persistent_neuro. Spondylolysis: spondy_preexisting_residual | spondy_preexisting_chronic. Chronic pain: chronic_pain_attributable | chronic_pain_not_attributable." },
              monoparesisHalving: { type: SchemaType.BOOLEAN, description: "Apply 50% reduction for monoparesis (one limb only affected). Only valid for asia_c and asia_d." },
              bladderBowelSeverity: { type: SchemaType.STRING, description: "Bladder/bowel impairment add-on severity (only applies to mild_sensory_motor, persistent_radicular, asia_d, asia_c rows). Use 'none' if absent. Values: none | incomplete_single (10%) | incomplete_both (15%) | complete_single (20%) | complete_both (25%)." },
            },
            required: ["diagnosisCategory", "severityKey"],
          },
        },
      },
      required: ["region", "categoryEntries"],
    },
  },
  {
    name: "assess_respiratory",
    description: "Run the GATIOD Respiratory (Chapter 6) assessment. Takes PFT values (FVC, FEV1, DLCO, VO2 Max), diagnosis type, and qualifiers.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        diagnosis: { type: SchemaType.STRING, description: "standard | occupational_asthma | asbestosis_silicosis" },
        fvc: { type: SchemaType.NUMBER, nullable: true },
        fev1: { type: SchemaType.NUMBER, nullable: true },
        dlco: { type: SchemaType.NUMBER, nullable: true },
        vo2Max: { type: SchemaType.NUMBER, nullable: true },
        asthmaRequiresDailyMaintenance: { type: SchemaType.BOOLEAN },
        asthmaTransferredFromExposureOneYear: { type: SchemaType.BOOLEAN },
        asthmaUnlikelyFurtherImprovement: { type: SchemaType.BOOLEAN },
        asthmaMedication: { type: SchemaType.STRING, nullable: true, description: "Maintenance drug for occupational asthma medication pathway: bronchodilators | low_dose_steroids | high_dose_steroids | oral_steroids" },
        asbestosisRadiologicallyDefinite: { type: SchemaType.BOOLEAN },
        asbestosisProfusion: { type: SchemaType.STRING, description: "ILO profusion band: below_1_1 | at_least_1_1" },
        selectedPi: { type: SchemaType.NUMBER, nullable: true },
        dyspnoea: { type: SchemaType.STRING, nullable: true, description: "Dyspnoea severity: none | on_severe_exertion | on_moderate_exertion | on_minimal_exertion" },
      },
      required: ["diagnosis"],
    },
  },
  {
    name: "assess_renal",
    description: "Run the GATIOD Renal (Chapter 7) assessment. Takes lab values, CKD stage, clinical severity, and modifiers.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        sex: { type: SchemaType.STRING, description: "male or female (for sex-specific creatinine thresholds)" },
        serumCreatinine: { type: SchemaType.NUMBER, nullable: true },
        creatinineClearance: { type: SchemaType.NUMBER, nullable: true },
        ckdStage: { type: SchemaType.NUMBER, nullable: true, description: "CKD stage: 1, 2, 3, 4, or 5" },
        clinicalSeverity: { type: SchemaType.STRING, nullable: true, description: "none | continuous_surveillance | incompletely_controlled | persisting" },
        solitaryKidney: { type: SchemaType.BOOLEAN },
        provisionalAward: { type: SchemaType.BOOLEAN },
        selectedPi: { type: SchemaType.NUMBER, nullable: true },
      },
      required: ["sex"],
    },
  },
  {
    name: "assess_gastro",
    description: "Run the GATIOD Gastro/Digestive (Chapter 8) assessment. Takes sub-system, bracket, and PI selection.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        subSystem: { type: SchemaType.STRING, description: "upperDigestive | colonicRectalAnal | liverBiliary | herniation" },
        colonalSubPath: { type: SchemaType.STRING, description: "Required when subSystem is colonicRectalAnal: colonicRectal | anal" },
        liverBiliarySubPath: { type: SchemaType.STRING, description: "Required when subSystem is liverBiliary: liver | biliary" },
        selectedBracketIndex: { type: SchemaType.NUMBER, nullable: true },
        weightLossPercent: { type: SchemaType.NUMBER, nullable: true, description: "For upperDigestive only: patient's weight loss as a percentage below desirable weight. Engine uses this to auto-classify bracket (>0%=Class I floor, >10%=Class II floor, >20%=Class III floor). Provide if the doctor mentions weight loss." },
        piPercent: { type: SchemaType.NUMBER, nullable: true },
        clinicalJustification: { type: SchemaType.STRING },
      },
      required: ["subSystem"],
    },
  },
  {
    name: "assess_hearing",
    description: "Run the GATIOD Hearing (Chapter 9) assessment. Path A: NID (noise-induced deafness) with better-ear logic. Path B: Injury with per-ear logic.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: { type: SchemaType.STRING, description: "nid | injury" },
        leftEarAhl: { type: SchemaType.NUMBER },
        rightEarAhl: { type: SchemaType.NUMBER },
        age: { type: SchemaType.NUMBER },
        affectedEars: { type: SchemaType.STRING, description: "For injury path: left | right | both" },
      },
      required: ["path"],
    },
  },
  {
    name: "assess_cns",
    description: "Run the GATIOD CNS (Chapter 10) assessment. Section A: cerebral groups (highest-score). Section B: other neurological (CVC). Section C: paralysed limbs.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        group1Consciousness: { type: SchemaType.OBJECT, description: "Section A Group 1A. {bracketId: c_none|c_brief_minimal|c_brief_moderate|c_prolonged|c_coma, value: number}" },
        group1Episodic: { type: SchemaType.OBJECT, description: "Section A Group 1B. {bracketId: e_none|e_predictable|e_interferes|e_severe_supervised|e_uncontrolled, value: number}" },
        group1Arousal: { type: SchemaType.OBJECT, description: "Section A Group 1C. {bracketId: a_none|a_reduced_most|a_reduced_some|a_significant_limit|a_unable_selfcare, value: number}" },
        group2: { type: SchemaType.OBJECT, description: "Section A Group 2 (neuropsychologist required). {bracketId: ms_none|ms_slight|ms_moderate|ms_severe|ms_fragment_only, value: number}" },
        group2NeuropsychologistConfirmed: { type: SchemaType.BOOLEAN },
        group3: { type: SchemaType.OBJECT, description: "Section A Group 3. {bracketId: co_none|co_minimal|co_moderate|co_severe_or_complete, value: number}" },
        group4: { type: SchemaType.OBJECT, description: "Section A Group 4 (psychiatrist required). {bracketId: em_none|em_mild|em_moderate|em_severe, value: number}" },
        group4PsychiatristConfirmed: { type: SchemaType.BOOLEAN },
        olfaction: { type: SchemaType.OBJECT, description: "Section B. {bracketId: ol_none|ol_anosmia, value: number}" },
        facialNerve: { type: SchemaType.OBJECT, description: "Section B. {bracketId: fn_none|fn_mild_unilateral|fn_mildmoderate_bilateral_or_severe_unilateral|fn_severe_bilateral, value: number}" },
        equilibrium: { type: SchemaType.OBJECT, description: "Section B. {bracketId: eq_none|eq_minimal|eq_moderate_to_mod_severe|eq_severe_assisted, value: number}" },
        equilibriumEntConfirmed: { type: SchemaType.BOOLEAN },
        swallowing: { type: SchemaType.OBJECT, description: "Section B. {bracketId: sw_none|sw_mild|sw_moderately_severe|sw_severe, value: number}" },
        stationGait: { type: SchemaType.OBJECT, description: "Section B. {bracketId: sg_none|sg_walks_difficult|sg_level_only|sg_cannot_walk_or_stand, value: number}" },
        respiration: { type: SchemaType.OBJECT, description: "Section B. {bracketId: re_none|re_limited_ambulation|re_confined_bed|re_no_capacity, value: number}" },
        paralysedLimbs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Section C limb IDs for paralysed limbs (amputation-equivalent mapping)." },
      },
    },
  },
  {
    name: "assess_visual",
    description: "Run the GATIOD Visual (Chapter 11) assessment. Per-eye: acuity, field loss, modifiers, conditions. Binocular: diplopia. 50% monocular cap, legal blindness = 100%.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        leftEye: {
          type: SchemaType.OBJECT,
          description: "Left eye findings.",
          properties: {
            acuityId: { type: SchemaType.STRING, description: "Snellen acuity: 6_6|6_7.5|6_9|6_12|6_15|6_18|6_24|6_30|6_36|6_48|6_60|lt_6_60" },
            fieldId: { type: SchemaType.STRING, description: "Visual field retained: field_full|field_110_120|field_100_110|field_90_100|field_80_90|field_70_80|field_60_70|field_50_60|field_40_50|field_30_40|field_20_30|field_lt20" },
            functionalModifiers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Additive modifiers: accommodation|contrast_glare|colour|astigmatism" },
            specificConditions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Additive conditions: glaucoma|cataract|corneal|orbital|mydriasis" },
          },
          required: ["acuityId", "fieldId", "functionalModifiers", "specificConditions"],
        },
        rightEye: {
          type: SchemaType.OBJECT,
          description: "Right eye findings (same structure as leftEye).",
          properties: {
            acuityId: { type: SchemaType.STRING, description: "Snellen acuity: 6_6|6_7.5|6_9|6_12|6_15|6_18|6_24|6_30|6_36|6_48|6_60|lt_6_60" },
            fieldId: { type: SchemaType.STRING, description: "Visual field retained: field_full|field_110_120|field_100_110|field_90_100|field_80_90|field_70_80|field_60_70|field_50_60|field_40_50|field_30_40|field_20_30|field_lt20" },
            functionalModifiers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Additive modifiers: accommodation|contrast_glare|colour|astigmatism" },
            specificConditions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Additive conditions: glaucoma|cataract|corneal|orbital|mydriasis" },
          },
          required: ["acuityId", "fieldId", "functionalModifiers", "specificConditions"],
        },
        diplopiaId: { type: SchemaType.STRING, description: "Binocular diplopia: dip_none|dip_uncorrectable|dip_central30|dip_30_60|dip_beyond60" },
      },
      required: ["leftEye", "rightEye", "diplopiaId"],
    },
  },
  {
    name: "assess_global_cvc",
    description: "Combine all calculated system subtotals into a global PI% using the CVC formula. Call this after two or more systems have been individually assessed.",
    parameters: { type: SchemaType.OBJECT, properties: { systemSubtotals: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { system: { type: SchemaType.STRING }, piPercent: { type: SchemaType.NUMBER } }, required: ["system", "piPercent"] } } }, required: ["systemSubtotals"] },
  },
  {
    name: "register_investigation",
    description: "Register a disputed calculation step for expert clinical review when the doctor's concern cannot be resolved through conversation. Use this when: (1) the doctor disagrees with how a GATIOD rule was applied and the rule application is genuinely ambiguous, (2) the case presents an edge case not clearly covered by the GATIOD guide, or (3) a calculation ambiguity exists that requires clinical expert judgement. Do NOT use this to avoid answering — first attempt to resolve through clarification.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        stepId: { type: SchemaType.STRING, description: "ID of the disputed step (e.g. 'step_rom', 'step_conflict_resolution')" },
        stepTitle: { type: SchemaType.STRING, description: "Human-readable name of the disputed step" },
        doctorConcern: { type: SchemaType.STRING, description: "Verbatim or close paraphrase of what the doctor said was wrong" },
        clinicalContext: { type: SchemaType.STRING, description: "Brief summary of the clinical context and why this needs expert review — include what rule is in dispute and why it is ambiguous" },
        investigationType: { type: SchemaType.STRING, enum: ["rule_dispute", "edge_case", "calculation_ambiguity"], description: "Category of the investigation" },
      },
      required: ["stepId", "stepTitle", "doctorConcern", "clinicalContext", "investigationType"],
    },
  },
];
