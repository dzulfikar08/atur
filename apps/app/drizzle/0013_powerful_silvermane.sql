ALTER TABLE `states` ADD `key` text;
-- NOTE (ATUR-3): on existing databases the column lands via this migration
-- (bun run db:migrate); the row BACKFILL lives out-of-band in
-- migrations/2026-09-03-state-keys.sql and must run AFTER this migration and
-- BEFORE the worker deploy that selects states.key.
