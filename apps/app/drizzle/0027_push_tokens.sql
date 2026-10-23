CREATE TABLE `push_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_push_tokens_token` ON `push_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_push_tokens_user` ON `push_tokens` (`user_id`);