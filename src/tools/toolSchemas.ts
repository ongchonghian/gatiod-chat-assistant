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
                  nerveKey: { type: SchemaType.STRING, description: "Nerve identifier from GATIOD Chapter 3." },
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
        level: { type: SchemaType.STRING, description: "Amputation level id (e.g., 'above_elbow', 'ip', 'mp')." },
        finger: { type: SchemaType.STRING, description: "For finger amputations: which finger." },
      },
      required: ["type", "level"],
    },
  },
  {
    name: "lookup_nerve",
    description: "Look up the maximum PI% for a nerve deficit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        nerveKey: { type: SchemaType.STRING, description: "Nerve identifier." },
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
];
