import { describe, expect, it, vi } from 'vitest';
import { RealEbayOrderSource } from './real.js';
import type { OAuthTokenSet } from '../orderSource/iface.js';
import type { EbayEnv } from './iface.js';

const ENV: EbayEnv = { EBAY_CLIENT_ID: 'client-1', EBAY_CLIENT_SECRET: 'secret-1' };
const FRESH_TOKENS: OAuthTokenSet = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 };

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml' } });
}

function getMyeBaySellingXml(itemsXml: string, totalPages = 1): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>${itemsXml}</ItemArray>
    <PaginationResult><TotalNumberOfPages>${totalPages}</TotalNumberOfPages></PaginationResult>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

describe('RealEbayOrderSource.listListings — Trading API (classic listings)', () => {
  it('parses a classic listing with no SKU, falling back to ItemID', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return xmlResponse(
          getMyeBaySellingXml(`
            <Item>
              <ItemID>110445678901</ItemID>
              <Title>Vintage Widget</Title>
              <Quantity>10</Quantity>
              <SellingStatus><CurrentPrice currencyID="USD">19.99</CurrentPrice><QuantitySold>3</QuantitySold></SellingStatus>
            </Item>`),
        );
      }),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    const listings = await source.listListings();

    expect(listings).toEqual([
      { externalListingId: '110445678901', sku: '110445678901', title: 'Vintage Widget', priceCents: 1999, quantityAvailable: 7 },
    ]);
    expect(capturedHeaders?.['X-EBAY-API-CALL-NAME']).toBe('GetMyeBaySelling');
    expect(capturedHeaders?.['X-EBAY-API-IAF-TOKEN']).toBe('access-1');

    vi.unstubAllGlobals();
  });

  it('uses the real SKU when a listing has one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        xmlResponse(
          getMyeBaySellingXml(`
            <Item>
              <ItemID>110000000001</ItemID>
              <SKU>WIDGET-RED-L</SKU>
              <Title>Widget (Red, Large)</Title>
              <Quantity>5</Quantity>
              <SellingStatus><CurrentPrice currencyID="USD">9.50</CurrentPrice><QuantitySold>0</QuantitySold></SellingStatus>
            </Item>`),
        ),
      ),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    const [listing] = await source.listListings();

    expect(listing?.sku).toBe('WIDGET-RED-L');
    expect(listing?.priceCents).toBe(950);
    expect(listing?.quantityAvailable).toBe(5);

    vi.unstubAllGlobals();
  });

  it('handles a single-item response (fast-xml-parser returns an object, not an array, for exactly one Item)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        xmlResponse(
          getMyeBaySellingXml(`
            <Item><ItemID>1</ItemID><Title>Only Item</Title><Quantity>1</Quantity><SellingStatus><CurrentPrice currencyID="USD">5.00</CurrentPrice></SellingStatus></Item>`),
        ),
      ),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    const listings = await source.listListings();
    expect(listings).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('pages through multiple pages until TotalNumberOfPages is exhausted', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        const itemId = `11000000000${call}`;
        return xmlResponse(
          getMyeBaySellingXml(
            `<Item><ItemID>${itemId}</ItemID><Title>Item ${call}</Title><Quantity>1</Quantity><SellingStatus><CurrentPrice currencyID="USD">1.00</CurrentPrice></SellingStatus></Item>`,
            2,
          ),
        );
      }),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    const listings = await source.listListings();

    expect(listings).toHaveLength(2);
    expect(call).toBe(2);

    vi.unstubAllGlobals();
  });

  it('surfaces an Ack=Failure response as a real error instead of silently returning nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><ShortMessage>Auth token is invalid</ShortMessage></Errors>
</GetMyeBaySellingResponse>`),
      ),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    await expect(source.listListings()).rejects.toThrow(/Auth token is invalid/);

    vi.unstubAllGlobals();
  });
});

describe('RealEbayOrderSource.updateListing / pauseListing — Trading API', () => {
  it('sends only the fields being updated in a single ReviseFixedPriceItem call', async () => {
    let capturedBody: string | undefined;
    let capturedCallName: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedCallName = (init?.headers as Record<string, string>)['X-EBAY-API-CALL-NAME'];
        capturedBody = init?.body as string;
        return xmlResponse(`<?xml version="1.0"?><ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseFixedPriceItemResponse>`);
      }),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    await source.updateListing('110445678901', { priceCents: 2499, title: "Buyer's Choice & Co." });

    expect(capturedCallName).toBe('ReviseFixedPriceItem');
    expect(capturedBody).toContain('<ItemID>110445678901</ItemID>');
    expect(capturedBody).toContain('<StartPrice currencyID="USD">24.99</StartPrice>');
    expect(capturedBody).toContain('&amp;'); // title's "&" is XML-escaped
    expect(capturedBody).not.toContain('<Quantity>'); // quantity wasn't part of this update

    vi.unstubAllGlobals();
  });

  it('pauseListing revises quantity to 0', async () => {
    let capturedBody: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return xmlResponse(`<?xml version="1.0"?><ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseFixedPriceItemResponse>`);
      }),
    );

    const source = new RealEbayOrderSource(ENV, FRESH_TOKENS, async () => undefined, true);
    await source.pauseListing('110445678901');

    expect(capturedBody).toContain('<Quantity>0</Quantity>');

    vi.unstubAllGlobals();
  });
});
