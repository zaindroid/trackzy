import type { CreateCheckoutInput, LemonSqueezyClient } from './iface.js';

/** Network-free mock — returns a fake hosted-checkout URL. */
export class MockLemonSqueezyClient implements LemonSqueezyClient {
  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string }> {
    const q = new URLSearchParams({ variant: input.variantId, ...input.custom }).toString();
    return { url: `https://mock.lemonsqueezy.test/checkout?${q}` };
  }
}
