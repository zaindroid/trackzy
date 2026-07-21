CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_id` text NOT NULL,
	`reason` text NOT NULL,
	`draft_subject` text NOT NULL,
	`draft_body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "disputes_status_check" CHECK("disputes"."status" in ('draft', 'approved', 'sent', 'resolved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `fulfillment_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_id` text NOT NULL,
	`order_line_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_line_item_id`) REFERENCES `order_line_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fulfillments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`cost_cents` integer,
	`tracking_number` text,
	`carrier_declared` text,
	`carrier_detected` text,
	`carrier_final` text,
	`tracking_status` text DEFAULT 'pending' NOT NULL,
	`pushed_to_storefront` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillments_source_check" CHECK("fulfillments"."source" in ('regex', 'gemini', 'manual', 'supplier_api'))
);
--> statement-breakpoint
CREATE INDEX `fulfillments_tracking_number_idx` ON `fulfillments` (`tracking_number`);--> statement-breakpoint
CREATE TABLE `order_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`external_line_item_id` text NOT NULL,
	`fulfillment_order_line_item_id` text,
	`sku` text NOT NULL,
	`title` text NOT NULL,
	`quantity` integer NOT NULL,
	`quantity_fulfilled` integer DEFAULT 0 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`external_order_id` text NOT NULL,
	`external_order_number` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`currency` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`margin_cents` integer,
	`raw_payload_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_payload_id`) REFERENCES `webhook_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" in ('received', 'evaluating', 'fulfilling', 'partially_shipped', 'shipped', 'delivered', 'exception', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_storefront_id_external_order_id_unique` ON `orders` (`storefront_id`,`external_order_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`min_margin_cents` integer DEFAULT 200 NOT NULL,
	`margin_mode` text DEFAULT 'absolute' NOT NULL,
	`min_margin_percent` real DEFAULT 10 NOT NULL,
	`auto_fulfill` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_margin_mode_check" CHECK("settings"."margin_mode" in ('absolute', 'percent'))
);
--> statement-breakpoint
CREATE TABLE `storefronts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`shop_domain` text NOT NULL,
	`access_token_ref` text NOT NULL,
	`webhook_secret_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "storefronts_platform_check" CHECK("storefronts"."platform" in ('shopify'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefronts_shop_domain_unique` ON `storefronts` (`shop_domain`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`api_base_url` text NOT NULL,
	`api_key_ref` text NOT NULL,
	`email_sender_pattern` text NOT NULL,
	`parser_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_id_unique` ON `users` (`clerk_user_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`dedup_key` text NOT NULL,
	`raw_body` text NOT NULL,
	`headers_json` text NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`received_at` integer NOT NULL,
	CONSTRAINT "webhook_events_source_check" CHECK("webhook_events"."source" in ('shopify', '17track', 'email'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_source_dedup_key_unique` ON `webhook_events` (`source`,`dedup_key`);