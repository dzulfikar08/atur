CREATE TABLE IF NOT EXISTS `pane_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pane_id` text NOT NULL,
	`attached_at` integer NOT NULL,
	`detached_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pane_audit_user` ON `pane_audit` (`user_id`,`attached_at`);
-- NOTE: both objects above were already applied to prod D1 out-of-band:
-- workspace_links via migrations/2026-09-02-workspace-links.sql (DEV-29) and
-- pane_audit via drizzle-kit push during DEV-32 bridge bring-up. So
-- workspace_links is intentionally NOT (re)created here, and the CREATEs
-- above carry IF NOT EXISTS — this migration is a no-op against prod while
-- remaining authoritative for fresh environments.