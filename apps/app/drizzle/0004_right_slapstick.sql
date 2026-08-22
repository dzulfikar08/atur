CREATE TABLE `crm_email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`purpose` text NOT NULL,
	`variant_id` text,
	`variant_name` text,
	`subject` text NOT NULL,
	`sent_at` text NOT NULL,
	`sent` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_crm_email_log_customer` ON `crm_email_log` (`customer_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `crm_email_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`purpose` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`is_html` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crm_email_variants` ON `crm_email_variants` (`workspace_id`,`purpose`,`name`);--> statement-breakpoint
CREATE INDEX `idx_crm_email_variants_workspace` ON `crm_email_variants` (`workspace_id`,`purpose`);