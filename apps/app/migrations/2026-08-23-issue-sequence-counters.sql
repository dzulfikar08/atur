-- Atomic per-project issue sequence counters.
-- Replaces MAX(sequence_id)+1 + retry-on-collision (which deterministically
-- 500s past ~11 concurrent creators) with a single-row counter bumped by
-- UPDATE ... RETURNING — atomic on D1/SQLite.
-- Backfill from existing rows so the counter stays ahead of current data.
-- Run: wrangler d1 execute atur-db --file=migrations/2026-08-23-issue-sequence-counters.sql
-- (use --remote for prod D1). Safe to re-run: CREATE IF NOT EXISTS + INSERT
-- OR IGNORE.

CREATE TABLE IF NOT EXISTS issue_sequence_counters (
  project_id TEXT PRIMARY KEY,
  next_sequence INTEGER NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

-- Seed one counter row per project that already has issues. next_sequence =
-- MAX(sequence_id)+1 so the next allocation continues above existing rows.
INSERT OR IGNORE INTO issue_sequence_counters (project_id, next_sequence, created_at, updated_at)
SELECT project_id, COALESCE(MAX(sequence_id), 0) + 1, NULL, NULL
FROM issues
GROUP BY project_id;
