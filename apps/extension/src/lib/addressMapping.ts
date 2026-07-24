import type { ManualTaskPayload } from './api.js';

export interface FieldMapping {
  selector: string;
  value: string;
}

export type SelectorMap = Record<'name' | 'phone' | 'address1' | 'address2' | 'city' | 'state' | 'zip' | 'country', string>;

/**
 * Selectors for Amazon's checkout "Add a new address" form — confirmed
 * against a real amazon.de checkout page (2026-07), not a guess. Two things
 * the original guess got wrong, only catchable by inspecting the real DOM:
 *
 * 1. **`address1`/`address2` are swapped from the intuitive reading.** The
 *    field visibly labeled "Street address" is `enterAddressLine2` in the
 *    DOM, and the field labeled "Building or Company Name" is
 *    `enterAddressLine1` — the opposite of what the field names alone would
 *    suggest. The live page's own hidden form-config value
 *    (`DENewAddressWizardFormConfigWithBuildingNameLabels`) confirms this
 *    swap is deliberate and Germany-specific ("WithBuildingNameLabels").
 *    TODO(HUMAN): a US (or other-country) checkout may use the
 *    non-swapped, more intuitive Line1=street/Line2=apartment ordering —
 *    verify separately before relying on this for a non-DE account.
 * 2. **Germany's form has no "State/Region" field at all** — the `state`
 *    selector below intentionally has no live counterpart on this form;
 *    `mapAddressToFields` still emits it (harmless no-op — content/
 *    checkout.ts skips any selector that doesn't resolve to an element) for
 *    countries whose forms do have one (e.g. US).
 * 3. **Phone number is a required field** the original mapping never
 *    accounted for at all — added here.
 */
export const DEFAULT_AMAZON_CHECKOUT_SELECTORS: SelectorMap = {
  name: 'input[name="address-ui-widgets-enterAddressFullName"]',
  phone: 'input[name="address-ui-widgets-enterAddressPhoneNumber"]',
  address1: 'input[name="address-ui-widgets-enterAddressLine2"]', // visually "Street address" — see docstring above
  address2: 'input[name="address-ui-widgets-enterAddressLine1"]', // visually "Building or Company Name" — see docstring above
  city: 'input[name="address-ui-widgets-enterAddressCity"]',
  state: 'input[name="address-ui-widgets-enterAddressStateOrRegion"]',
  zip: 'input[name="address-ui-widgets-enterAddressPostalCode"]',
  country: 'select[name="address-ui-widgets-countryCode"]',
};

/**
 * Pure: maps a manual_task's `shipTo` payload onto an ordered list of
 * `{selector, value}` pairs. Deliberately separated from the actual DOM
 * injection (content/checkout.ts, which calls `document.querySelector` and
 * sets `.value`) so this mapping logic is unit-testable without a real
 * browser or a live checkout page — the one part of the extension's checkout
 * integration that can be verified in this environment.
 */
export function mapAddressToFields(
  shipTo: NonNullable<ManualTaskPayload['shipTo']>,
  selectors: SelectorMap = DEFAULT_AMAZON_CHECKOUT_SELECTORS,
): FieldMapping[] {
  const fields: FieldMapping[] = [
    { selector: selectors.name, value: shipTo.name },
    { selector: selectors.address1, value: shipTo.address1 },
    { selector: selectors.city, value: shipTo.city },
    { selector: selectors.state, value: shipTo.state },
    { selector: selectors.zip, value: shipTo.zip },
    { selector: selectors.country, value: shipTo.country },
  ];
  if (shipTo.address2) {
    fields.push({ selector: selectors.address2, value: shipTo.address2 });
  }
  if (shipTo.phone) {
    fields.push({ selector: selectors.phone, value: shipTo.phone });
  }
  return fields;
}
