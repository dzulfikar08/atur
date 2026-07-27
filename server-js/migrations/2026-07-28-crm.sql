-- CRM contacts (Track A) + sales deals pipeline (Track B).
-- Source of truth: server-js/src/db/schema.ts (mirrors below).
-- Run: wrangler d1 execute DB --local --file=server-js/migrations/2026-07-28-crm.sql
-- (use --remote for prod D1). The customers rebuild is one-shot — run once.

-- ============================================================================
-- Track A — rebuild `customers` into a CRM contact record.
--
-- user_id becomes NULLABLE: a lead/prospect is a customers row with no auth
-- account (user_id NULL). Portal customers keep their users row so they can
-- still author issue_comments (actor_id FK -> users.id).
--
-- Contact fields (email/name/company/phone/status/source) move ONTO the row,
-- so a customer is no longer just a thin session handle. Dedupe switches from
-- (workspace, user_id) to (workspace, email) — the CRM identity key.
--
-- SQLite cannot relax an existing NOT NULL via ALTER TABLE, so the table is
-- rebuilt: create new -> copy+backfill from users -> drop old -> rename.
-- customer.id values are preserved, so support_tickets.customer_id resolves
-- as before. PRAGMA foreign_keys=OFF is REQUIRED around the DROP: with FK on,
-- DROP TABLE performs an implicit DELETE that would cascade through
-- support_tickets.customer_id (ON DELETE CASCADE) and destroy ticket data.
-- ============================================================================
PRAGMA foreign_keys=OFF;

CREATE TABLE customers_new (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT,
  name          TEXT,
  company       TEXT,
  phone         TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  source        TEXT,
  session_token TEXT,
  created_at    TEXT,
  updated_at    TEXT
);

-- Backfill email/name from the linked users row. status defaults to 'active'
-- for every pre-existing (portal) customer.
INSERT INTO customers_new (id, workspace_id, user_id, email, name, status, session_token, created_at, updated_at)
SELECT c.id, c.workspace_id, c.user_id, u.email, COALESCE(u.display_name, u.username), 'active',
       c.session_token, c.created_at, c.updated_at
FROM customers c LEFT JOIN users u ON u.id = c.user_id;

-- Indexes on the old table are dropped with it; recreate on the new one.
DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;

CREATE INDEX IF NOT EXISTS idx_customers_session_token ON customers(session_token);
-- Portal customers: at most one customer row per (workspace, user).
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_workspace_user
  ON customers(workspace_id, user_id) WHERE user_id IS NOT NULL;
-- CRM identity: one contact per (workspace, email). Partial so null emails
-- (shouldn't happen, but defensive) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_workspace_email
  ON customers(workspace_id, email) WHERE email IS NOT NULL;

PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;

-- ============================================================================
-- Track B — deals side table.
--
-- A deal IS an issue (issue_id 1:1 UNIQUE); the pipeline is the issue's
-- project; the stage is the issue's state. Typed amount_cents enables
-- SUM-by-state rollups for pipeline totals. customer_id is nullable with
-- ON DELETE SET NULL so deal history survives contact deletion.
-- ============================================================================
CREATE TABLE IF NOT EXISTS deals (
  id                TEXT PRIMARY KEY,
  issue_id          TEXT NOT NULL UNIQUE REFERENCES issues(id) ON DELETE CASCADE,
  customer_id       TEXT REFERENCES customers(id) ON DELETE SET NULL,
  workspace_id      TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'USD',
  expected_close_at TEXT,
  created_at        TEXT,
  updated_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_deals_customer  ON deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id);
