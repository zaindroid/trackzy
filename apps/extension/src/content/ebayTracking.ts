import { fetchPendingTrackingUploads, completeTrackingUpload, type PendingTrackingUpload } from '../lib/api.js';

/**
 * Non-API tracking upload (spec 5a/7): for eBay storefronts in
 * `non_api_mode`, the Fulfillment API is never called — instead this content
 * script lists fulfillments awaiting upload and lets a human click through
 * eBay's own "Add tracking" UI, avoiding any API footprint linking the
 * automation to the seller account.
 *
 * TODO(HUMAN): this only marks the upload complete in our backend once
 * clicked — it does not yet drive eBay's own tracking-entry form fields,
 * since that DOM depends on which Seller Hub shipment flow is active and
 * needs verifying against a live listing. See DEPLOY.md.
 */
async function injectTrackingUploadPanel(): Promise<void> {
  const uploads = await fetchPendingTrackingUploads().catch(() => [] as PendingTrackingUpload[]);
  if (uploads.length === 0) return;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:999999;background:white;border:1px solid #d0d0d0;border-radius:8px;padding:12px;max-width:280px;font-family:system-ui,sans-serif;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.15);';

  const heading = document.createElement('strong');
  heading.textContent = 'Fulfillment Tracker — pending tracking uploads';
  panel.appendChild(heading);

  for (const upload of uploads) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;';

    const label = document.createElement('span');
    label.textContent = `${upload.externalOrderNumber ?? upload.fulfillmentId}: ${upload.trackingNumber}`;
    row.appendChild(label);

    const button = document.createElement('button');
    button.textContent = 'Mark uploaded';
    button.style.cssText = 'padding:4px 10px;border:none;border-radius:4px;background:#0b74de;color:white;cursor:pointer;';
    button.onclick = async () => {
      button.disabled = true;
      await completeTrackingUpload(upload.fulfillmentId).catch(() => {
        button.disabled = false;
      });
      row.remove();
    };
    row.appendChild(button);

    panel.appendChild(row);
  }

  document.body.appendChild(panel);
}

void injectTrackingUploadPanel();
