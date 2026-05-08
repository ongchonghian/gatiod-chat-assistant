/**
 * Audit Logger — records every assessment event for medico-legal traceability.
 * Every PI% must be traceable to the doctor's confirmed inputs through this log.
 */

import { getDb } from "./database.js";

export type AuditEventType =
  | "session_start"
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "confirmation_presented"
  | "confirmation_accepted"
  | "correction"
  | "calculation_result"
  | "report_downloaded"
  | "session_reset"
  | "error"
  | "v2_normalization"
  | "v2_route"
  | "v2_policy"
  | "v2_tool_plan"
  | "v2_shadow_result";

export interface AuditEntry {
  sessionId: string;
  userId?: string;
  eventType: AuditEventType;
  eventData: Record<string, unknown>;
}

export function logAuditEvent(entry: AuditEntry): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO gatiod_audit_log (session_id, user_id, event_type, event_data) VALUES (?, ?, ?, ?)"
    ).run(
      entry.sessionId,
      entry.userId ?? null,
      entry.eventType,
      JSON.stringify(entry.eventData)
    );
  } catch (err) {
    // Audit logging should never crash the main flow
    console.error("[Audit] Failed to log event:", err);
  }
}

export function getSessionAuditTrail(sessionId: string): {
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
}[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT event_type, event_data, created_at FROM gatiod_audit_log WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Record<string, unknown>[];

  return rows.map((row) => ({
    eventType: row.event_type as string,
    eventData: JSON.parse(row.event_data as string),
    createdAt: row.created_at as string,
  }));
}
