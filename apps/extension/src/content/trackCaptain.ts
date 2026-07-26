import {
  fetchPendingTrackingProxyConversions,
  completeTrackingProxyConversion,
  type PendingTrackingProxyConversion,
} from '../lib/api.js';

/**
 * Manual tracking-proxy-conversion queue, surfaced on trackcaptain.com
 * itself (spec 7's tracking-proxy hard rule, extended to cover every
 * unrecognized-carrier supplier — Amazon Logistics, AliExpress, Temu — not
 * just AMZL; see packages/core/src/trackingProxy.ts). No provider in this
 * space currently offers a real API (Bluecare Express and Aquiline are both
 * blocked by eBay; TrackCaptain, Traktako, and Qtrack are all manual
 * dashboard tools — see DECISIONS.md for what was researched), so this
 * panel lists what still needs a converted number and lets a human paste
 * back whatever TrackCaptain's own UI gave them after claiming one.
 */
async function injectProxyConversionPanel(): Promise<void> {
  const conversions = await fetchPendingTrackingProxyConversions().catch(() => [] as PendingTrackingProxyConversion[]);
  if (conversions.length === 0) return;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:999999;background:white;border:1px solid #d0d0d0;border-radius:8px;padding:12px;max-width:320px;font-family:system-ui,sans-serif;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.15);max-height:80vh;overflow-y:auto;';

  const heading = document.createElement('strong');
  heading.textContent = 'Fulfillment Tracker — needs a TrackCaptain number';
  panel.appendChild(heading);

  for (const conversion of conversions) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #eee;';

    const label = document.createElement('div');
    label.textContent = `${conversion.externalOrderNumber ?? conversion.fulfillmentId}: ${conversion.originalTrackingNumber} (${conversion.originalCarrier ?? 'unrecognized carrier'})`;
    label.style.cssText = 'margin-bottom:6px;color:#333;';
    row.appendChild(label);

    const trackingInput = document.createElement('input');
    trackingInput.placeholder = 'Claimed tracking number';
    trackingInput.style.cssText = 'width:100%;box-sizing:border-box;padding:5px;margin-bottom:4px;font-size:12px;';
    row.appendChild(trackingInput);

    const carrierInput = document.createElement('input');
    carrierInput.placeholder = 'Carrier (e.g. USPS)';
    carrierInput.style.cssText = 'width:100%;box-sizing:border-box;padding:5px;margin-bottom:6px;font-size:12px;';
    row.appendChild(carrierInput);

    const button = document.createElement('button');
    button.textContent = 'Submit';
    button.style.cssText = 'width:100%;padding:6px;border:none;border-radius:4px;background:#0b74de;color:white;cursor:pointer;';
    button.onclick = async () => {
      const trackingNumber = trackingInput.value.trim();
      const carrier = carrierInput.value.trim();
      if (!trackingNumber || !carrier) return;
      button.disabled = true;
      await completeTrackingProxyConversion(conversion.fulfillmentId, trackingNumber, carrier).catch(() => {
        button.disabled = false;
      });
      row.remove();
    };
    row.appendChild(button);

    panel.appendChild(row);
  }

  document.body.appendChild(panel);
}

void injectProxyConversionPanel();
