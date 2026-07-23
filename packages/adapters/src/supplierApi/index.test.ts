import { describe, expect, it } from 'vitest';
import { createSupplierApiClient } from './index.js';
import { MockAmazonBusinessClient } from './amazonBusiness/index.js';
import { MockCjClient } from './cj/index.js';

describe('createSupplierApiClient', () => {
  it('dispatches to the mock Amazon Business client', () => {
    expect(createSupplierApiClient('amazon_business', { MOCK_MODE: 'true' })).toBeInstanceOf(MockAmazonBusinessClient);
  });

  it('dispatches to the mock CJ client', () => {
    expect(createSupplierApiClient('cj', { MOCK_MODE: 'true' })).toBeInstanceOf(MockCjClient);
  });

  it('throws for aliexpress — it needs per-supplier OAuth tokens, resolved via createSupplierApiClientForSupplier instead', () => {
    expect(() => createSupplierApiClient('aliexpress', { MOCK_MODE: 'true' })).toThrow(/createSupplierApiClientForSupplier/);
  });
});
