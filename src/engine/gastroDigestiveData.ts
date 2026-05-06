/**
 * Gastro Digestive Tract Assessment — GATIOD Chapter 8
 *
 * Calculation logic for permanent incapacity across four sub-systems:
 * Upper Digestive, Colonic/Rectal/Anal, Liver/Biliary, and Herniation.
 *
 * Each sub-system maps clinical criteria to a severity bracket.
 * The doctor then assigns a specific PI% within that bracket.
 */

import { z } from "zod";

// ─── Sub-system Definitions ─────────────────────────────────────────────────

export type GastroSubSystem =
  | 'upperDigestive'
  | 'colonicRectalAnal'
  | 'liverBiliary'
  | 'herniation';

export const GASTRO_SUB_SYSTEMS: { value: GastroSubSystem; label: string; description: string; routingHint: string }[] = [
  { value: 'upperDigestive', label: 'Upper Digestive Tract', description: 'Oesophagus, stomach, duodenum, small intestine, pancreas', routingHint: 'Use for: oesophageal disease, stomach/gastric disorders, small intestine disease, pancreatic disease' },
  { value: 'colonicRectalAnal', label: 'Colonic, Rectal & Anal Disorders', description: 'Large intestine, rectum, anus', routingHint: 'Use for: large intestine disease (colitis, Crohn\'s), rectal disorders, anal/perianal disease, faecal incontinence' },
  { value: 'liverBiliary', label: 'Liver & Biliary Tract Disease', description: 'Liver, biliary tract', routingHint: 'Use for: liver disease (cirrhosis, hepatitis, ascites), biliary tract obstruction, cholangitis' },
  { value: 'herniation', label: 'Herniation', description: 'Abdominal wall, umbilical, incisional, inguinal, femoral', routingHint: 'Use for: abdominal wall hernia, umbilical, incisional, inguinal, or femoral hernia' },
];

// ─── Severity Brackets ──────────────────────────────────────────────────────

export interface SeverityBracket {
  label: string;
  min: number;
  max: number;
  criteria: string;
}

// Upper Digestive Tract
export const UPPER_DIGESTIVE_BRACKETS: SeverityBracket[] = [
  { label: 'Class I', min: 0, max: 9, criteria: 'Symptoms or signs present; continuous treatment not required; weight maintained at desirable level — OR — no sequelae after surgical procedures' },
  { label: 'Class II', min: 10, max: 24, criteria: 'Requires appropriate dietary restrictions and drugs for control of symptoms or nutritional deficiency; weight loss ≤10% below desirable weight' },
  { label: 'Class III', min: 25, max: 49, criteria: 'Dietary restrictions and drugs do not completely control symptoms or nutritional state; weight loss 10–20% below desirable weight' },
  { label: 'Class IV', min: 50, max: 75, criteria: 'Symptoms uncontrolled by treatment; OR weight loss >20% below desirable weight due to upper digestive tract disorder' },
];

// Colonic & Rectal Disease
export const COLONIC_RECTAL_BRACKETS: SeverityBracket[] = [
  { label: 'Class I', min: 0, max: 9, criteria: 'Infrequent symptoms of brief duration; no limitation of activities, special diet, or medication required; no systemic manifestations; weight and nutritional state maintained at desirable level — OR — no sequelae after surgical procedures' },
  { label: 'Class II', min: 10, max: 24, criteria: 'Mild GI symptoms with occasional bowel disturbances; moderate pain; minimal dietary restriction; mild symptomatic therapy may be necessary; no nutritional impairment' },
  { label: 'Class III', min: 25, max: 49, criteria: 'Moderate to severe exacerbations; disturbance of bowel habit with periodic or continual pain; restricted activity, special diet, and drugs required; constitutional manifestations (fever, anaemia, weight loss)' },
  { label: 'Class IV', min: 50, max: 75, criteria: 'Persistent bowel disturbances at rest; severe persistent pain; complete limitation of activity; diet and medication do not entirely control symptoms; constitutional manifestations (fever, weight loss, anaemia); no prolonged remission' },
];

// Anal Disease
export const ANAL_DISEASE_BRACKETS: SeverityBracket[] = [
  { label: 'Class I', min: 0, max: 9, criteria: 'Mild, intermittent symptoms controlled by treatment; or mild incontinence involving gas or liquid stool' },
  { label: 'Class II', min: 10, max: 19, criteria: 'Moderate/partial faecal incontinence requiring continual treatment; or symptoms incompletely controlled by treatment' },
  { label: 'Class III', min: 20, max: 35, criteria: 'Complete faecal incontinence; or severe symptoms unresponsive to therapy' },
];

// Liver Disease
export const LIVER_DISEASE_BRACKETS: SeverityBracket[] = [
  { label: 'Class I', min: 0, max: 14, criteria: 'Persistently abnormal biochemical tests; no symptoms; no ascites/jaundice/bleeding varices; normal PT/PTT' },
  { label: 'Class II', min: 15, max: 29, criteria: 'Objective evidence of chronic liver disease (e.g., spider naevi, hepatosplenomegaly); good nutrition/strength; no ascites/jaundice/bleeding varices' },
  { label: 'Class III', min: 30, max: 49, criteria: 'Progressive disease or history of jaundice, ascites, or bleeding oesophageal or gastric varices within the past year; and possibly affected nutrition and strength; or intermittent hepatic encephalopathy' },
  { label: 'Class IV', min: 50, max: 95, criteria: 'Persistent jaundice; or bleeding oesophageal or gastric varices; with CNS manifestations of hepatic insufficiency; or presence of hepatic tumours and poor nutritional state' },
];

