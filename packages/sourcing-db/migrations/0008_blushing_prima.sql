CREATE TABLE `winner_score_history` (
	`id` text PRIMARY KEY NOT NULL,
	`winner_id` text NOT NULL,
	`score` real NOT NULL,
	`ebay_sold_count` integer NOT NULL,
	`margin_cents` integer NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`winner_id`) REFERENCES `winners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `winner_score_history_winner_idx` ON `winner_score_history` (`winner_id`,`captured_at`);