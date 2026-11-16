ALTER TABLE `notes` ADD `changed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_notes` ADD `changed_at` integer DEFAULT 0 NOT NULL;