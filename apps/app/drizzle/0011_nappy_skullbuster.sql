CREATE TABLE `project_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_folders_workspace` ON `project_folders` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `folder_id` text REFERENCES project_folders(id) ON DELETE SET NULL;