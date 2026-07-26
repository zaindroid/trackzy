import { supplierConnections, type Database } from '@sourcing/db';
import { and, eq } from 'drizzle-orm';
import { createCjClient } from '@fulfillment-tracker/adapters/supplierApi';
import { createAliexpressDsClient } from '@fulfillment-tracker/adapters/aliexpressDs';
import type { Env } from '../env.js';
import { decryptCredential } from './credentialCrypto.js';

export type SourcingProvider = 'cj' | 'aliexpress';

export interface SourcedProduct {
  productId: string;
  title: string;
  costCents: number;
  imageUrl?: string;
  /** Full supplier image gallery (≤12 for eBay); falls back to `[imageUrl]`. */
  imageUrls: string[];
  productUrl?: string;
  /** Supplier's own sales volume (AliExpress `orders`) — a free demand hint used to rank which niches get a paid eBay demand check. */
  orders?: number;
}

/**
 * Unifies the two supplier-search sources behind one shape for the research
 * pipeline. AliExpress goes through Apify (real keyword search, no seller
 * login — it's public data via the app-level token; see the apifyAliexpress
 * adapter) and is therefore ALWAYS available. CJ uses the seller's own
 * connected API key and returns `null` here when they haven't connected it.
 */
export async function searchSupplier(
  env: Env,
  db: Database,
  userId: string,
  provider: SourcingProvider,
  keyword: string,
): Promise<SourcedProduct[] | null> {
  if (provider === 'aliexpress') {
    // Official AliExpress Dropshipper API (free, no Apify). Uses the platform's
    // DS token for discovery; per-user connect is only needed for fulfillment.
    const client = createAliexpressDsClient(env);
    const products = await client.searchProducts(keyword, 8);
    return products
      .filter((p) => p.costCents > 0)
      .slice(0, 5)
      .map((p) => ({
        productId: p.productId,
        title: p.title || keyword,
        costCents: p.costCents,
        imageUrl: p.imageUrl,
        imageUrls: p.imageUrls.length > 0 ? p.imageUrls : p.imageUrl ? [p.imageUrl] : [],
        productUrl: p.productUrl,
        orders: p.orders,
      }));
  }

  // CJ — requires the seller's connected key.
  const [conn] = await db
    .select()
    .from(supplierConnections)
    .where(and(eq(supplierConnections.userId, userId), eq(supplierConnections.provider, 'cj')));
  if (!conn) return null;

  const apiKey = await decryptCredential(env, conn.apiKeyRef);
  const cj = createCjClient({ MOCK_MODE: env.MOCK_MODE, CJ_API_KEY: apiKey, CJ_BASE_URL: conn.apiBaseUrl });
  const found = await cj.searchProduct(keyword);
  const top = found.slice(0, 3);
  const results: SourcedProduct[] = [];
  for (const product of top) {
    const offer = await cj.getOffer(product.supplierProductId);
    results.push({
      productId: product.supplierProductId,
      title: product.title,
      costCents: offer.costCents,
      imageUrl: product.imageUrl,
      imageUrls: product.imageUrl ? [product.imageUrl] : [],
      productUrl: product.productUrl,
    });
  }
  return results;
}
