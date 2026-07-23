export interface AliExpressEnv {
  MOCK_MODE?: string;
  ALIEXPRESS_APP_KEY?: string;
  ALIEXPRESS_APP_SECRET?: string;
  /** Base URL for the `/sync` JSON-RPC-style business-method gateway (aliexpress.ds.*). */
  ALIEXPRESS_GATEWAY_URL?: string;
  /** Base URL for the separate `/rest/auth/token/*` OAuth endpoints — see real.ts's docstring. */
  ALIEXPRESS_REST_BASE_URL?: string;
  // Market context params ds.* methods require — confirmed live, see real.ts.
  ALIEXPRESS_DEFAULT_COUNTRY_CODE?: string; // e.g. 'US'
  ALIEXPRESS_DEFAULT_CURRENCY?: string; // e.g. 'USD'
  ALIEXPRESS_DEFAULT_LOCALE?: string; // e.g. 'en_US' (aliexpress.ds.text.search's `local` param)
  ALIEXPRESS_DEFAULT_LANGUAGE?: string; // e.g. 'en' (aliexpress.ds.product.get's `target_language` param)
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
