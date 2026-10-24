CREATE TABLE `bridge_machines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bridge_machines_token_hash` ON `bridge_machines` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_bridge_machines_user` ON `bridge_machines` (`user_id`);