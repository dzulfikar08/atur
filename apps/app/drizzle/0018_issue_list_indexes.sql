CREATE INDEX `idx_issue_assignees_assignee` ON `issue_assignees` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_labels_label` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_project_deleted` ON `issues` (`project_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_issues_target_date` ON `issues` (`target_date`);--> statement-breakpoint
CREATE INDEX `idx_issues_workspace_updated` ON `issues` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_states_project_sequence` ON `states` (`project_id`,`sequence`);