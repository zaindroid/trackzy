CREATE TABLE `ebay_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`oauth_access_token_ref` text NOT NULL,
	`oauth_refresh_token_ref` text NOT NULL,
	`oauth_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text,
	`keyword` text NOT NULL,
	`ebay_avg_sold_price_cents` integer NOT NULL,
	`ebay_median_price_cents` integer NOT NULL,
	`ebay_sold_count` integer NOT NULL,
	`supplier_provider` text NOT NULL,
	`supplier_product_id` text NOT NULL,
	`supplier_cost_cents` integer NOT NULL,
	`supplier_product_url` text,
	`supplier_image_urls_json` text NOT NULL,
	`margin_cents` integer NOT NULL,
	`margin_percent` real NOT NULL,
	`opportunity_score` real NOT NULL,
	`suggested_sell_price_cents` integer NOT NULL,
	`generated_title` text NOT NULL,
	`generated_description` text NOT NULL,
	`generated_aspects_json` text NOT NULL,
	`category_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`ebay_item_id` text,
	`sku` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_candidates_status_check" CHECK("product_candidates"."status" in ('draft', 'listed', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`seed` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "research_runs_status_check" CHECK("research_runs"."status" in ('running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `seller_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_shipping_cost_cents` integer DEFAULT 0 NOT NULL,
	`handling_time_days` integer DEFAULT 3 NOT NULL,
	`return_policy` text DEFAULT '30_day' NOT NULL,
	`target_margin_percent` real DEFAULT 30 NOT NULL,
	`ebay_fee_percent` real DEFAULT 13.25 NOT NULL,
	`item_location_postal_code` text DEFAULT '10001' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`api_key_ref` text NOT NULL,
	`api_base_url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_connections_provider_check" CHECK("supplier_connections"."provider" in ('cj', 'aliexpress'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_id_unique` ON `users` (`clerk_user_id`);