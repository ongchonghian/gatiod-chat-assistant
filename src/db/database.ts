/**
 * Database layer — SQLite for standalone, designed for PostgreSQL migration.
 * Schema matches claimsDex patterns (better-sqlite3, WAL mode, JSON columns).
 */

import Database from "better-sqlite3";
import { join } from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.GATIOD_DB_PATH ?? join(process.cwd(), "gatiod-chat.db");
  db = new Database(dbPath, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS gatiod_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      claim_id TEXT,
      history TEXT NOT NULL DEFAULT '[]',
      system_states TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON gatiod_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_claim ON gatiod_sessions(claim_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON gatiod_sessions(status);

    CREATE TABLE IF NOT EXISTS gatiod_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id TEXT,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_session ON gatiod_audit_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_audit_type ON gatiod_audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON gatiod_audit_log(created_at);
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
