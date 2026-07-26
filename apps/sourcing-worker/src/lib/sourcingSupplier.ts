import { supplierConnections, type Database } from '@sourcing/db';
import { and, eq } from 'drizzle-orm';
import { createCjClient } from '@fulfillment-tracker/adapters/supplierApi';
import { createApifyAliexpressClient } from '@fulfillment-tracker/adapters/apifyAliexpress';
import type { Env } from '../env.js';
import { decryptCredential } from './credentialCrypto.js';

export type SourcingProvider = 'cj' | 'aliexpress';

export interface SourcedProduct {
  productId: string;
  title: string;
  costCents: number;
  imageUrl?: string;
  productUrl?: string;
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
    const client = createApifyAliexpressClient(env);
    const products = await client.searchProducts(keyword);
    return products
      .filter((p) => p.priceCents > 0)
      .slice(0, 5)
      .map((p) => ({ productId: p.productId, title: p.title, costCents: p.priceCents, imageUrl: p.imageUrl, productUrl: p.productUrl }));
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
      productUrl: product.productUrl,
    });
  }
  return results;
}
