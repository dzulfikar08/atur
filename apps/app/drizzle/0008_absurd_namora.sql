CREATE TABLE `issue_sequence_counters` (
	`project_id` text PRIMARY KEY NOT NULL,
	`next_sequence` integer NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contact_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
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
INSERT INTO `__new_contact_facts`("id", "workspace_id", "customer_id", "company_id", "field", "value", "score", "band", "evidence", "method", "source_url", "status", "decided_by", "decided_at", "observed_at", "superseded_at", "created_at") SELECT "id", "workspace_id", "customer_id", "company_id", "field", "value", "score", "band", "evidence", "method", "source_url", "status", "decided_by", "decided_at", "observed_at", "superseded_at", "created_at" FROM `contact_facts`;--> statement-breakpoint
DROP TABLE `contact_facts`;--> statement-breakpoint
ALTER TABLE `__new_contact_facts` RENAME TO `contact_facts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_contact_facts_customer_field_status` ON `contact_facts` (`customer_id`,`field`,`status`);--> statement-breakpoint
CREATE INDEX `idx_contact_facts_status_observed` ON `contact_facts` (`status`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_contact_facts_company` ON `contact_facts` (`company_id`);