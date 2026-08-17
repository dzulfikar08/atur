-- Customer support portal: OTP-authenticated customers submit tickets that
-- become issues in a configured "support project" per workspace.
-- Source of truth: server-js/src/db/schema.ts (mirrors below).
-- Run: wrangler d1 execute DB --local --file=server-js/migrations/2026-07-27-support-portal.sql
-- (use --remote for prod D1). One-shot: the ALTER is not guarded — do not re-run.

-- A customer is a users row with is_customer=1 (no password_hash, no token).
-- They authenticate via customers.session_token, NOT users.token, so /api/*
-- (which looks up users.token) stays unreachable. Reusing users satisfies the
-- issues.created_by_id and issue_comments.actor_id foreign keys.
ALTER TABLE users ADD COLUMN is_customer INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_workspace_user ON customers(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_customers_session_token ON customers(session_token);

-- One row per workspace: which project receives portal tickets + enabled flag.
CREATE TABLE IF NOT EXISTS portal_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  support_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- 1:1 link between a portal ticket and the underlying issue. Portal lists a
-- customer's issues through this join.
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets(customer_id);
