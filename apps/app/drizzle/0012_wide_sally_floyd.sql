CREATE TABLE `pane_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pane_id` text NOT NULL,
	`attached_at` integer NOT NULL,
	`detached_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_pane_audit_user` ON `pane_audit` (`user_id`,`attached_at`);--> statement-breakpoint
CREATE TABLE `workspace_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_slug` text NOT NULL,
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
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_links_workspace_slug_unique` ON `workspace_links` (`workspace_slug`);