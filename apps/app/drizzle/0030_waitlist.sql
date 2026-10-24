CREATE TABLE `waitlist` (
	`email` text PRIMARY KEY NOT NULL,
	`plan` text,
	`source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
