import { describe, expect, it } from 'vitest';
import { mapAddressToFields, type SelectorMap } from './addressMapping.js';

const TEST_SELECTORS: SelectorMap = {
  name: '#name',
  phone: '#phone',
  address1: '#address1',
  address2: '#address2',
  city: '#city',
  state: '#state',
  zip: '#zip',
  country: '#country',
};

describe('mapAddressToFields', () => {
  it('maps every required address field to its selector', () => {
    const fields = mapAddressToFields(
      { name: 'Jordan Buyer', address1: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', zip: '62704', country: 'US' },
      TEST_SELECTORS,
    );
    expect(fields).toEqual([
      { selector: '#name', value: 'Jordan Buyer' },
      { selector: '#address1', value: '742 Evergreen Terrace' },
      { selector: '#city', value: 'Springfield' },
      { selector: '#state', value: 'IL' },
      { selector: '#zip', value: '62704' },
      { selector: '#country', value: 'US' },
    ]);
  });

  it('includes address2 only when present', () => {
    const withAddress2 = mapAddressToFields(
      { name: 'A', address1: 'B', address2: 'Suite 4', city: 'C', state: 'D', zip: 'E', country: 'US' },
      TEST_SELECTORS,
    );
    expect(withAddress2.some((f) => f.selector === '#address2')).toBe(true);

    const withoutAddress2 = mapAddressToFields({ name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' }, TEST_SELECTORS);
    expect(withoutAddress2.some((f) => f.selector === '#address2')).toBe(false);
  });

  it('includes phone only when present', () => {
    const withPhone = mapAddressToFields(
      { name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US', phone: '+15551234567' },
      TEST_SELECTORS,
    );
    expect(withPhone).toContainEqual({ selector: '#phone', value: '+15551234567' });

    const withoutPhone = mapAddressToFields({ name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' }, TEST_SELECTORS);
    expect(withoutPhone.some((f) => f.selector === '#phone')).toBe(false);
  });

  it('falls back to the default Amazon selector map when none is given, using the confirmed-live DE field names', () => {
    const fields = mapAddressToFields({ name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' });
    expect(fields[0]?.selector).toContain('address-ui-widgets-enterAddressFullName');
    // address1 (the visible "Street address" field) maps to the DOM's Line2,
    // not Line1 — confirmed against a live amazon.de checkout page, the
    // opposite of what the field name alone would suggest.
    const address1Field = fields.find((f) => f.value === 'B');
    expect(address1Field?.selector).toContain('enterAddressLine2');
  });
});
