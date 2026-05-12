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
  | "v2_shadow_result"
  | "v2_pending_observation"
  | "v2_extraction_warning"
  | "v2_multi_system_extraction"
  | "v2_failure"
  | "v2_failure_user_choice"
  | "v2_legacy_fallback_requested"
  | "v2_legacy_fallback_result"
  | "v2_global_cvc_offered"
  | "v2_global_cvc_executed"
  | "v2_global_cvc_component_excluded"
  | "v2_global_cvc_component_reincluded"
  | "v2_semantic_consensus_gate"
  | "v2_semantic_router_comparison"
  | "semantic_interpretation_created"
  | "semantic_interpretation_schema_failed"
  | "semantic_interpretation_accepted"
  | "semantic_interpretation_rejected"
  | "semantic_interpretation_edited"
  | "semantic_legacy_deferred_component"
  | "semantic_legacy_fallback_requested"
  | "semantic_to_structured_extraction_started"
  | "semantic_to_structured_extraction_failed"
  | "semantic_multi_region_spine_detected"
  | "v2_component_skipped_by_user"
  | "spine_multi_region_unsupported"
  // ADR-0004 — LLM shadow extractor calibration events
  | "v2_shadow_extraction"
  | "v2_shadow_extraction_failed"
  // ADR-0004 — Extractor comparison UI events
  | "v2_extractor_comparison_shown"
  | "v2_extractor_comparison_resolved";

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
