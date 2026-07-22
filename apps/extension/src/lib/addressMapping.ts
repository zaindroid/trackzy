import type { ManualTaskPayload } from './api.js';

export interface FieldMapping {
  selector: string;
  value: string;
}

export type SelectorMap = Record<'name' | 'address1' | 'address2' | 'city' | 'state' | 'zip' | 'country', string>;

/**
 * Best-effort default selectors for Amazon's checkout "Add a new address"
 * form. Amazon's actual field names/ids are not publicly documented and
 * change over time. TODO(HUMAN): verify and update these against the live
 * checkout DOM before relying on this in production — see DEPLOY.md.
 */
export const DEFAULT_AMAZON_CHECKOUT_SELECTORS: SelectorMap = {
  name: 'input[name="address-ui-widgets-enterAddressFullName"]',
  address1: 'input[name="address-ui-widgets-enterAddressLine1"]',
  address2: 'input[name="address-ui-widgets-enterAddressLine2"]',
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
  return fields;
}
