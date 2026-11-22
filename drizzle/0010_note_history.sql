CREATE TABLE `note_history` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `note_versions` (
	`note_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	`content` blob NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`note_id`, `updated_at`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
