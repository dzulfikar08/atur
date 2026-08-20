CREATE TABLE `crm_email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`template_name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`is_html` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crm_email_templates_workspace` ON `crm_email_templates` (`workspace_id`,`template_name`);--> statement-breakpoint
CREATE INDEX `idx_crm_email_templates_workspace` ON `crm_email_templates` (`workspace_id`);