-- DEV-29 fresh-environment gap: workspace_links reached prod out-of-band
-- (migrations/2026-09-02-workspace-links*.sql) and 0012 intentionally skipped
-- its CREATE, so the drizzle chain alone never produced the table. This
-- migration makes the chain authoritative again: IF NOT EXISTS keeps it a
-- no-op where the table already exists (prod, seeded local dev) while fresh
-- environments now get the full definition, including the mode/auto_merge
-- autonomy columns from migrations/2026-09-02-workspace-links-modes.sql.
-- The workspace seed stays out-of-band (INSERT OR IGNORE, point-in-time
-- baseline): migrations/2026-09-02-workspace-links-seed.sql.
CREATE TABLE IF NOT EXISTS `workspace_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_slug` text NOT NULL UNIQUE,
	`repo_urls` text,
	`local_path` text,
	`default_branch` text,
	`herdr_workspace` text,
	`notes` text,
	`created_at` text,
	`updated_at` text,
	`mode` text,
	`auto_merge` text
);
