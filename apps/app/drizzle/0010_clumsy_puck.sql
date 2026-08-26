CREATE TABLE `custom_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`custom_field_id` text NOT NULL,
	`value_json` text,
	`workspace_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`custom_field_id`) REFERENCES `custom_fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_custom_field_value` ON `custom_field_values` (`issue_id`,`custom_field_id`);--> statement-breakpoint
CREATE INDEX `idx_cfv_field` ON `custom_field_values` (`custom_field_id`);