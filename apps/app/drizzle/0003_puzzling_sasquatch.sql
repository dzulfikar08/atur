DROP INDEX `idx_crm_email_templates_workspace`;--> statement-breakpoint
ALTER TABLE `customers` ADD `last_email_at` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `email_footer` text;