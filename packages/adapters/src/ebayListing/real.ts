import { XMLParser } from 'fast-xml-parser';
import { TokenBucket, fetchWithBackoff } from '../rateLimit.js';
import type { CategorySuggestion, CreateListingInput, CreateListingResult, EbayListingClient, EbayListingEnv } from './iface.js';

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
   * TODO(HUMAN): the AddFixedPriceItem XML below follows eBay's published
   * Trading API docs but hasn't been exercised against a live account (it
   * creates a real, publicly-visible, fee-incurring listing — not something to
   * fire blindly during an unattended build). Verify against eBay's sandbox
   * first. Known assumptions to confirm: managed-payments accounts omit
   * `<PaymentMethods>` entirely (set here — most accounts are managed payments
   * now); `ShippingService` USPSGround is a valid flat service code;
   * `ListingDuration` GTC is allowed for fixed-price.
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
      `<ShippingService>USPSGround</ShippingService><ShippingServiceCost currencyID="USD">${shipCost}</ShippingServiceCost>`,
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
