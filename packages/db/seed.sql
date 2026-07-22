PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

INSERT INTO users (id, clerk_user_id, email, created_at)
VALUES
  ('01KXJG27M0G69QW7FVK8G5NVEK', 'dev-user', 'demo@fulfillment-tracker.dev', 1784106000000);

INSERT INTO storefronts (id, user_id, platform, shop_domain, access_token_ref, webhook_secret_ref, created_at, marketplace_id, oauth_refresh_token_ref, oauth_access_token_ref, oauth_expires_at, last_polled_at, non_api_mode)
VALUES
  ('01KXJG28K8T50GS5181J1TF0KN', '01KXJG27M0G69QW7FVK8G5NVEK', 'shopify', 'demo-store.myshopify.com', 'env:SHOPIFY_ACCESS_TOKEN', 'env:SHOPIFY_WEBHOOK_SECRET', 1784106000000, NULL, NULL, NULL, NULL, NULL, 0),
  ('01KXJG2BH0JDXJZ3TG5P8XQ2WK', '01KXJG27M0G69QW7FVK8G5NVEK', 'ebay', 'demo-ebay-store', 'env:EBAY_ACCESS_TOKEN', 'env:EBAY_WEBHOOK_SECRET', 1784106000000, 'EBAY_US', 'env:EBAY_OAUTH_REFRESH_TOKEN', 'env:EBAY_OAUTH_ACCESS_TOKEN', 1784113200000, 1784105100000, 1),
  ('01KXJG2CG8AP39HDWZPTE9QAKA', '01KXJG27M0G69QW7FVK8G5NVEK', 'amazon', 'demo-amazon-store', 'env:AMAZON_ACCESS_TOKEN', 'env:AMAZON_WEBHOOK_SECRET', 1784106000000, 'ATVPDKIKX0DER', 'env:AMAZON_OAUTH_REFRESH_TOKEN', 'env:AMAZON_OAUTH_ACCESS_TOKEN', 1784111400000, 1784104200000, 0);

INSERT INTO suppliers (id, user_id, name, api_base_url, api_key_ref, email_sender_pattern, parser_id, active, created_at, kind, provider, on_time_rate, avg_ship_days, stock_confidence, priority)
VALUES
  ('01KXJG29JG6GVQ96M7KH11EASF', '01KXJG27M0G69QW7FVK8G5NVEK', 'Acme Supply Co', 'https://api.acmesupply.example.com', 'env:SUPPLIER_API_KEY', '@acmesupply.example.com', 'acme-supply-v1', 1, 1784106000000, 'api', 'generic_rest', 0.97, 2.1, 0.95, 10),
  ('01KXJG2AHRFB034YDY2XPNN299', '01KXJG27M0G69QW7FVK8G5NVEK', 'Globex Goods', 'https://api.globexgoods.example.com', 'env:SUPPLIER_API_KEY', '@shipping.globexgoods.example.com', 'globex-goods-v1', 1, 1784106000000, 'api', 'generic_rest', 0.91, 3.4, 0.88, 5),
  ('01KXJG2DFG6AM5D7PP5Z4TF2WS', '01KXJG27M0G69QW7FVK8G5NVEK', 'Amazon Business', 'https://sellingpartnerapi-na.amazon.com', 'env:AMAZON_BUSINESS_API_KEY', '@amazon.com', 'amazon-business-v1', 1, 1784106000000, 'api', 'amazon_business', 0.98, 1.8, 0.97, 20),
  ('01KXJG2EERFK6XWMQ0BV4CSAWM', '01KXJG27M0G69QW7FVK8G5NVEK', 'AliExpress Open Platform', 'https://api.aliexpress.com', 'env:ALIEXPRESS_API_KEY', '@aliexpress.com', 'aliexpress-v1', 1, 1784106000000, 'api', 'aliexpress', 0.82, 12.5, 0.7, 3),
  ('01KXJG2FE09H55ZJZ70A89PP15', '01KXJG27M0G69QW7FVK8G5NVEK', 'CJ Dropshipping', 'https://developers.cjdropshipping.com', 'env:CJ_API_KEY', '@cjdropshipping.com', 'cj-dropshipping-v1', 1, 1784106000000, 'api', 'cj', 0.89, 7.2, 0.8, 8),
  ('01KXJG2GD8A9A7JHKFAWACNDDC', '01KXJG27M0G69QW7FVK8G5NVEK', 'Amazon Retail (Manual)', 'https://www.amazon.com', 'PLACEHOLDER__NO_API_KEY_MANUAL_SUPPLIER', '@amazon.com', 'amazon-retail-manual-v1', 1, 1784106000000, 'manual', 'amazon_retail', 0.93, 2.5, 0.6, 1);

