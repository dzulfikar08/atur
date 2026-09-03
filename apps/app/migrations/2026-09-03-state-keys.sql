-- Canonical state keys backfill (ATUR-3): stable cross-project identity for
-- workflow states, behind ?state_key= filters (/api/me/issues,
-- /api/mee/state-summary, MCP list_issues).
--
-- The DDL (ADD COLUMN `key`) lives in drizzle/0013_powerful_silvermane.sql —
-- the Drizzle path is authoritative (see migrations/README.md). This file is
-- the out-of-band BACKFILL for databases that already have rows:
--   prod:  bun run db:migrate   (applies drizzle/0013, adds the column)
--   then:  bunx wrangler d1 execute atur-db --remote --file=./migrations/2026-09-03-state-keys.sql
--   local: same commands with --local
--
-- `key` is DERIVED, never user-authored, mirroring canonicalStateKey()
-- (services/states.ts): known names win (case-insensitive, trimmed — including
-- localized aliases Jalan / Need Confirmation / Selesai / Gagal), otherwise
-- the state's group decides. Name rules run FIRST so the backfill matches the
-- runtime for any row, then group fallbacks only fill what's still NULL.
-- Names stay free/localizable; NULL key = custom group.

-- Known names, any group (mirrors NAME_TO_KEY).
UPDATE states SET `key` = 'backlog' WHERE lower(trim(name)) = 'backlog';
UPDATE states SET `key` = 'todo' WHERE lower(trim(name)) = 'todo';
UPDATE states SET `key` = 'in_progress' WHERE lower(trim(name)) IN ('in progress', 'jalan');
UPDATE states SET `key` = 'needs_you' WHERE lower(trim(name)) IN ('needs you', 'need confirmation');
UPDATE states SET `key` = 'need_review' WHERE lower(trim(name)) = 'need review';
UPDATE states SET `key` = 'done' WHERE lower(trim(name)) IN ('done', 'selesai');
UPDATE states SET `key` = 'cancelled' WHERE lower(trim(name)) IN ('cancelled', 'gagal');

-- Group fallback for custom names (mirrors the switch in canonicalStateKey).
UPDATE states SET `key` = 'backlog' WHERE group_name = 'backlog' AND `key` IS NULL;
UPDATE states SET `key` = 'in_progress' WHERE group_name = 'started' AND `key` IS NULL;
UPDATE states SET `key` = 'done' WHERE group_name = 'completed' AND `key` IS NULL;
UPDATE states SET `key` = 'cancelled' WHERE group_name = 'cancelled' AND `key` IS NULL;
