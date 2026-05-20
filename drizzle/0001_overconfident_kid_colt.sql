CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`content` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived` integer NOT NULL,
	`style` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `task`;