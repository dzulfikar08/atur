CREATE TABLE `user_hidden_workspaces` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
