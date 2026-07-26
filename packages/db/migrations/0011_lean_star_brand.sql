ALTER TABLE `product_opportunities` ADD `ai_verdict` text;--> statement-breakpoint
ALTER TABLE `product_opportunities` ADD `ai_sell_price_min_cents` integer;--> statement-breakpoint
ALTER TABLE `product_opportunities` ADD `ai_sell_price_max_cents` integer;--> statement-breakpoint
ALTER TABLE `product_opportunities` ADD `ai_target_source_price_cents` integer;--> statement-breakpoint
ALTER TABLE `product_opportunities` ADD `ai_margin_estimate_cents` integer;--> statement-breakpoint
ALTER TABLE `product_opportunities` ADD `ai_risk` text;--> statement-breakpoint
ALTER TABLE `product_opportunities` ADD `ai_recommended_keywords_json` text;