PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

INSERT INTO users (id, clerk_user_id, email, created_at)
VALUES
  ('01KXJG27M0G69QW7FVK8G5NVEK', 'dev-user', 'demo@fulfillment-tracker.dev', 1784106000000);

INSERT INTO storefronts (id, user_id, platform, shop_domain, access_token_ref, webhook_secret_ref, created_at)
VALUES
  ('01KXJG28K8T50GS5181J1TF0KN', '01KXJG27M0G69QW7FVK8G5NVEK', 'shopify', 'demo-store.myshopify.com', 'env:SHOPIFY_ACCESS_TOKEN', 'env:SHOPIFY_WEBHOOK_SECRET', 1784106000000);

INSERT INTO suppliers (id, user_id, name, api_base_url, api_key_ref, email_sender_pattern, parser_id, active, created_at)
VALUES
  ('01KXJG29JG6GVQ96M7KH11EASF', '01KXJG27M0G69QW7FVK8G5NVEK', 'Acme Supply Co', 'https://api.acmesupply.example.com', 'env:SUPPLIER_API_KEY', '@acmesupply.example.com', 'acme-supply-v1', 1, 1784106000000),
  ('01KXJG2AHRFB034YDY2XPNN299', '01KXJG27M0G69QW7FVK8G5NVEK', 'Globex Goods', 'https://api.globexgoods.example.com', 'env:SUPPLIER_API_KEY', '@shipping.globexgoods.example.com', 'globex-goods-v1', 1, 1784106000000);

INSERT INTO settings (user_id, min_margin_cents, margin_mode, min_margin_percent, auto_fulfill)
VALUES
  ('01KXJG27M0G69QW7FVK8G5NVEK', 200, 'absolute', 10, 1);

