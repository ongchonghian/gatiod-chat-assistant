/**
 * Session Store — database-backed persistence for chat sessions.
 * Replaces the in-memory Map for production use.
 * Sessions survive server restarts and can be resumed across days.
 */

import type { Content } from "@google/generative-ai";
import { getDb } from "./database.js";

export interface PersistedSession {
  id: string;
  userId: string | null;
  claimId: string | null;
  history: Content[];
  systemStates: Record<string, unknown>;
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  updatedAt: string;
}

export function saveSession(
  sessionId: string,
  history: Content[],
  opts?: { userId?: string; claimId?: string; systemStates?: Record<string, unknown> }
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO gatiod_sessions (id, user_id, claim_id, history, system_states, status, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      history = excluded.history,
      system_states = excluded.system_states,
      user_id = COALESCE(excluded.user_id, gatiod_sessions.user_id),
      claim_id = COALESCE(excluded.claim_id, gatiod_sessions.claim_id),
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    sessionId,
    opts?.userId ?? null,
    opts?.claimId ?? null,
    JSON.stringify(history),
    JSON.stringify(opts?.systemStates ?? {})
  );
}

export function saveSessionSystemStates(
  sessionId: string,
  systemStates: Record<string, unknown>,
  opts?: { userId?: string; claimId?: string }
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO gatiod_sessions (id, user_id, claim_id, system_states, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      system_states = excluded.system_states,
      user_id = COALESCE(excluded.user_id, gatiod_sessions.user_id),
      claim_id = COALESCE(excluded.claim_id, gatiod_sessions.claim_id),
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    sessionId,
    opts?.userId ?? null,
    opts?.claimId ?? null,
    JSON.stringify(systemStates)
  );
}

export function loadSession(sessionId: string): PersistedSession | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM gatiod_sessions WHERE id = ?").get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    userId: row.user_id as string | null,
    claimId: row.claim_id as string | null,
    history: JSON.parse(row.history as string) as Content[],
    systemStates: JSON.parse(row.system_states as string) as Record<string, unknown>,
    status: row.status as "active" | "completed" | "abandoned",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function deleteSession(sessionId: string): void {
  const db = getDb();
  db.prepare("UPDATE gatiod_sessions SET status = 'abandoned' WHERE id = ?").run(sessionId);
}

export function completeSession(sessionId: string): void {
  const db = getDb();
  db.prepare("UPDATE gatiod_sessions SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
}

export function listSessionsForUser(userId: string): PersistedSession[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM gatiod_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50").all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string | null,
    claimId: row.claim_id as string | null,
    history: JSON.parse(row.history as string) as Content[],
    systemStates: JSON.parse(row.system_states as string) as Record<string, unknown>,
    status: row.status as "active" | "completed" | "abandoned",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}
