-- Canonical state keys (ATUR-3): stable cross-project identity for workflow
-- states, behind ?state_key= filters (/api/me/issues, /api/me/state-summary,
-- MCP list_issues). `key` is DERIVED (never user-authored): known state names
-- win, otherwise the state's group decides. NULL would mean a custom group;
-- every group in use today maps to a key. Names stay free/localizable.
-- Run:  cd apps/app && bunx wrangler d1 execute atur-db --local --file=./migrations/2026-09-03-state-keys.sql
-- Prod: cd apps/app && bunx wrangler d1 execute atur-db --remote --file=./migrations/2026-09-03-state-keys.sql

ALTER TABLE states ADD COLUMN `key` TEXT;

-- Non-started groups map 1:1 from group_name.
UPDATE states SET `key` = 'backlog' WHERE group_name = 'backlog' AND `key` IS NULL;
UPDATE states SET `key` = 'done' WHERE group_name = 'completed' AND `key` IS NULL;
UPDATE states SET `key` = 'cancelled' WHERE group_name = 'cancelled' AND `key` IS NULL;

-- started group: granular by name (case-insensitive, trimmed), then fallback.
UPDATE states SET `key` = 'todo' WHERE group_name = 'started' AND lower(trim(name)) = 'todo';
UPDATE states SET `key` = 'in_progress' WHERE group_name = 'started' AND lower(trim(name)) IN ('in progress', 'jalan');
UPDATE states SET `key` = 'needs_you' WHERE group_name = 'started' AND lower(trim(name)) IN ('needs you', 'need confirmation');
UPDATE states SET `key` = 'need_review' WHERE group_name = 'started' AND lower(trim(name)) = 'need review';
-- Any other started state (custom names like "Menunggu Meta") is active work.
UPDATE states SET `key` = 'in_progress' WHERE group_name = 'started' AND `key` IS NULL;
