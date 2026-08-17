-- Feedback portal + embeddable widget (2026-07-27).
-- Public feedback boards keyed by an unguessable token; submissions land as
-- tagged issues inside an existing project. Safe to re-run (IF NOT EXISTS).
-- Source of truth: server-js/src/db/schema.ts (feedbackBoards/Votes/Meta).

-- 1. A dedicated bot user authors public comments (issue_comments.actor_id is
--    NOT NULL FK -> users). Fixed id so code can reference it as a constant.
INSERT OR IGNORE INTO users (id, email, username, display_name, is_active, is_bot, is_customer, created_at, updated_at)
VALUES ('feedbac0-0000-0000-0000-000000000000', 'feedback-bot@atur.internal', 'feedback-bot', 'Feedback Bot', 1, 1, 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');

-- 2. One row per project that enables a public feedback board.
CREATE TABLE IF NOT EXISTS feedback_boards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  slug TEXT,
  title TEXT NOT NULL,
  description TEXT,
  allow_submit INTEGER NOT NULL DEFAULT 1,
  allow_voting INTEGER NOT NULL DEFAULT 1,
  require_email INTEGER NOT NULL DEFAULT 0,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  default_state_id TEXT,
  submit_label_id TEXT,
  brand_color TEXT NOT NULL DEFAULT '#6366f1',
  position TEXT NOT NULL DEFAULT 'bottom-right',
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_boards_token ON feedback_boards(public_token);
CREATE INDEX IF NOT EXISTS idx_feedback_boards_project ON feedback_boards(project_id);

-- 3. Upvote dedup: one row per (issue, voter_hash). Toggle = insert/delete.
CREATE TABLE IF NOT EXISTS feedback_votes (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  voter_hash TEXT NOT NULL,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_votes ON feedback_votes(issue_id, voter_hash);
CREATE INDEX IF NOT EXISTS idx_feedback_votes_issue ON feedback_votes(issue_id);

-- 4. Public-origin author metadata, kept off the issues row itself.
CREATE TABLE IF NOT EXISTS feedback_meta (
  issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  author_email TEXT,
  author_name TEXT,
  source TEXT,
  created_at TEXT
);
