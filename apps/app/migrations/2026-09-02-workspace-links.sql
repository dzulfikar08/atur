-- Workspace links: the control-plane registry binding each Atur workspace to
-- its execution context — GitHub repo(s), local checkout path, default branch,
-- and herdr workspace name — so agents can self-serve checkout context before
-- spawning (DEV-29, control plane).
-- Run: wrangler d1 execute atur-db --file=migrations/2026-09-02-workspace-links.sql
-- (use --remote for prod D1). Safe to re-run: CREATE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS workspace_links (
  id TEXT PRIMARY KEY,
  workspace_slug TEXT NOT NULL UNIQUE,
  repo_urls TEXT,            -- JSON array of repo URLs / "owner/repo" identifiers; NULL = no repo
  local_path TEXT,           -- absolute path of the local checkout on the work machine
  default_branch TEXT,
  herdr_workspace TEXT,      -- session-backend workspace/session name for observe deep-links
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
