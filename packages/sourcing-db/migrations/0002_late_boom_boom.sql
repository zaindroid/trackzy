CREATE TABLE `radar_products` (
	`id` text PRIMARY KEY NOT NULL,
	`niche` text NOT NULL,
	`product_title` text NOT NULL,
	`image_url` text,
	`ebay_sold_count` integer DEFAULT 0 NOT NULL,
	`sales_per_day` real DEFAULT 0 NOT NULL,
	`ebay_active_count` integer DEFAULT 0 NOT NULL,
	`sell_through_percent` real DEFAULT 0 NOT NULL,
	`ebay_median_sold_price_cents` integer DEFAULT 0 NOT NULL,
	`aliexpress_product_id` text,
	`aliexpress_url` text,
	`aliexpress_cost_cents` integer,
	`aliexpress_rating` real,
	`aliexpress_orders` integer,
	`sourceable` integer DEFAULT 0 NOT NULL,
	`margin_cents` integer DEFAULT 0 NOT NULL,
	`margin_percent` real DEFAULT 0 NOT NULL,
	`opportunity_score` real DEFAULT 0 NOT NULL,
	`last_updated` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `radar_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`items_written` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	CONSTRAINT "radar_runs_status_check" CHECK("radar_runs"."status" in ('running', 'done', 'failed'))
);
