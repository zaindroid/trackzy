CREATE TABLE `oauth_connect_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "oauth_connect_states_provider_check" CHECK("oauth_connect_states"."provider" in ('ebay', 'aliexpress'))
);
