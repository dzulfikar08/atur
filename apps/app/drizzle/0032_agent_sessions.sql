CREATE TABLE `agent_session_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`on_blocked` text DEFAULT 'comment' NOT NULL,
	`on_done` text DEFAULT 'off' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`pane_id` text NOT NULL,
	`machine_id` text DEFAULT '' NOT NULL,
	`session_id` text,
	`agent` text,
	`state` text DEFAULT 'unknown' NOT NULL,
	`state_at` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`source` text NOT NULL,
	`cwd` text,
	`title` text,
	`linked_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	`last_notified_state` text,
	`last_notified_at` integer,
	`suggested_state_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_sessions_pane` ON `agent_sessions` (`machine_id`,`pane_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_workspace` ON `agent_sessions` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_issue` ON `agent_sessions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_session` ON `agent_sessions` (`session_id`);