ALTER TABLE `customers` ADD `threads_username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customers_workspace_threads` ON `customers` (`workspace_id`,`threads_username`);