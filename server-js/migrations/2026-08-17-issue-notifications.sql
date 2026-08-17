-- Per-issue notification reminders (due-date emails) for followers.
-- Source of truth: server-js/src/db/schema.ts -> issueReminders.
-- Run: wrangler d1 execute atur-db --local --file=server-js/migrations/2026-08-17-issue-notifications.sql
-- (use --remote for prod D1). One-shot: the ALTER/CREATE are not guarded — do not re-run.

CREATE TABLE IF NOT EXISTS issue_reminders (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  reminder_date TEXT NOT NULL,
  reminder_type TEXT NOT NULL DEFAULT 'target_date',
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_issue_reminders_issue ON issue_reminders(issue_id);
