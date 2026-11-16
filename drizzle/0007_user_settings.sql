CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`content` blob NOT NULL,
	`updated_at` integer NOT NULL,
	`changed_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
