-- Prod-gap migration: tables server-js needs that WASM schema.sql never created.
-- Run against prod D1 (atur-db) BEFORE flipping the diatur.com route to atur-hono.
-- Safe: CREATE TABLE IF NOT EXISTS — no-op if a table already exists.
-- Source of truth: server-js/src/db/schema.ts. Verified identical columns to
-- Drizzle definitions on 2026-07-13. All other tables (incl. api_keys,
-- custom_fields, imports, integration_tokens, api_logs) already exist in prod.

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  sort_order REAL NOT NULL DEFAULT 65535.0,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  owned_by_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id);

CREATE TABLE IF NOT EXISTS sprint_issues (
  id TEXT PRIMARY KEY,
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  metadata TEXT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
