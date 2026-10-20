CREATE TABLE `threads_accounts` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`threads_user_id` text NOT NULL,
	`username` text NOT NULL,
	`access_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`connected_by` text,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `threads_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`media_id` text NOT NULL,
	`kind` text NOT NULL,
	`username` text,
	`text` text,
	`permalink` text,
	`replied_to_id` text,
	`root_post_id` text,
	`posted_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`customer_id` text,
	`reply_media_id` text,
	`replied_at` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_threads_inbox_media` ON `threads_inbox` (`workspace_id`,`media_id`);--> statement-breakpoint
CREATE INDEX `idx_threads_inbox_status` ON `threads_inbox` (`workspace_id`,`status`,`posted_at`);