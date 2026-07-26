CREATE TABLE `demand_cache` (
	`normalized_key` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`last_checked` integer NOT NULL
);
