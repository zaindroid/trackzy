ALTER TABLE `users` ADD `gmail_refresh_token_ref` text;--> statement-breakpoint
ALTER TABLE `users` ADD `gmail_access_token_ref` text;--> statement-breakpoint
ALTER TABLE `users` ADD `gmail_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `gmail_last_polled_at` integer;