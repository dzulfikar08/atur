CREATE TABLE `workspace_score_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`moat_score` integer,
	`ai_proof_score` integer,
	`strategy_verdict` text,
	`strategy_note` text,
	`created_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_score_history_workspace` ON `workspace_score_history` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `issues` ADD `is_decision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `moat_score` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ai_proof_score` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `strategy_verdict` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `strategy_note` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `reviewed_at` text;