INSERT INTO settings (user_id, min_margin_cents, margin_mode, min_margin_percent, auto_fulfill)
VALUES
  ('01KXJG27M0G69QW7FVK8G5NVEK', 200, 'absolute', 10, 1);

INSERT INTO webhook_events (id, source, dedup_key, raw_body, headers_json, processed, error, received_at)
VALUES
  ('01KXJG2JBRTVFZHC6SK4EWTGV4', 'shopify', 'wh-shopify-1', '{"id":5000000001,"name":"#1001"}', '{"x-shopify-webhook-id":"wh-shopify-1"}', 1, NULL, 1784070000000),
  ('01KXJG2Q80SHSNRY3JP7B1T3GD', 'shopify', 'wh-shopify-2', '{"id":5000000002,"name":"#1002"}', '{"x-shopify-webhook-id":"wh-shopify-2"}', 1, NULL, 1784019600000),
  ('01KXJG2W48TC3351GPKEDNWF2F', 'shopify', 'wh-shopify-3', '{"id":5000000003,"name":"#1003"}', '{"x-shopify-webhook-id":"wh-shopify-3"}', 1, NULL, 1784088000000),
  ('01KXJG31ZRBTZ5NFKGF6Z42V6G', 'shopify', 'wh-shopify-4', '{"id":5000000004,"name":"#1004"}', '{"x-shopify-webhook-id":"wh-shopify-4"}', 1, NULL, 1784102400000),
  ('01KXJG35WRZZNVKHNFG1X0FTYK', 'shopify', 'wh-shopify-5', '{"id":5000000005,"name":"#1005"}', '{"x-shopify-webhook-id":"wh-shopify-5"}', 1, NULL, 1783933200000),
  ('01KXJG3AS06BTC0MQ1G10X310R', 'shopify', 'wh-shopify-6', '{"id":5000000006,"name":"#1006"}', '{"x-shopify-webhook-id":"wh-shopify-6"}', 1, NULL, 1784098800000),
  ('01KXJG4738BVPXVFYQQK94ES78', 'email', '<msg-malformed-0007@mail.unknown-supplier.example.com>', 'From: noreply@unknown-supplier.example.com
Subject: Re: your package

Thanks for your order!', '{"from":"noreply@unknown-supplier.example.com"}', 1, 'No supplier matched sender address; Gemini fallback confidence 0.31 (< 0.8 threshold)', 1784094000000);

INSERT INTO orders (id, storefront_id, external_order_id, external_order_number, status, currency, subtotal_cents, shipping_cents, margin_cents, raw_payload_id, created_at, updated_at)
VALUES
  ('01KXJG2HCGESXPCF6J1A3AP57N', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000001', '#1001', 'shipped', 'USD', 8900, 599, 2101, '01KXJG2JBRTVFZHC6SK4EWTGV4', 1784070000000, 1784073600000),
  ('01KXJG2P8RV2Y404DMHG8G49AD', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000002', '#1002', 'delivered', 'USD', 12000, 0, 4300, '01KXJG2Q80SHSNRY3JP7B1T3GD', 1784019600000, 1784100000000),
  ('01KXJG2V50HWV5PQRM8FY94PVK', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000003', '#1003', 'partially_shipped', 'USD', 15600, 800, 3900, '01KXJG2W48TC3351GPKEDNWF2F', 1784088000000, 1784091000000),
  ('01KXJG310GM5EV8RPA19JY1QGX', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000004', '#1004', 'fulfilling', 'USD', 6700, 500, 2100, '01KXJG31ZRBTZ5NFKGF6Z42V6G', 1784102400000, 1784104200000),
  ('01KXJG34XGP3REEFJ1EWK8XQB5', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000005', '#1005', 'exception', 'USD', 9900, 650, 3050, '01KXJG35WRZZNVKHNFG1X0FTYK', 1783933200000, 1784016000000),
  ('01KXJG39SRWMHJPN5Z5JCTKDSM', '01KXJG28K8T50GS5181J1TF0KN', 'gid://shopify/Order/5000000006', '#1006', 'rejected', 'USD', 3200, 400, -150, '01KXJG3AS06BTC0MQ1G10X310R', 1784098800000, 1784099100000),
  ('01KXJG3CQGA47XGXAPWZNAKDYX', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', 'ebay-16-11635-28233', '16-11635-28233', 'shipped', 'USD', 5999, 0, 2799, NULL, 1784052000000, 1784056800000),
  ('01KXJG3JK0EHPCX72WWGNGZKGH', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', 'ebay-19-04471-90215', '19-04471-90215', 'fulfilling', 'USD', 4250, 0, 1400, NULL, 1784103300000, 1784103600000),
  ('01KXJG3PG0SP637RY0CFC1C0DE', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', 'ebay-11-88203-44120', '11-88203-44120', 'delivered', 'USD', 3499, 0, 1050, NULL, 1783846800000, 1783986000000);

INSERT INTO order_line_items (id, order_id, external_line_item_id, fulfillment_order_line_item_id, sku, title, quantity, quantity_fulfilled, unit_price_cents)
VALUES
  ('01KXJG2KB0WEBKVTMTZRNG521Q', '01KXJG2HCGESXPCF6J1A3AP57N', 'gid://shopify/LineItem/1', 'gid://shopify/FulfillmentOrderLineItem/1', 'WIDGET-RED-L', 'Widget - Red / Large', 2, 2, 4450),
  ('01KXJG2R78HT9AC0ZHNN81325G', '01KXJG2P8RV2Y404DMHG8G49AD', 'gid://shopify/LineItem/2', 'gid://shopify/FulfillmentOrderLineItem/2', 'GADGET-BLUE-M', 'Gadget - Blue / Medium', 1, 1, 12000),
  ('01KXJG2X3GF7M3BWXMV8P812NT', '01KXJG2V50HWV5PQRM8FY94PVK', 'gid://shopify/LineItem/3', 'gid://shopify/FulfillmentOrderLineItem/3', 'WIDGET-RED-L', 'Widget - Red / Large', 1, 1, 4450),
  ('01KXJG2Y2R77A113XPS3JFGQ88', '01KXJG2V50HWV5PQRM8FY94PVK', 'gid://shopify/LineItem/4', 'gid://shopify/FulfillmentOrderLineItem/4', 'GIZMO-GREEN-S', 'Gizmo - Green / Small', 2, 0, 5575),
  ('01KXJG32Z02N1G8DBV1F8FERG6', '01KXJG310GM5EV8RPA19JY1QGX', 'gid://shopify/LineItem/5', 'gid://shopify/FulfillmentOrderLineItem/5', 'GADGET-BLUE-M', 'Gadget - Blue / Medium', 1, 0, 6700),
  ('01KXJG36W0XETARNVF1Z25SYSY', '01KXJG34XGP3REEFJ1EWK8XQB5', 'gid://shopify/LineItem/6', 'gid://shopify/FulfillmentOrderLineItem/6', 'GIZMO-GREEN-S', 'Gizmo - Green / Small', 1, 0, 9900),
  ('01KXJG3BR89QP46JDJDJVJM1MQ', '01KXJG39SRWMHJPN5Z5JCTKDSM', 'gid://shopify/LineItem/7', NULL, 'WIDGET-RED-L', 'Widget - Red / Large', 1, 0, 3200),
  ('01KXJG3DPR96CG9Y7Y8ZKM0ZGZ', '01KXJG3CQGA47XGXAPWZNAKDYX', 'ebay-li-16-11635-28233-1', NULL, 'WIDGET-RED-L', 'Widget - Red / Large (eBay)', 1, 1, 5999),
  ('01KXJG3KJ8D7ZDJQGFJ7WVMABA', '01KXJG3JK0EHPCX72WWGNGZKGH', 'ebay-li-19-04471-90215-1', NULL, 'GIZMO-GREEN-S', 'Gizmo - Green / Small', 1, 0, 4250),
  ('01KXJG3QF8Y047XXT06TGP7WVZ', '01KXJG3PG0SP637RY0CFC1C0DE', 'ebay-li-11-88203-44120-1', NULL, 'GADGET-BLUE-M', 'Gadget - Blue / Medium', 1, 1, 3499);

INSERT INTO fulfillments (id, order_id, supplier_id, cost_cents, tracking_number, carrier_declared, carrier_detected, carrier_final, tracking_status, pushed_to_storefront, source, created_at, updated_at)
VALUES
  ('01KXJG2MA8PEWYQM20B4VAMYBN', '01KXJG2HCGESXPCF6J1A3AP57N', '01KXJG29JG6GVQ96M7KH11EASF', 5200, '1Z999AA10123456780', 'UPS', 'UPS', 'UPS', 'in_transit', 1, 'regex', 1784071200000, 1784073600000),
  ('01KXJG2S6GHNHRF9SJNXVG8YY6', '01KXJG2P8RV2Y404DMHG8G49AD', '01KXJG2AHRFB034YDY2XPNN299', 7700, '70123456789012345674', 'USPS', 'USPS', 'USPS', 'delivered', 1, 'regex', 1784022000000, 1784100000000),
  ('01KXJG2Z20DR24GS6CSQ1MATJZ', '01KXJG2V50HWV5PQRM8FY94PVK', '01KXJG29JG6GVQ96M7KH11EASF', 3100, '1Z1A2B3C4D5E6F7G82', 'UPS', 'UPS', 'UPS', 'in_transit', 1, 'regex', 1784089200000, 1784091000000),
  ('01KXJG33Y8P0P0JEFGFHJ1SNRW', '01KXJG310GM5EV8RPA19JY1QGX', '01KXJG2AHRFB034YDY2XPNN299', 4100, NULL, NULL, NULL, NULL, 'pending', 0, 'supplier_api', 1784104200000, 1784104200000),
  ('01KXJG37V80QSDZMBK741QB48M', '01KXJG34XGP3REEFJ1EWK8XQB5', '01KXJG2AHRFB034YDY2XPNN299', 6200, '9200111899223197428499', NULL, 'USPS', NULL, 'needs_review', 0, 'gemini', 1784010000000, 1784016000000),
  ('01KXJG3EP0MEVJWHNWJ5EBGAMY', '01KXJG3CQGA47XGXAPWZNAKDYX', '01KXJG2DFG6AM5D7PP5Z4TF2WS', 3200, 'TBA123456789012', 'AMZL', 'AMZL', 'AMZL', 'in_transit', 1, 'supplier_api', 1784053200000, 1784056800000),
  ('01KXJG3MHGJ9QBEQZCEGRA3141', '01KXJG3JK0EHPCX72WWGNGZKGH', '01KXJG2GD8A9A7JHKFAWACNDDC', NULL, NULL, NULL, NULL, NULL, 'pending', 0, 'manual', 1784103600000, 1784103600000),
  ('01KXJG3REGHZW82BG7V0SPM2MN', '01KXJG3PG0SP637RY0CFC1C0DE', '01KXJG2FE09H55ZJZ70A89PP15', 2000, '70123456789012345674', 'USPS', 'USPS', 'USPS', 'delivered', 1, 'supplier_api', 1783854000000, 1783986000000);

INSERT INTO fulfillment_line_items (id, fulfillment_id, order_line_item_id, quantity)
VALUES
  ('01KXJG2N9GEFEGN6SSPJE91484', '01KXJG2MA8PEWYQM20B4VAMYBN', '01KXJG2KB0WEBKVTMTZRNG521Q', 2),
  ('01KXJG2T5RTHADWAWCVNM9RZYH', '01KXJG2S6GHNHRF9SJNXVG8YY6', '01KXJG2R78HT9AC0ZHNN81325G', 1),
  ('01KXJG30186HKN47R6NH45YFSV', '01KXJG2Z20DR24GS6CSQ1MATJZ', '01KXJG2X3GF7M3BWXMV8P812NT', 1),
  ('01KXJG3FN8E18M40ACP05DMNJE', '01KXJG3EP0MEVJWHNWJ5EBGAMY', '01KXJG3DPR96CG9Y7Y8ZKM0ZGZ', 1),
  ('01KXJG3SDRKHM29B4RYYAX1S16', '01KXJG3REGHZW82BG7V0SPM2MN', '01KXJG3QF8Y047XXT06TGP7WVZ', 1);

INSERT INTO disputes (id, fulfillment_id, reason, draft_subject, draft_body, status, created_at, updated_at)
VALUES
  ('01KXJG38TG2K5ZGEAMTCEWJ8WN', '01KXJG37V80QSDZMBK741QB48M', 'No tracking status update from carrier for 7 days after label creation.', 'Tracking inquiry for shipment 9200111899223197428499', 'Hello,

We have not received a scan update for shipment 9200111899223197428499 since it was created 7 days ago. Could you confirm the current status or issue a replacement/refund if the package is lost?

Thank you,
Fulfillment Tracker', 'draft', 1784016000000, 1784016000000);

INSERT INTO listings (id, storefront_id, external_listing_id, sku, title, price_cents, quantity_available, supplier_id, supplier_product_id, match_confidence, match_source, auto_reprice, auto_pause, status, created_at, updated_at)
VALUES
  ('01KXJG3YA0KBFNQVS9JMAEHQ2S', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', 'ebay-listing-widget-red-l', 'WIDGET-RED-L', 'Widget - Red / Large', 5999, 42, '01KXJG2DFG6AM5D7PP5Z4TF2WS', 'B0EXAMPLE001', 1, 'exact_sku', 1, 1, 'active', 1783986000000, 1784104200000),
  ('01KXJG3Z98GKWVZHSM6BN9DD9Z', '01KXJG2CG8AP39HDWZPTE9QAKA', 'amz-listing-gadget-blue-m', 'GADGET-BLUE-M', 'Gadget Blue Medium Size — Fast Shipping', 8999, 0, '01KXJG2EERFK6XWMQ0BV4CSAWM', 'AE10000123', 0.93, 'fuzzy_title', 1, 1, 'paused_out_of_stock', 1783986000000, 1784102400000),
  ('01KXJG408GVPFZC575Q40K18VC', '01KXJG2BH0JDXJZ3TG5P8XQ2WK', 'ebay-listing-gizmo-green-s', 'GIZMO-GREEN-S', 'Gizmo (Green, Small) - Fast Ship', 7499, 15, NULL, NULL, NULL, NULL, 0, 1, 'active', 1783986000000, 1783986000000);

INSERT INTO supplier_offers (id, listing_id, supplier_id, supplier_product_id, cost_cents, shipping_cents, in_stock, ship_days, score, checked_at)
VALUES
  ('01KXJG417RSW8MK8FWRQ18BT8S', '01KXJG3YA0KBFNQVS9JMAEHQ2S', '01KXJG2DFG6AM5D7PP5Z4TF2WS', 'B0EXAMPLE001', 3200, 0, 1, 1.5, 0.94, 1784104200000),
  ('01KXJG4270JCT37TPW2TYDXGMM', '01KXJG3YA0KBFNQVS9JMAEHQ2S', '01KXJG29JG6GVQ96M7KH11EASF', 'ACME-WIDGET-RED-L', 3400, 350, 1, 2.5, 0.81, 1784104200000);

INSERT INTO manual_tasks (id, order_id, supplier_id, state, payload_json, created_at, updated_at)
VALUES
  ('01KXJG3NGRZ7T6WK2JR1Y3CV38', '01KXJG3JK0EHPCX72WWGNGZKGH', '01KXJG2GD8A9A7JHKFAWACNDDC', 'pending', '{"sku":"GIZMO-GREEN-S","quantity":1,"maxCostCents":3500,"shipTo":{"name":"Jordan Buyer","address1":"742 Evergreen Terrace","city":"Springfield","state":"IL","zip":"62704","country":"US"}}', 1784103600000, 1784103600000);

INSERT INTO tracking_events (id, fulfillment_id, original_tracking, proxy_tracking, proxy_carrier, status, raw_status, created_at)
VALUES
  ('01KXJG3GMGVWB62TEKBAK86P4P', '01KXJG3EP0MEVJWHNWJ5EBGAMY', 'TBA123456789012', 'BCE7F3A9D2E1', 'bluecare_express', 'in_transit', 'In Transit', 1784056800000),
  ('01KXJG3TD0KK76Y3D7SDKNW2JN', '01KXJG3REGHZW82BG7V0SPM2MN', '70123456789012345674', NULL, NULL, 'in_transit', 'InTransit', 1783926000000),
  ('01KXJG3VC8E4RFVWMMK2QDBCDH', '01KXJG3REGHZW82BG7V0SPM2MN', '70123456789012345674', NULL, NULL, 'delivered', 'Delivered', 1783986000000);

INSERT INTO message_templates (id, user_id, trigger, body_template, active, created_at)
VALUES
  ('01KXJG4368Z99W26HJYY91HBDV', '01KXJG27M0G69QW7FVK8G5NVEK', 'sold', 'Thanks for your order! We''re getting {{sku}} ready to ship.', 1, 1784106000000),
  ('01KXJG445GFBJEJ5RCMZW7697N', '01KXJG27M0G69QW7FVK8G5NVEK', 'shipped', 'Good news — your order is on the way! Tracking: {{trackingNumber}} ({{carrier}}).', 1, 1784106000000),
  ('01KXJG454R08RG3V5A4KSN6NFF', '01KXJG27M0G69QW7FVK8G5NVEK', 'delivered', 'Your order has been delivered. We hope you love it!', 1, 1784106000000),
  ('01KXJG46402GST05ZTGHK7FS2F', '01KXJG27M0G69QW7FVK8G5NVEK', 'feedback_reminder', 'If you have a moment, we''d really appreciate your feedback on your recent purchase.', 1, 1784106000000);

INSERT INTO messages (id, order_id, trigger, template_id, body, status, sent_at, created_at)
VALUES
  ('01KXJG3HKR3V15JW5CCYRKN5EY', '01KXJG3CQGA47XGXAPWZNAKDYX', 'shipped', NULL, 'Good news — your order is on the way! Tracking: BCE7F3A9D2E1 (Bluecare Express).', 'sent', 1784056860000, 1784056800000),
  ('01KXJG3WBGQBSF8VF3WXDXZ6CM', '01KXJG3PG0SP637RY0CFC1C0DE', 'delivered', NULL, 'Your order has been delivered. We hope you love it!', 'sent', 1783986060000, 1783986000000),
  ('01KXJG3XAR184P068B89EQY1YB', '01KXJG3PG0SP637RY0CFC1C0DE', 'feedback_reminder', NULL, 'If you have a moment, we''d really appreciate your feedback on your recent purchase.', 'pending', NULL, 1783992000000);

COMMIT;
