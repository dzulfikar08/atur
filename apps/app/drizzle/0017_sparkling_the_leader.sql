CREATE TABLE `mayar_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`api_key` text,
	`api_version` text DEFAULT 'v1' NOT NULL,
	`last_synced_at` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mayar_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`mayar_transaction_id` text,
	`payment_link_transaction_id` text,
	`credit` integer,
	`status` text NOT NULL,
	`balance_history_type` text,
	`payment_method` text,
	`customer_id` text,
	`customer_name` text,
	`customer_email` text,
	`amount` integer,
	`fee` text,
	`payment_link_id` text,
	`payment_link_name` text,
	`subscription_id` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mayar_workspace_txn` ON `mayar_transactions` (`workspace_id`,`mayar_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_mayar_workspace` ON `mayar_transactions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_mayar_status` ON `mayar_transactions` (`status`);--> statement-breakpoint
CREATE TABLE `paywuz_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`api_key` text,
	`environment` text DEFAULT 'sandbox' NOT NULL,
	`last_synced_at` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `paywuz_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`order_id` text NOT NULL,
	`transaction_id` text,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`total_payment` integer,
	`fee` integer,
	`payment_method` text,
	`payment_number` text,
	`payment_url` text,
	`expired_at` text,
	`paid_at` text,
	`created_at` text,
	`updated_at` text,
	`metadata` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_paywuz_workspace_order` ON `paywuz_transactions` (`workspace_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `idx_paywuz_workspace` ON `paywuz_transactions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_paywuz_status` ON `paywuz_transactions` (`status`);