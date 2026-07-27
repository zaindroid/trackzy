CREATE TABLE `listing_monitors` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`min_margin_percent` real DEFAULT 20 NOT NULL,
	`price_ceiling_cents` integer,
	`stock_status` text DEFAULT 'in' NOT NULL,
	`current_supplier_cost_cents` integer,
	`current_sell_price_cents` integer,
	`current_margin_percent` real,
	`health` text DEFAULT 'healthy' NOT NULL,
	`last_action` text,
	`last_reason` text,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `listing_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`supplier_cost_cents` integer NOT NULL,
	`sell_price_cents` integer NOT NULL,
	`margin_percent` real NOT NULL,
	`stock_status` text NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `listing_price_history_candidate_idx` ON `listing_price_history` (`candidate_id`,`captured_at`);