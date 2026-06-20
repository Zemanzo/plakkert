ALTER TABLE `user` ADD `username` text NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `display_username` text NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `private_key` text NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `nonce` text NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `salt` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);