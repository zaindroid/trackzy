ALTER TABLE `suppliers` ADD `oauth_access_token_ref` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `oauth_refresh_token_ref` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `oauth_expires_at` integer;