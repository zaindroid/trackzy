CREATE TABLE `apify_usage` (
	`month_key` text PRIMARY KEY NOT NULL,
	`results_consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `supplier_cache` (
	`normalized_key` text PRIMARY KEY NOT NULL,
	`match_json` text,
	`sourceable` integer DEFAULT 0 NOT NULL,
	`last_checked` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `radar_products` ADD `supplier_check` text DEFAULT 'none' NOT NULL;