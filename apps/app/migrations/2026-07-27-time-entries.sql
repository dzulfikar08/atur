-- Time tracking: time_entries table for the timetracker/timesheet feature.
-- Run against D1 (local: --local, prod: atur-db).
-- Safe: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS — no-op if present.
-- Source of truth: server-js/src/db/schema.ts (timeEntries). Mirrors the legacy
-- Rust entity crates/db/src/entities/time_entries.rs. clockify_id reserved for a
-- future Clockify sync; unused now.

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration_seconds INTEGER NOT NULL,
  description TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  clockify_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_time_entries_issue ON time_entries(issue_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_workspace ON time_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
