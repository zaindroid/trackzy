CREATE TABLE `product_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`keyword` text NOT NULL,
	`total_listings` integer NOT NULL,
	`unique_sellers` integer NOT NULL,
	`avg_price_cents` integer NOT NULL,
	`median_price_cents` integer NOT NULL,
	`free_shipping_percent` real NOT NULL,
	`opportunity_score` real NOT NULL,
	`sample_listings_json` text NOT NULL,
	`scanned_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