INSERT INTO webhook_events (id, source, dedup_key, raw_body, headers_json, processed, error, received_at)
VALUES
  ('01KXJG2CG8AP39HDWZPTE9QAKA', 'shopify', 'wh-shopify-1', '{"id":5000000001,"name":"#1001"}', '{"x-shopify-webhook-id":"wh-shopify-1"}', 1, NULL, 1784070000000),
  ('01KXJG2HCGESXPCF6J1A3AP57N', 'shopify', 'wh-shopify-2', '{"id":5000000002,"name":"#1002"}', '{"x-shopify-webhook-id":"wh-shopify-2"}', 1, NULL, 1784019600000),
  ('01KXJG2P8RV2Y404DMHG8G49AD', 'shopify', 'wh-shopify-3', '{"id":5000000003,"name":"#1003"}', '{"x-shopify-webhook-id":"wh-shopify-3"}', 1, NULL, 1784088000000),
  ('01KXJG2W48TC3351GPKEDNWF2F', 'shopify', 'wh-shopify-4', '{"id":5000000004,"name":"#1004"}', '{"x-shopify-webhook-id":"wh-shopify-4"}', 1, NULL, 1784102400000),
  ('01KXJG30186HKN47R6NH45YFSV', 'shopify', 'wh-shopify-5', '{"id":5000000005,"name":"#1005"}', '{"x-shopify-webhook-id":"wh-shopify-5"}', 1, NULL, 1783933200000),
  ('01KXJG34XGP3REEFJ1EWK8XQB5', 'shopify', 'wh-shopify-6', '{"id":5000000006,"name":"#1006"}', '{"x-shopify-webhook-id":"wh-shopify-6"}', 1, NULL, 1784098800000),
  ('01KXJG36W0XETARNVF1Z25SYSY', 'email', '<msg-malformed-0007@mail.unknown-supplier.example.com>', 'From: noreply@unknown-supplier.example.com
Subject: Re: your package

Thanks for your order!', '{"from":"noreply@unknown-supplier.example.com"}', 1, 'No supplier matched sender address; Gemini fallback confidence 0.31 (< 0.8 threshold)', 1784094000000);

INSERT INTO orders (id, storefront_id, external_order_id, external_order_number, status, currency, subtotal_cents, shipping_cents, margin_cents, raw_payload_id, created_at, updated_at)
VALUES
  ('01KXJG2BH0JDXJZ3TG5P8XQ2WK', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000001', '#1001', 'shipped', 'USD', 8900, 599, 2101, '01KXJG2CG8AP39HDWZPTE9QAKA', 1784070000000, 1784073600000),
  ('01KXJG2GD8A9A7JHKFAWACNDDC', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000002', '#1002', 'delivered', 'USD', 12000, 0, 4300, '01KXJG2HCGESXPCF6J1A3AP57N', 1784019600000, 1784100000000),
  ('01KXJG2N9GEFEGN6SSPJE91484', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000003', '#1003', 'partially_shipped', 'USD', 15600, 800, 3900, '01KXJG2P8RV2Y404DMHG8G49AD', 1784088000000, 1784091000000),
  ('01KXJG2V50HWV5PQRM8FY94PVK', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000004', '#1004', 'fulfilling', 'USD', 6700, 500, 2100, '01KXJG2W48TC3351GPKEDNWF2F', 1784102400000, 1784104200000),
  ('01KXJG2Z20DR24GS6CSQ1MATJZ', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000005', '#1005', 'exception', 'USD', 9900, 650, 3050, '01KXJG30186HKN47R6NH45YFSV', 1783933200000, 1784016000000),
  ('01KXJG33Y8P0P0JEFGFHJ1SNRW', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000006', '#1006', 'rejected', 'USD', 3200, 400, -150, '01KXJG34XGP3REEFJ1EWK8XQB5', 1784098800000, 1784099100000);

INSERT INTO order_line_items (id, order_id, external_line_item_id, fulfillment_order_line_item_id, sku, title, quantity, quantity_fulfilled, unit_price_cents)
VALUES
  ('01KXJG2DFG6AM5D7PP5Z4TF2WS', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', 'gid://shopify/LineItem/1', 'gid://shopify/FulfillmentOrderLineItem/1', 'WIDGET-RED-L', 'Widget - Red / Large', 2, 2, 4450),
  ('01KXJG2JBRTVFZHC6SK4EWTGV4', '01KXJG2GD8A9A7JHKFAWACNDDC', 'gid://shopify/LineItem/2', 'gid://shopify/FulfillmentOrderLineItem/2', 'GADGET-BLUE-M', 'Gadget - Blue / Medium', 1, 1, 12000),
  ('01KXJG2Q80SHSNRY3JP7B1T3GD', '01KXJG2N9GEFEGN6SSPJE91484', 'gid://shopify/LineItem/3', 'gid://shopify/FulfillmentOrderLineItem/3', 'WIDGET-RED-L', 'Widget - Red / Large', 1, 1, 4450),
  ('01KXJG2R78HT9AC0ZHNN81325G', '01KXJG2N9GEFEGN6SSPJE91484', 'gid://shopify/LineItem/4', 'gid://shopify/FulfillmentOrderLineItem/4', 'GIZMO-GREEN-S', 'Gizmo - Green / Small', 2, 0, 5575),
  ('01KXJG2X3GF7M3BWXMV8P812NT', '01KXJG2V50HWV5PQRM8FY94PVK', 'gid://shopify/LineItem/5', 'gid://shopify/FulfillmentOrderLineItem/5', 'GADGET-BLUE-M', 'Gadget - Blue / Medium', 1, 0, 6700),
  ('01KXJG310GM5EV8RPA19JY1QGX', '01KXJG2Z20DR24GS6CSQ1MATJZ', 'gid://shopify/LineItem/6', 'gid://shopify/FulfillmentOrderLineItem/6', 'GIZMO-GREEN-S', 'Gizmo - Green / Small', 1, 0, 9900),
  ('01KXJG35WRZZNVKHNFG1X0FTYK', '01KXJG33Y8P0P0JEFGFHJ1SNRW', 'gid://shopify/LineItem/7', NULL, 'WIDGET-RED-L', 'Widget - Red / Large', 1, 0, 3200);

INSERT INTO fulfillments (id, order_id, supplier_id, cost_cents, tracking_number, carrier_declared, carrier_detected, carrier_final, tracking_status, pushed_to_storefront, source, created_at, updated_at)
VALUES
  ('01KXJG2EERFK6XWMQ0BV4CSAWM', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', '01KXJG29JG6GVQ96M7KH11EASF', 5200, '1Z999AA10123456780', 'UPS', 'UPS', 'UPS', 'in_transit', 1, 'regex', 1784071200000, 1784073600000),
  ('01KXJG2KB0WEBKVTMTZRNG521Q', '01KXJG2GD8A9A7JHKFAWACNDDC', '01KXJG2AHRFB034YDY2XPNN299', 7700, '70123456789012345674', 'USPS', 'USPS', 'USPS', 'delivered', 1, 'regex', 1784022000000, 1784100000000),
  ('01KXJG2S6GHNHRF9SJNXVG8YY6', '01KXJG2N9GEFEGN6SSPJE91484', '01KXJG29JG6GVQ96M7KH11EASF', 3100, '1Z1A2B3C4D5E6F7G82', 'UPS', 'UPS', 'UPS', 'in_transit', 1, 'regex', 1784089200000, 1784091000000),
  ('01KXJG2Y2R77A113XPS3JFGQ88', '01KXJG2V50HWV5PQRM8FY94PVK', '01KXJG2AHRFB034YDY2XPNN299', 4100, NULL, NULL, NULL, NULL, 'pending', 0, 'supplier_api', 1784104200000, 1784104200000),
  ('01KXJG31ZRBTZ5NFKGF6Z42V6G', '01KXJG2Z20DR24GS6CSQ1MATJZ', '01KXJG2AHRFB034YDY2XPNN299', 6200, '9200111899223197428499', NULL, 'USPS', NULL, 'needs_review', 0, 'gemini', 1784010000000, 1784016000000);

INSERT INTO fulfillment_line_items (id, fulfillment_id, order_line_item_id, quantity)
VALUES
  ('01KXJG2FE09H55ZJZ70A89PP15', '01KXJG2EERFK6XWMQ0BV4CSAWM', '01KXJG2DFG6AM5D7PP5Z4TF2WS', 2),
  ('01KXJG2MA8PEWYQM20B4VAMYBN', '01KXJG2KB0WEBKVTMTZRNG521Q', '01KXJG2JBRTVFZHC6SK4EWTGV4', 1),
  ('01KXJG2T5RTHADWAWCVNM9RZYH', '01KXJG2S6GHNHRF9SJNXVG8YY6', '01KXJG2Q80SHSNRY3JP7B1T3GD', 1);

INSERT INTO disputes (id, fulfillment_id, reason, draft_subject, draft_body, status, created_at, updated_at)
VALUES
  ('01KXJG32Z02N1G8DBV1F8FERG6', '01KXJG31ZRBTZ5NFKGF6Z42V6G', 'No tracking status update from carrier for 7 days after label creation.', 'Tracking inquiry for shipment 9200111899223197428499', 'Hello,

We have not received a scan update for shipment 9200111899223197428499 since it was created 7 days ago. Could you confirm the current status or issue a replacement/refund if the package is lost?

Thank you,
Fulfillment Tracker', 'draft', 1784016000000, 1784016000000);

COMMIT;
