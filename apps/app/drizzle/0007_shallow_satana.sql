CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`industry` text,
	`website` text,
	`logo_url` text,
	`brand_color` text,
	`description` text,
	`owner_id` text,
	`primary_contact_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_contact_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_companies_workspace` ON `companies` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_companies_workspace_domain` ON `companies` (`workspace_id`,`domain`);--> statement-breakpoint
CREATE TABLE `contact_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`company_id` text,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`band` text DEFAULT 'POSSIBLE' NOT NULL,
	`evidence` text,
	`method` text,
	`source_url` text,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`observed_at` text NOT NULL,
	`superseded_at` text,
	`created_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_contact_facts_customer_field_status` ON `contact_facts` (`customer_id`,`field`,`status`);--> statement-breakpoint
CREATE INDEX `idx_contact_facts_status_observed` ON `contact_facts` (`status`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_contact_facts_company` ON `contact_facts` (`company_id`);--> statement-breakpoint
CREATE TABLE `crm_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`deal_id` text,
	`type` text NOT NULL,
	`subject` text,
	`body` text,
	`occurred_at` text NOT NULL,
	`created_by` text,
	`created_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_crm_activities_customer` ON `crm_activities` (`customer_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_activities_deal` ON `crm_activities` (`deal_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `customers` ADD `company_id` text REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `customers` ADD `title` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `seniority` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `function` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `linkedin_url` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `last_activity_at` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `enriched_at` text;--> statement-breakpoint
CREATE INDEX `idx_customers_company` ON `customers` (`company_id`);--> statement-breakpoint
ALTER TABLE `deals` ADD `company_id` text REFERENCES companies(id);