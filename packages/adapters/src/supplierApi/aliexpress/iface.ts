export interface AliExpressEnv {
  MOCK_MODE?: string;
  ALIEXPRESS_APP_KEY?: string;
  ALIEXPRESS_APP_SECRET?: string;
  ALIEXPRESS_GATEWAY_URL?: string;
}

/**
 * AliExpress's `session` token pair — kept as a small local type (not
 * imported from `orderSource/iface.ts`'s `OAuthTokenSet`) to keep
 * `supplierApi` decoupled from `orderSource`, the same separation already
 * deliberately kept between `SupplierApiClient` and `OrderSource` (see
 * DECISIONS.md milestone 2/4). Shape is identical by convention, not by
 * shared dependency.
 */
export interface AliExpressTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix ms. AliExpress's own access tokens are unusually short-lived (~1 day per the console) — see DECISIONS.md. */
  expiresAt: number;
}

/** Called after a silent refresh so the caller can persist the new session token/expiry (see suppliers.oauth*Ref). */
export type AliExpressOnTokenRefreshed = (tokens: AliExpressTokenSet) => Promise<void>;
