import type { CreateCheckoutInput, LemonSqueezyClient, LemonSqueezyEnv } from './iface.js';

const API_BASE = 'https://api.lemonsqueezy.com/v1';

export class RealLemonSqueezyClient implements LemonSqueezyClient {
  constructor(private readonly env: LemonSqueezyEnv) {}

  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string }> {
    const { LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID } = this.env;
    if (!LEMONSQUEEZY_API_KEY || !LEMONSQUEEZY_STORE_ID) {
      throw new Error('Lemon Squeezy is not configured (missing API key or store id)');
    }

    // JSON:API body per LS docs. `checkout_data.custom` is echoed back in the
    // webhook's meta.custom_data — our source of truth for what to grant.
    const body = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: input.email,
            custom: input.custom,
          },
          product_options: input.redirectUrl ? { redirect_url: input.redirectUrl } : undefined,
        },
        relationships: {
          store: { data: { type: 'stores', id: String(LEMONSQUEEZY_STORE_ID) } },
          variant: { data: { type: 'variants', id: String(input.variantId) } },
        },
      },
    };

    const res = await fetch(`${API_BASE}/checkouts`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Lemon Squeezy checkout failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { data?: { attributes?: { url?: string } } };
    const url = json.data?.attributes?.url;
    if (!url) throw new Error('Lemon Squeezy returned no checkout URL');
    return { url };
  }
}
