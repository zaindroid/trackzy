CREATE TABLE `winner_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`winner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_id`) REFERENCES `winners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `winner_unlocks_user_winner_unique` ON `winner_unlocks` (`user_id`,`winner_id`);--> statement-breakpoint
CREATE TABLE `winners` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_key` text NOT NULL,
	`keyword` text NOT NULL,
	`product_title` text NOT NULL,
	`image_urls_json` text NOT NULL,
	`supplier_provider` text NOT NULL,
	`supplier_product_id` text NOT NULL,
	`supplier_cost_cents` integer NOT NULL,
	`supplier_product_url` text,
	`ebay_sold_count` integer NOT NULL,
	`ebay_median_price_cents` integer NOT NULL,
	`margin_cents` integer NOT NULL,
	`margin_percent` real NOT NULL,
	`score` real NOT NULL,
	`generated_title` text NOT NULL,
	`generated_description` text NOT NULL,
	`generated_aspects_json` text NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`times_unlocked` integer DEFAULT 0 NOT NULL,
	`last_scored_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `winners_normalized_key_unique` ON `winners` (`normalized_key`);