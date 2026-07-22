import { describe, expect, it } from 'vitest';
import { mapAddressToFields, type SelectorMap } from './addressMapping.js';

const TEST_SELECTORS: SelectorMap = {
  name: '#name',
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

  it('falls back to the default Amazon selector map when none is given', () => {
    const fields = mapAddressToFields({ name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' });
    expect(fields[0]?.selector).toContain('address-ui-widgets-enterAddressFullName');
  });
});
