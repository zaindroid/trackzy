import { XMLParser } from 'fast-xml-parser';
import { TokenBucket, fetchWithBackoff } from '../rateLimit.js';
import type { CategorySuggestion, CreateListingInput, CreateListingResult, EbayListingClient, EbayListingEnv, EbayUserInfo } from './iface.js';

// Same compatibility level trackzy's ebay adapter uses — see that file's note.
const TRADING_API_COMPATIBILITY_LEVEL = 1193;

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// eBay ConditionID codes (Trading API). Only the ones this product realistically
// lists new dropship inventory under; defaults to New.
const CONDITION_IDS: Record<string, number> = { New: 1000, 'New other': 1500, 'Open box': 1500, Used: 3000 };

const RETURNS_WITHIN: Record<'no_returns' | '30_day' | '60_day', string | null> = {
  no_returns: null,
  '30_day': 'Days_30',
  '60_day': 'Days_60',
};

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

export class RealEbayListingClient implements EbayListingClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: EbayListingEnv) {}

  private baseUrl(): string {
    return this.env.EBAY_API_BASE_URL ?? 'https://api.ebay.com';
  }

  async suggestCategory(accessToken: string, title: string): Promise<CategorySuggestion | null> {
    // Taxonomy API is REST/JSON (unlike the Trading API listing call below).
    // Marketplace tree "0" = EBAY_US. TODO(HUMAN): the default category tree id
    // is marketplace-specific; if you list on a non-US eBay site, fetch the
    // right tree id via getDefaultCategoryTreeId first.
    const url = `${this.baseUrl()}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`;
    const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${accessToken}` } }, this.bucket);
    if (!res.ok) {
      throw new Error(`eBay Taxonomy getCategorySuggestions failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      categorySuggestions?: { category: { categoryId: string; categoryName: string } }[];
    };
    const first = data.categorySuggestions?.[0]?.category;
    return first ? { categoryId: first.categoryId, categoryName: first.categoryName } : null;
  }

  /**
   * VERIFIED against the eBay sandbox (2026-07-26, created ItemID 110590069907
   * on testuser_zainey4): the AddFixedPriceItem XML below works. Confirmed:
   * managed-payments accounts correctly omit `<PaymentMethods>`; `ListingDuration`
   * GTC is valid for fixed-price; external supplier `PictureURL`s are accepted;
   * category from the Taxonomy API is accepted. Two things the sandbox corrected:
   * `USPSGround` is NOT a valid service code (error 12519) — default is now
   * `USPSPriority` (overridable via `input.shippingServiceCode`); and
   * `<ShippingServiceAdditionalCost>` must be set explicitly to avoid warning
   * 219026. Note: eBay enforces a duplicate-listing policy per seller (error
   * 21919067) — identical title+details from the same seller is rejected; use a
   * multi-quantity listing for genuine restocks.
   */
  async createFixedPriceListing(input: CreateListingInput): Promise<CreateListingResult> {
    const conditionId = CONDITION_IDS[input.condition] ?? 1000;
    const price = (input.priceCents / 100).toFixed(2);
    const shipCost = (input.shippingCostCents / 100).toFixed(2);
    const returnsWithin = RETURNS_WITHIN[input.returnPolicy];

    const pictures = input.imageUrls.map((u) => `<PictureURL>${escapeXml(u)}</PictureURL>`).join('');
    const aspects = Object.entries(input.aspects)
      .map(([name, value]) => `<NameValueList><Name>${escapeXml(name)}</Name><Value>${escapeXml(value)}</Value></NameValueList>`)
      .join('');

    const returnPolicyXml =
      returnsWithin === null
        ? '<ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy>'
        : `<ReturnPolicy><ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption><ReturnsWithinOption>${returnsWithin}</ReturnsWithinOption><ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption></ReturnPolicy>`;

    const bodyXml = [
      '<Item>',
      `<SKU>${escapeXml(input.sku)}</SKU>`,
      `<Title>${escapeXml(input.title)}</Title>`,
      `<Description><![CDATA[${input.description}]]></Description>`,
      `<PrimaryCategory><CategoryID>${escapeXml(input.categoryId)}</CategoryID></PrimaryCategory>`,
      `<StartPrice currencyID="USD">${price}</StartPrice>`,
      `<Quantity>${input.quantity}</Quantity>`,
      '<ListingDuration>GTC</ListingDuration>',
      `<ConditionID>${conditionId}</ConditionID>`,
      '<Country>US</Country>',
      '<Currency>USD</Currency>',
      `<PostalCode>${escapeXml(input.itemLocationPostalCode)}</PostalCode>`,
      `<PictureDetails>${pictures}</PictureDetails>`,
      aspects ? `<ItemSpecifics>${aspects}</ItemSpecifics>` : '',
      '<ShippingDetails><ShippingType>Flat</ShippingType>',
      '<ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority>',
      `<ShippingService>${escapeXml(input.shippingServiceCode ?? 'USPSPriority')}</ShippingService><ShippingServiceCost currencyID="USD">${shipCost}</ShippingServiceCost><ShippingServiceAdditionalCost currencyID="USD">${shipCost}</ShippingServiceAdditionalCost>`,
      '</ShippingServiceOptions></ShippingDetails>',
      `<DispatchTimeMax>${input.handlingTimeDays}</DispatchTimeMax>`,
      returnPolicyXml,
      '</Item>',
    ]
      .filter(Boolean)
      .join('');

    const response = await this.tradingApiRequest<{ ItemID?: string }>(input.accessToken, 'AddFixedPriceItem', bodyXml);
    if (!response.ItemID) {
      throw new Error('eBay AddFixedPriceItem succeeded (Ack != Failure) but returned no ItemID');
    }
    return { ebayItemId: response.ItemID };
  }

  async getUserInfo(accessToken: string): Promise<EbayUserInfo> {
    // GetUser with no ItemID returns the *authenticated* user (the seller who
    // granted the token). `User.UserID` is the eBay username. Works with the
    // same IAF token / sell.inventory scope — no extra identity scope needed.
    const response = await this.tradingApiRequest<{ User?: { UserID?: string } }>(accessToken, 'GetUser', '');
    return { username: response.User?.UserID ?? null };
  }

  private async tradingApiRequest<T>(accessToken: string, callName: string, bodyXml: string): Promise<T> {
    const requestXml = `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${bodyXml}</${callName}Request>`;
    const res = await fetchWithBackoff(
      `${this.baseUrl()}/ws/api.dll`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-COMPATIBILITY-LEVEL': String(TRADING_API_COMPATIBILITY_LEVEL),
          'X-EBAY-API-CALL-NAME': callName,
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-IAF-TOKEN': accessToken,
        },
        body: requestXml,
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`eBay Trading API call ${callName} failed: ${res.status} ${await res.text()}`);
    }
    const parsed = xmlParser.parse(await res.text()) as Record<string, unknown>;
    const response = parsed[`${callName}Response`] as { Ack?: string; Errors?: unknown } | undefined;
    if (response?.Ack === 'Failure') {
      throw new Error(`eBay Trading API call ${callName} returned Ack=Failure: ${JSON.stringify(response.Errors)}`);
    }
    return response as T;
  }
}
