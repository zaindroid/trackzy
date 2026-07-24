import { fetchActiveManualTask, markManualTaskOrdered } from '../lib/api.js';
import { mapAddressToFields } from '../lib/addressMapping.js';

/**
 * "PasteMe" parity (spec 6d): on an Amazon checkout-like page, fetches the
 * active manual_task and injects a floating button (bottom-right of the
 * viewport) that 1-click pastes the buyer's shipping address into the
 * page's address form on click — not automatic on page load, since the
 * "Add an address" form only exists in the DOM after a human opens it — plus
 * a "Mark ordered" button that fires the manual-order-placed transition.
 *
 * The field selectors in addressMapping.ts are confirmed against a real
 * amazon.de checkout page (2026-07) — see that file's docstring for the
 * DE-specific address1/address2 swap this uncovered. TODO(HUMAN): a US (or
 * other-country) Amazon account's form may differ; verify separately.
 */
async function injectCheckoutControls(): Promise<void> {
  const task = await fetchActiveManualTask().catch(() => null);
  if (!task?.payload.shipTo) return;

  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:999999;display:flex;flex-direction:column;gap:8px;font-family:system-ui,sans-serif;';

  const pasteButton = document.createElement('button');
  pasteButton.textContent = 'Paste shipping address (Fulfillment Tracker)';
  pasteButton.style.cssText = buttonStyle('#0b74de');
  pasteButton.onclick = () => {
    const fields = mapAddressToFields(task.payload.shipTo!);
    for (const field of fields) {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(field.selector);
      if (!el) continue;
      el.value = field.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const markOrderedButton = document.createElement('button');
  markOrderedButton.textContent = 'Mark ordered (Fulfillment Tracker)';
  markOrderedButton.style.cssText = buttonStyle('#2e7d32');
  markOrderedButton.onclick = async () => {
    markOrderedButton.disabled = true;
    await markManualTaskOrdered(task.id).catch(() => {
      markOrderedButton.disabled = false;
    });
    markOrderedButton.textContent = 'Marked ordered';
  };

  container.appendChild(pasteButton);
  container.appendChild(markOrderedButton);
  document.body.appendChild(container);
}

function buttonStyle(color: string): string {
  return `padding:10px 16px;background:${color};color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.2);`;
}

void injectCheckoutControls();
