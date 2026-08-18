CREATE TABLE `polar_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`service` text DEFAULT 'polar' NOT NULL,
	`polar_type` text NOT NULL,
	`polar_id` text NOT NULL,
	`customer_id` text,
	`deal_id` text,
	`raw` text,
	`last_event` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_polar_links_entity` ON `polar_links` (`workspace_id`,`service`,`polar_type`,`polar_id`);--> statement-breakpoint
CREATE INDEX `idx_polar_links_customer` ON `polar_links` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_polar_links_workspace` ON `polar_links` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `polar_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`access_token` text,
	`webhook_secret` text,
	`pipeline_project_id` text,
	`default_state_id` text,
	`webhook_enabled` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `polar_customer_id` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `polar_subscription_id` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `polar_order_id` text;