CREATE TABLE `feedback_attachments` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`issue_id` text,
	`filename` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `feedback_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_attachments_issue` ON `feedback_attachments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_feedback_attachments_unclaimed` ON `feedback_attachments` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ingest_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`level` text DEFAULT 'error' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ingest_groups_fingerprint` ON `ingest_groups` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_ingest_groups_issue` ON `ingest_groups` (`issue_id`);--> statement-breakpoint
ALTER TABLE `feedback_boards` ADD `identify_secret` text;--> statement-breakpoint
ALTER TABLE `feedback_boards` ADD `ingest_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feedback_boards_ingest_key` ON `feedback_boards` (`ingest_key`);--> statement-breakpoint
ALTER TABLE `feedback_meta` ADD `kind` text DEFAULT 'idea' NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback_meta` ADD `context_json` text;--> statement-breakpoint
ALTER TABLE `feedback_meta` ADD `external_user_id` text;--> statement-breakpoint
ALTER TABLE `feedback_meta` ADD `identity_verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback_meta` ADD `email_trusted` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_feedback_meta_email` ON `feedback_meta` (`author_email`);