import type { CategorySuggestion, CreateListingInput, CreateListingResult, EbayListingClient } from './iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, network-free mock — never creates a real eBay listing. */
export class MockEbayListingClient implements EbayListingClient {
  async suggestCategory(_accessToken: string, title: string): Promise<CategorySuggestion | null> {
    return { categoryId: String(10000 + (hashString(title) % 90000)), categoryName: 'Mock Category' };
  }

  async createFixedPriceListing(input: CreateListingInput): Promise<CreateListingResult> {
    return { ebayItemId: `MOCK-${hashString(input.sku + input.title)}` };
  }
}
