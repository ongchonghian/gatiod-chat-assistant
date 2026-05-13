/**
 * Investigation Log — stores calculation steps flagged by doctors for expert review.
 * Created when the LLM cannot resolve a step challenge through conversation.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "./database.js";

export type InvestigationType = "rule_dispute" | "edge_case" | "calculation_ambiguity";
export type InvestigationStatus = "open" | "under_review" | "resolved";

export interface Investigation {
  id: string;
  sessionId: string;
  stepId: string;
  stepTitle: string;
  doctorConcern: string;
  clinicalContext: string;
  investigationType: InvestigationType;
  status: InvestigationStatus;
  createdAt: string;
}

export function saveInvestigation(params: {
  sessionId: string;
  stepId: string;
  stepTitle: string;
  doctorConcern: string;
  clinicalContext: string;
  investigationType: InvestigationType;
}): Investigation {
  const db = getDb();
  const id = `INV-${uuidv4().slice(0, 8).toUpperCase()}`;

  db.prepare(`
    INSERT INTO gatiod_investigations
      (id, session_id, step_id, step_title, doctor_concern, clinical_context, investigation_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.sessionId,
    params.stepId,
    params.stepTitle,
    params.doctorConcern,
    params.clinicalContext,
    params.investigationType,
  );

  return {
    id,
    sessionId: params.sessionId,
    stepId: params.stepId,
    stepTitle: params.stepTitle,
    doctorConcern: params.doctorConcern,
    clinicalContext: params.clinicalContext,
    investigationType: params.investigationType,
    status: "open",
    createdAt: new Date().toISOString(),
  };
}

export function listInvestigations(filters?: { status?: InvestigationStatus }): Investigation[] {
  const db = getDb();
  const rows = filters?.status
    ? db.prepare("SELECT * FROM gatiod_investigations WHERE status = ? ORDER BY created_at DESC").all(filters.status)
    : db.prepare("SELECT * FROM gatiod_investigations ORDER BY created_at DESC").all();

  return (rows as Record<string, unknown>[]).map(rowToInvestigation);
}

export function getInvestigationsBySession(sessionId: string): Investigation[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM gatiod_investigations WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToInvestigation);
}

function rowToInvestigation(row: Record<string, unknown>): Investigation {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    stepId: row.step_id as string,
    stepTitle: row.step_title as string,
    doctorConcern: row.doctor_concern as string,
    clinicalContext: row.clinical_context as string,
    investigationType: row.investigation_type as InvestigationType,
    status: row.status as InvestigationStatus,
    createdAt: row.created_at as string,
  };
}
