ALTER TABLE `time_entries` ADD `source` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `agent_name` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `model` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `reasoning_tokens` integer;