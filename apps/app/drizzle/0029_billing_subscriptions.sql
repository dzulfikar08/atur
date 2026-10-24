CREATE TABLE `billing_subscriptions` (
	`polar_subscription_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`customer_email` text NOT NULL,
	`customer_external_id` text,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT 0 NOT NULL,
	`modified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_billing_subscriptions_user` ON `billing_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_subscriptions_email` ON `billing_subscriptions` (lower("customer_email"));