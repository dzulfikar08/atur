CREATE TABLE `model_prices` (
	`model` text PRIMARY KEY NOT NULL,
	`input_per_mtok` real NOT NULL,
	`output_per_mtok` real NOT NULL,
	`cache_read_per_mtok` real NOT NULL,
	`cache_write_per_mtok` real NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
-- Seed prices (USD per 1M tokens) for known harness-reported model strings.
-- Unknown models simply have no row → aggregate cost is null. Editable data,
-- not gospel: update rows as list prices change.
INSERT OR IGNORE INTO `model_prices` (`model`, `input_per_mtok`, `output_per_mtok`, `cache_read_per_mtok`, `cache_write_per_mtok`, `created_at`, `updated_at`) VALUES
  ('zai/glm-5.3-flash', 0.2, 1.0, 0.05, 0.2, datetime('now'), datetime('now')),
  -- The omp harness reports glm without the vendor prefix; same prices.
  ('glm-5.3-flash', 0.2, 1.0, 0.05, 0.2, datetime('now'), datetime('now')),
  ('gpt-5.2', 1.25, 10.0, 0.125, 0.0, datetime('now'), datetime('now')),
  ('gpt-5.2-codex', 1.25, 10.0, 0.125, 0.0, datetime('now'), datetime('now')),
  ('claude-opus-4-1', 15.0, 75.0, 1.5, 18.75, datetime('now'), datetime('now')),
  ('claude-sonnet-4-5', 3.0, 15.0, 0.3, 3.75, datetime('now'), datetime('now')),
  ('gemini-2.5-pro', 1.25, 10.0, 0.31, 0.0, datetime('now'), datetime('now')),
  ('gemini-2.5-flash', 0.3, 2.5, 0.075, 0.0, datetime('now'), datetime('now'));