// Biliary Tract Disease
export const BILIARY_TRACT_BRACKETS: SeverityBracket[] = [
  { label: 'Class I', min: 0, max: 14, criteria: 'Occasional biliary tract dysfunction episodes' },
  { label: 'Class II', min: 15, max: 29, criteria: 'Recurrent biliary tract impairment, irrespective of treatment' },
  { label: 'Class III', min: 30, max: 49, criteria: 'Irreparable biliary tract obstruction with recurrent cholangitis' },
  { label: 'Class IV', min: 50, max: 95, criteria: 'Persistent jaundice; progressive liver disease due to common bile duct obstruction' },
];

// Herniation
export const HERNIATION_BRACKETS: SeverityBracket[] = [
  { label: 'Class I', min: 0, max: 9, criteria: 'Palpable defect with slight protrusion under increased pressure; readily reducible; or occasional mild discomfort not precluding most daily activities' },
  { label: 'Class II', min: 10, max: 19, criteria: 'Frequent/persistent protrusion; manually reducible; or frequent discomfort precluding heavy lifting' },
  { label: 'Class III', min: 20, max: 30, criteria: 'Persistent, irreducible, or irreparable protrusion with limitation in activities of daily living' },
];

// ─── Sub-paths for Colonic/Rectal/Anal ───────────────────────────────────────

export type ColonalSubPath = 'colonicRectal' | 'anal';

export const COLONAL_SUB_PATHS: { value: ColonalSubPath; label: string }[] = [
  { value: 'colonicRectal', label: 'Colonic & Rectal Disease' },
  { value: 'anal', label: 'Anal Disease' },
];

// ─── Sub-paths for Liver/Biliary ─────────────────────────────────────────────

export type LiverBiliarySubPath = 'liver' | 'biliary';

export const LIVER_BILIARY_SUB_PATHS: { value: LiverBiliarySubPath; label: string }[] = [
  { value: 'liver', label: 'Liver Disease' },
  { value: 'biliary', label: 'Biliary Tract Disease' },
];

// ─── Weight Loss Classification (Upper Digestive) ───────────────────────────

export function classifyWeightLoss(weightLossPercent: number): number {
  if (weightLossPercent > 20) return 3;
  // Table wording: "does not exceed 10%" and "10%-20%" is interpreted as
  // <=10 in Class II, >10 to <=20 in Class III to avoid overlap.
  if (weightLossPercent > 10) return 2;
  if (weightLossPercent > 0) return 1;
  return 0;
}

// ─── Value Type ──────────────────────────────────────────────────────────────

export interface GastroDigestiveValue {
  subSystem: GastroSubSystem | null;
  colonalSubPath?: ColonalSubPath;
  liverBiliarySubPath?: LiverBiliarySubPath;
  selectedBracketIndex: number | null;
  weightLossPercent?: number;
  piPercent: number | null;
  clinicalJustification?: string;
}

export const GastroDigestiveValueSchema = z.object({
  subSystem: z.enum(["upperDigestive", "colonicRectalAnal", "liverBiliary", "herniation"]).nullable(),
  colonalSubPath: z.enum(["colonicRectal", "anal"]).optional(),
  liverBiliarySubPath: z.enum(["liver", "biliary"]).optional(),
  selectedBracketIndex: z.number().int().min(0).max(10).nullable(),
  weightLossPercent: z.number().min(0).max(100).optional(),
  piPercent: z.number().min(0).max(100).nullable(),
  clinicalJustification: z.string().optional(),
});

export interface GastroDigestiveResult {
  subSystemLabel: string;
  bracket: SeverityBracket | null;
  piPercent: number | null;
  isOutOfRange: boolean;
  weightLossAutoClass?: number;
}

export function getActiveBrackets(value: GastroDigestiveValue): SeverityBracket[] {
  switch (value.subSystem) {
    case 'upperDigestive':
      return UPPER_DIGESTIVE_BRACKETS;
    case 'colonicRectalAnal':
      return value.colonalSubPath === 'anal' ? ANAL_DISEASE_BRACKETS : COLONIC_RECTAL_BRACKETS;
    case 'liverBiliary':
      return value.liverBiliarySubPath === 'biliary' ? BILIARY_TRACT_BRACKETS : LIVER_DISEASE_BRACKETS;
    case 'herniation':
      return HERNIATION_BRACKETS;
    default:
      return [];
  }
}

export function calculateGastroDigestiveAssessment(value: GastroDigestiveValue): GastroDigestiveResult {
  const subSystemEntry = GASTRO_SUB_SYSTEMS.find(s => s.value === value.subSystem);
  const brackets = getActiveBrackets(value);
  const bracket = value.selectedBracketIndex !== null ? brackets[value.selectedBracketIndex] ?? null : null;

  let weightLossAutoClass: number | undefined;
  if (value.subSystem === 'upperDigestive' && value.weightLossPercent !== undefined) {
    weightLossAutoClass = classifyWeightLoss(value.weightLossPercent);
  }

  const isOutOfRange = bracket !== null && value.piPercent !== null
    ? value.piPercent < bracket.min || value.piPercent > bracket.max
    : false;

  return {
    subSystemLabel: subSystemEntry?.label ?? '',
    bracket,
    piPercent: value.piPercent,
    isOutOfRange,
    weightLossAutoClass,
  };
}
