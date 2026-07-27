export interface LemonSqueezyEnv {
  MOCK_MODE?: string;
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
}

export interface CreateCheckoutInput {
  /** LS variant id for the product/price being purchased. */
  variantId: string;
  /** Buyer email (prefills the LS checkout). */
  email: string;
  /** Echoed back verbatim in the webhook's `meta.custom_data` (values must be strings). */
  custom: Record<string, string>;
  /** Where LS redirects after successful payment. */
  redirectUrl?: string;
}

/**
 * Lemon Squeezy (merchant-of-record) — hosted checkout for credit packs and
 * subscriptions. We drive credit granting off the checkout's `custom` data
 * (echoed in the webhook), so we don't depend on per-variant config mapping.
 */
export interface LemonSqueezyClient {
  createCheckout(input: CreateCheckoutInput): Promise<{ url: string }>;
}
