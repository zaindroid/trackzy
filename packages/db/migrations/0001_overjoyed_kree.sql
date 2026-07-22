CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`external_listing_id` text NOT NULL,
	`sku` text NOT NULL,
	`title` text NOT NULL,
	`price_cents` integer NOT NULL,
	`quantity_available` integer NOT NULL,
	`supplier_id` text,
	`supplier_product_id` text,
	`match_confidence` real,
	`match_source` text,
	`auto_reprice` integer DEFAULT 1 NOT NULL,
	`auto_pause` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "listings_match_source_check" CHECK("listings"."match_source" in ('exact_sku', 'fuzzy_title', 'embedding', 'llm', 'manual')),
	CONSTRAINT "listings_status_check" CHECK("listings"."status" in ('active', 'paused_out_of_stock', 'paused_margin', 'paused_manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_storefront_id_external_listing_id_unique` ON `listings` (`storefront_id`,`external_listing_id`);--> statement-breakpoint
CREATE TABLE `manual_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "manual_tasks_state_check" CHECK("manual_tasks"."state" in ('pending', 'claimed', 'ordered', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trigger` text NOT NULL,
	`body_template` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "message_templates_trigger_check" CHECK("message_templates"."trigger" in ('sold', 'shipped', 'delivered', 'stalled', 'feedback_reminder'))
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`trigger` text NOT NULL,
	`template_id` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "messages_trigger_check" CHECK("messages"."trigger" in ('sold', 'shipped', 'delivered', 'stalled', 'feedback_reminder')),
	CONSTRAINT "messages_status_check" CHECK("messages"."status" in ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `supplier_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`supplier_product_id` text NOT NULL,
	`cost_cents` integer NOT NULL,
	`shipping_cents` integer DEFAULT 0 NOT NULL,
	`in_stock` integer DEFAULT 1 NOT NULL,
	`ship_days` real,
	`score` real,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracking_events` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_id` text NOT NULL,
	`original_tracking` text,
	`proxy_tracking` text,
	`proxy_carrier` text,
	`status` text NOT NULL,
	`raw_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tracking_events_status_check" CHECK("tracking_events"."status" in ('pending', 'in_transit', 'delivered', 'exception', 'needs_review'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_storefronts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`shop_domain` text NOT NULL,
	`access_token_ref` text NOT NULL,
	`webhook_secret_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	`marketplace_id` text,
	`oauth_refresh_token_ref` text,
	`oauth_access_token_ref` text,
	`oauth_expires_at` integer,
	`last_polled_at` integer,
	`non_api_mode` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "storefronts_platform_check" CHECK("__new_storefronts"."platform" in ('shopify', 'ebay', 'amazon'))
);
--> statement-breakpoint
INSERT INTO `__new_storefronts`("id", "user_id", "platform", "shop_domain", "access_token_ref", "webhook_secret_ref", "created_at", "marketplace_id", "oauth_refresh_token_ref", "oauth_access_token_ref", "oauth_expires_at", "last_polled_at", "non_api_mode") SELECT "id", "user_id", "platform", "shop_domain", "access_token_ref", "webhook_secret_ref", "created_at", "marketplace_id", "oauth_refresh_token_ref", "oauth_access_token_ref", "oauth_expires_at", "last_polled_at", "non_api_mode" FROM `storefronts`;--> statement-breakpoint
DROP TABLE `storefronts`;--> statement-breakpoint
ALTER TABLE `__new_storefronts` RENAME TO `storefronts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `storefronts_shop_domain_unique` ON `storefronts` (`shop_domain`);--> statement-breakpoint
CREATE TABLE `__new_suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`api_base_url` text NOT NULL,
	`api_key_ref` text NOT NULL,
	`email_sender_pattern` text NOT NULL,
	`parser_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text DEFAULT 'api' NOT NULL,
	`provider` text DEFAULT 'generic_rest' NOT NULL,
	`on_time_rate` real DEFAULT 1 NOT NULL,
	`avg_ship_days` real,
	`stock_confidence` real,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suppliers_kind_check" CHECK("__new_suppliers"."kind" in ('api', 'manual')),
	CONSTRAINT "suppliers_provider_check" CHECK("__new_suppliers"."provider" in ('amazon_business', 'amazon_retail', 'aliexpress', 'cj', 'generic_rest', 'manual'))
);
--> statement-breakpoint
INSERT INTO `__new_suppliers`("id", "user_id", "name", "api_base_url", "api_key_ref", "email_sender_pattern", "parser_id", "active", "created_at", "kind", "provider", "on_time_rate", "avg_ship_days", "stock_confidence", "priority") SELECT "id", "user_id", "name", "api_base_url", "api_key_ref", "email_sender_pattern", "parser_id", "active", "created_at", "kind", "provider", "on_time_rate", "avg_ship_days", "stock_confidence", "priority" FROM `suppliers`;--> statement-breakpoint
DROP TABLE `suppliers`;--> statement-breakpoint
ALTER TABLE `__new_suppliers` RENAME TO `suppliers`;