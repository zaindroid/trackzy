import {
  createDb,
  listings,
  supplierOffers,
  suppliers,
  type Database,
} from '@fulfillment-tracker/db';
import { and, eq } from 'drizzle-orm';
import {
  matchByExactSkuOrFuzzyTitle,
  matchByEmbedding,
  topCandidatesForLlm,
  type MatchCandidate,
  type MatchResult,
} from '@fulfillment-tracker/core';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { SupplierApiProvider } from '@fulfillment-tracker/adapters/supplierApi';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { createSupplierApiClientForSupplier } from '../lib/supplierApiClientForSupplier.js';

const API_MATCHABLE_PROVIDERS: SupplierApiProvider[] = ['amazon_business', 'aliexpress', 'cj'];
const CANDIDATES_PER_SUPPLIER = 3;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface CandidateWithSupplier extends MatchCandidate {
  supplierId: string;
}

/**
 * SKU/listing matching cascade orchestration (spec section 8): searches
 * every active API-driven supplier for candidate products matching the
 * listing's title, then runs the cascade (exact SKU → fuzzy title ≥ 0.9 →
 * embedding similarity → Gemini constrained to the top-5 candidates) to pick
 * the best one. Persists the winning match onto the `listings` row and
 * records/refreshes a `supplier_offers` row for it so the repricing sweep
 * (repricingSweep.ts) has cost data to work from.
 */
export async function matchListing(env: Env, listingId: string): Promise<MatchResult> {
  const db = createDb(env.DB);
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  const userSuppliers = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.active, 1)));
  const matchableSuppliers = userSuppliers.filter((s) =>
    API_MATCHABLE_PROVIDERS.includes(s.provider as SupplierApiProvider),
  );

  const candidates: CandidateWithSupplier[] = [];
  for (const supplier of matchableSuppliers) {
    const client = await createSupplierApiClientForSupplier(env, db, supplier);
    const found = await client.searchProduct(listing.title);
    for (const product of found.slice(0, CANDIDATES_PER_SUPPLIER)) {
      candidates.push({ supplierProductId: product.supplierProductId, title: product.title, sku: product.sku, supplierId: supplier.id });
    }
  }

  const result = await runCascade(env, listing, candidates);
  await persistMatch(env, db, listingId, result, candidates);
  return result;
}

async function runCascade(
  env: Env,
  listing: { sku: string; title: string },
  candidates: CandidateWithSupplier[],
): Promise<MatchResult> {
  const exactOrFuzzy = matchByExactSkuOrFuzzyTitle(listing, candidates);
  if (exactOrFuzzy) return exactOrFuzzy;

  if (candidates.length === 0) {
    return { supplierProductId: null, confidence: 0, source: null };
  }

  const gemini = createGeminiExtractor(env);
  const listingEmbedding = await gemini.embedText(listing.title);
  const scored = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      similarity: cosineSimilarity(listingEmbedding, await gemini.embedText(candidate.title)),
    })),
  );

  const embeddingMatch = matchByEmbedding(scored);
  if (embeddingMatch) return embeddingMatch;

  const top5 = topCandidatesForLlm(scored);
  const llmResult = await gemini.pickBestListingMatch({
    targetTitle: listing.title,
    candidates: top5.map((c) => ({ id: c.supplierProductId, title: c.title })),
  });
  return {
    supplierProductId: llmResult.chosenId,
    confidence: llmResult.confidence,
    source: llmResult.chosenId ? 'llm' : null,
  };
}

async function persistMatch(
  env: Env,
  db: Database,
  listingId: string,
  result: MatchResult,
  candidates: CandidateWithSupplier[],
): Promise<void> {
  if (!result.supplierProductId) {
    await db
      .update(listings)
      .set({ matchConfidence: result.confidence, matchSource: null, updatedAt: now() })
      .where(eq(listings.id, listingId));
    return;
  }

  const matchedCandidate = candidates.find((c) => c.supplierProductId === result.supplierProductId);
  await db
    .update(listings)
    .set({
      supplierId: matchedCandidate?.supplierId ?? null,
      supplierProductId: result.supplierProductId,
      matchConfidence: result.confidence,
      matchSource: result.source,
      updatedAt: now(),
    })
    .where(eq(listings.id, listingId));

  if (!matchedCandidate) return;

  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, matchedCandidate.supplierId));
  if (!supplier) return;

  const client = await createSupplierApiClientForSupplier(env, db, supplier);
  const offer = await client.getOffer(result.supplierProductId);

  const [existingOffer] = await db
    .select()
    .from(supplierOffers)
    .where(and(eq(supplierOffers.listingId, listingId), eq(supplierOffers.supplierId, matchedCandidate.supplierId)));

  const offerValues = {
    costCents: offer.costCents,
    shippingCents: offer.shippingCents,
    inStock: offer.inStock ? 1 : 0,
    shipDays: offer.shipDays ?? null,
    score: result.confidence,
    checkedAt: now(),
  };

  if (existingOffer) {
    await db.update(supplierOffers).set(offerValues).where(eq(supplierOffers.id, existingOffer.id));
  } else {
    await db.insert(supplierOffers).values({
      id: newId(),
      listingId,
      supplierId: matchedCandidate.supplierId,
      supplierProductId: result.supplierProductId,
      ...offerValues,
    });
  }
}
