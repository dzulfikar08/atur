-- Workspace-link autonomy modes (firstmate port, DEV-29/DEV-30):
--   mode       NULL | 'local-only' | 'direct-PR'  — how far an agent may take
--               its branch. NULL = local-only (branch left for human).
--   auto_merge NULL | 'yolo'                      — explicit per-workspace merge
--               autonomy; agent may merge its own PR after green gates.
-- Run: wrangler d1 execute atur-db --remote --file=migrations/2026-09-02-workspace-links-modes.sql
-- NOT re-runnable: SQLite/D1 has no ADD COLUMN IF NOT EXISTS.
ALTER TABLE workspace_links ADD COLUMN mode TEXT;
ALTER TABLE workspace_links ADD COLUMN auto_merge TEXT;
