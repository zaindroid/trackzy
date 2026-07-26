CREATE TABLE `pending_supplier_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfillment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`cost_cents` integer NOT NULL,
	`line_items_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pending_supplier_orders_status_check" CHECK("pending_supplier_orders"."status" in ('pending', 'approved', 'rejected'))
);
