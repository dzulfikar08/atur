CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`metadata` text,
	`user_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accounts_provider` ON `accounts` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`label` text,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `api_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer,
	`duration_ms` integer,
	`user_id` text,
	`workspace_id` text,
	`created_at` text
);
--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`field_type` text NOT NULL,
	`description` text,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`is_required` integer DEFAULT 0 NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`options` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`email` text,
	`name` text,
	`company` text,
	`phone` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text,
	`session_token` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customers_workspace_user` ON `customers` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customers_workspace_email` ON `customers` (`workspace_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_customers_session_token` ON `customers` (`session_token`);--> statement-breakpoint
CREATE TABLE `cycle_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`start_date` text,
	`end_date` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`progress_snapshot` text,
	`archived_at` text,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owned_by_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cycles_project` ON `cycles` (`project_id`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`customer_id` text,
	`workspace_id` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`expected_close_at` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deals_issue_id_unique` ON `deals` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_customer` ON `deals` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_workspace` ON `deals` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `estimate_points` (
	`id` text PRIMARY KEY NOT NULL,
	`estimate_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`status` text DEFAULT 'queued',
	`metadata` text,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`created_by_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feedback_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`public_token` text NOT NULL,
	`slug` text,
	`title` text NOT NULL,
	`description` text,
	`allow_submit` integer DEFAULT 1 NOT NULL,
	`allow_voting` integer DEFAULT 1 NOT NULL,
	`require_email` integer DEFAULT 0 NOT NULL,
	`allow_comments` integer DEFAULT 1 NOT NULL,
	`default_state_id` text,
	`submit_label_id` text,
	`brand_color` text DEFAULT '#6366f1' NOT NULL,
	`position` text DEFAULT 'bottom-right' NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_boards_public_token_unique` ON `feedback_boards` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feedback_boards_token` ON `feedback_boards` (`public_token`);--> statement-breakpoint
CREATE INDEX `idx_feedback_boards_project` ON `feedback_boards` (`project_id`);--> statement-breakpoint
CREATE TABLE `feedback_meta` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`author_email` text,
	`author_name` text,
	`source` text,
	`created_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feedback_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`voter_hash` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feedback_votes` ON `feedback_votes` (`issue_id`,`voter_hash`);--> statement-breakpoint
CREATE INDEX `idx_feedback_votes_issue` ON `feedback_votes` (`issue_id`);--> statement-breakpoint
CREATE TABLE `file_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset` text,
	`attributes` text,
	`entity_id` text,
	`entity_type` text,
	`size` integer,
	`content_type` text,
	`is_uploaded` integer DEFAULT 0 NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_file_assets_entity` ON `file_assets` (`entity_id`,`entity_type`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`status` text DEFAULT 'queued',
	`data` text,
	`metadata` text,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`created_by_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `integration_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`expires_at` text,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `issue_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`verb` text DEFAULT 'created',
	`field` text,
	`old_value` text,
	`new_value` text,
	`issue_id` text,
	`issue_comment_id` text,
	`actor_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `issue_assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`assignee_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issue_assignees_issue` ON `issue_assignees` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`asset` text,
	`attributes` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_stripped` text,
	`comment_json` text,
	`comment_html` text,
	`access` text DEFAULT 'internal',
	`parent_id` text,
	`issue_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issue_comments_issue` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issue_labels_issue` ON `issue_labels` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_links` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`title` text,
	`url` text,
	`metadata` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`related_issue_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`reminder_date` text NOT NULL,
	`reminder_type` text DEFAULT 'target_date' NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issue_reminders_issue` ON `issue_reminders` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`issue_id` text,
	`project_id` text NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `issue_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`subscriber_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_issue_subscribers_issue_user` ON `issue_subscribers` (`issue_id`,`subscriber_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sequence_id` integer NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`priority` text DEFAULT 'none',
	`start_date` text,
	`target_date` text,
	`completed_at` text,
	`archived_at` text,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`description_json` text,
	`description_html` text,
	`description_stripped` text,
	`description_binary` blob,
	`parent_id` text,
	`state_id` text,
	`estimate_point_id` text,
	`estimate_points` integer,
	`type_id` text,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by_id` text,
	`external_source` text,
	`external_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_issue_sequence` ON `issues` (`project_id`,`sequence_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_project` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_workspace` ON `issues` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_state` ON `issues` (`state_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_deleted_at` ON `issues` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`parent_id` text,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_labels_workspace` ON `labels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `module_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `module_members` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'planned',
	`start_date` text,
	`target_date` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`archived_at` text,
	`lead_id` text,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`lead_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_modules_project` ON `modules` (`project_id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`notification_type` text NOT NULL,
	`email_enabled` integer DEFAULT 1 NOT NULL,
	`push_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text,
	`entity_identifier` text,
	`entity_name` text,
	`title` text,
	`message` text,
	`read_at` text,
	`archived_at` text,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`triggered_by_id` text,
	`receiver_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_receiver` ON `notifications` (`receiver_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_workspace` ON `notifications` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`description_binary` blob,
	`description_html` text,
	`description_json` text,
	`last_saved_at` text,
	`owned_by_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description_json` text,
	`description_binary` blob,
	`description_html` text,
	`description_stripped` text,
	`access` integer DEFAULT 0 NOT NULL,
	`color` text,
	`archived_at` text,
	`is_locked` integer DEFAULT 0 NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`parent_id` text,
	`workspace_id` text NOT NULL,
	`owned_by_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pages_workspace` ON `pages` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `portal_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`support_project_id` text,
	`is_enabled` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`support_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`theme` text,
	`is_onboarded` integer DEFAULT 0 NOT NULL,
	`onboarding_step` text,
	`use_case` text,
	`role` text,
	`language` text DEFAULT 'en',
	`user_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` integer DEFAULT 15 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`identifier` text NOT NULL,
	`description` text,
	`description_html` text,
	`description_json` text,
	`workspace_id` text NOT NULL,
	`network` integer DEFAULT 0 NOT NULL,
	`emoji` text,
	`icon_prop` text,
	`cover_image` text,
	`default_assignee_id` text,
	`project_lead_id` text,
	`default_state_id` text,
	`module_view` integer DEFAULT 1 NOT NULL,
	`cycle_view` integer DEFAULT 1 NOT NULL,
	`page_view` integer DEFAULT 1 NOT NULL,
	`intake_view` integer DEFAULT 1 NOT NULL,
	`is_time_tracking_enabled` integer DEFAULT 0 NOT NULL,
	`archive_in` integer,
	`close_in` integer,
	`timezone` text DEFAULT 'UTC',
	`archived_at` text,
	`external_source` text,
	`external_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_identifier` ON `projects` (`identifier`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_workspace` ON `projects` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `sprint_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`start_date` text,
	`end_date` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owned_by_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sprints_project` ON `sprints` (`project_id`);--> statement-breakpoint
CREATE TABLE `states` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`slug` text,
	`sequence` real DEFAULT 65535 NOT NULL,
	`group_name` text NOT NULL,
	`is_triage` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_states_project` ON `states` (`project_id`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_tickets_issue_id_unique` ON `support_tickets` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_support_tickets_customer` ON `support_tickets` (`customer_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`description` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`clockify_id` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_issue` ON `time_entries` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_workspace` ON `time_entries` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_user` ON `time_entries` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`password_hash` text,
	`avatar` text,
	`token` text,
	`session_expires_at` text,
	`user_timezone` text DEFAULT 'UTC',
	`is_active` integer DEFAULT 1 NOT NULL,
	`is_superuser` integer DEFAULT 0 NOT NULL,
	`is_email_verified` integer DEFAULT 0 NOT NULL,
	`is_bot` integer DEFAULT 0 NOT NULL,
	`is_customer` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_token` ON `users` (`token`);--> statement-breakpoint
CREATE INDEX `idx_users_deleted_at` ON `users` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`events` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` integer DEFAULT 15 NOT NULL,
	`token` text,
	`accepted` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` integer DEFAULT 15 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`view_props` text,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_workspace_member` ON `workspace_members` (`workspace_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_members_workspace` ON `workspace_members` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_members_member` ON `workspace_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`organization_size` text,
	`timezone` text DEFAULT 'UTC',
	`background_color` text,
	`owner_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_slug` ON `workspaces` (`slug`);