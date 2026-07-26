import {
  createDb,
  listings,
  storefronts,
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
import type { SupplierApiProvider, SupplierOffer } from '@fulfillment-tracker/adapters/supplierApi';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { createSupplierApiClientForSupplier } from '../lib/supplierApiClientForSupplier.js';

const API_MATCHABLE_PROVIDERS: SupplierApiProvider[] = ['amazon_business', 'aliexpress', 'cj'];
const CANDIDATES_PER_SUPPLIER = 3;
// Deliberately looser than core's own EMBEDDING_THRESHOLD (0.85, the bar for
// auto-committing a match with no human involved) — a human reviews every
// candidate shown here, so a lower bar is fine. But not "any score at all":
// confirmed live that a broken supplier search (see DECISIONS.md — AliExpress's
// searchProduct returning an irrelevant "trending" feed) can otherwise surface
// completely unrelated products (a jellyfish toy for a silk eye mask listing)
// with nothing to filter them out before. This is a coarse floor against that
// specific failure mode, not a claim that anything above it is a good match.
const MIN_CANDIDATE_SCORE_FOR_REVIEW = 0.5;

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
  imageUrl?: string;
  productUrl?: string;
}

async function userMatchableSuppliers(db: Database, userId: string): Promise<(typeof suppliers.$inferSelect)[]> {
  const userSuppliers = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.active, 1), eq(suppliers.userId, userId)));
  return userSuppliers.filter((s) => API_MATCHABLE_PROVIDERS.includes(s.provider as SupplierApiProvider));
}

async function gatherCandidates(
  env: Env,
  db: Database,
  listing: { title: string },
  matchableSuppliers: (typeof suppliers.$inferSelect)[],
): Promise<CandidateWithSupplier[]> {
  const candidates: CandidateWithSupplier[] = [];
  for (const supplier of matchableSuppliers) {
    const client = await createSupplierApiClientForSupplier(env, db, supplier);
    const found = await client.searchProduct(listing.title);
    for (const product of found.slice(0, CANDIDATES_PER_SUPPLIER)) {
      candidates.push({
        supplierProductId: product.supplierProductId,
        title: product.title,
        sku: product.sku,
        supplierId: supplier.id,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
      });
    }
  }
  return candidates;
}

async function upsertSupplierOffer(
  db: Database,
  listingId: string,
  supplierId: string,
  supplierProductId: string,
  offer: SupplierOffer,
  score: number,
  productTitle?: string,
  productImageUrl?: string,
  productUrl?: string,
): Promise<void> {
  const [existingOffer] = await db
    .select()
    .from(supplierOffers)
    .where(and(eq(supplierOffers.listingId, listingId), eq(supplierOffers.supplierId, supplierId)));

  const offerValues = {
    costCents: offer.costCents,
    shippingCents: offer.shippingCents,
    inStock: offer.inStock ? 1 : 0,
    shipDays: offer.shipDays ?? null,
    score,
    checkedAt: now(),
    productTitle: productTitle ?? null,
    productImageUrl: productImageUrl ?? null,
    productUrl: productUrl ?? null,
  };

  if (existingOffer) {
    await db.update(supplierOffers).set(offerValues).where(eq(supplierOffers.id, existingOffer.id));
  } else {
    await db.insert(supplierOffers).values({ id: newId(), listingId, supplierId, supplierProductId, ...offerValues });
  }
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

  const [storefront] = await db
    .select({ userId: storefronts.userId })
    .from(storefronts)
    .where(eq(storefronts.id, listing.storefrontId));
  if (!storefront) throw new Error(`Storefront ${listing.storefrontId} not found for listing ${listingId}`);

  // Scoped to this listing's own owner — without this, a listing would be
  // matched (and its costs/orders exposed to) *any* active supplier across
  // every tenant, not just the ones the listing's own user connected.
  const matchableSuppliers = await userMatchableSuppliers(db, storefront.userId);
  const candidates = await gatherCandidates(env, db, listing, matchableSuppliers);

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
  await upsertSupplierOffer(
    db,
    listingId,
    matchedCandidate.supplierId,
    result.supplierProductId,
    offer,
    result.confidence,
    matchedCandidate.title,
    matchedCandidate.imageUrl,
    matchedCandidate.productUrl,
  );
}

export interface ScoredMatchCandidate {
  supplierId: string;
  supplierName: string;
  supplierProductId: string;
  title: string;
  sku: string;
  costCents: number;
  score: number;
  imageUrl?: string;
  productUrl?: string;
}

/**
 * Returns the top-N scored candidates for a listing without committing
 * anything — feeds the Listings page's manual "resolve" picker for a
 * listing the automatic cascade above declined to confidently match on its
 * own (see DECISIONS.md: a low-confidence auto-match risks silently
 * spending money on the wrong product, so the cascade refuses to guess,
 * but a human reviewing the same shortlist can). Reuses the exact same
 * candidate-gathering + embedding-similarity scoring as `matchListing()`,
 * just stops short of auto-deciding and fetches live pricing for display.
 */
export async function findMatchCandidates(env: Env, listingId: string, limit = 4): Promise<ScoredMatchCandidate[]> {
  const db = createDb(env.DB);
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  const [storefront] = await db
    .select({ userId: storefronts.userId })
    .from(storefronts)
    .where(eq(storefronts.id, listing.storefrontId));
  if (!storefront) throw new Error(`Storefront ${listing.storefrontId} not found for listing ${listingId}`);

  const matchableSuppliers = await userMatchableSuppliers(db, storefront.userId);
  const candidates = await gatherCandidates(env, db, listing, matchableSuppliers);
  if (candidates.length === 0) return [];

  const gemini = createGeminiExtractor(env);
  const listingEmbedding = await gemini.embedText(listing.title);
  const scored = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      similarity: cosineSimilarity(listingEmbedding, await gemini.embedText(candidate.title)),
    })),
  );
  scored.sort((a, b) => b.similarity - a.similarity);
  const relevant = scored.filter((s) => s.similarity >= MIN_CANDIDATE_SCORE_FOR_REVIEW);

  const supplierById = new Map(matchableSuppliers.map((s) => [s.id, s]));
  const results: ScoredMatchCandidate[] = [];
  for (const { candidate, similarity } of relevant.slice(0, limit)) {
    const supplier = supplierById.get(candidate.supplierId);
    if (!supplier) continue;
    const client = await createSupplierApiClientForSupplier(env, db, supplier);
    const offer = await client.getOffer(candidate.supplierProductId);
    results.push({
      supplierId: candidate.supplierId,
      supplierName: supplier.name,
      supplierProductId: candidate.supplierProductId,
      title: candidate.title,
      sku: candidate.sku ?? '',
      costCents: offer.costCents,
      score: similarity,
      imageUrl: candidate.imageUrl,
      productUrl: candidate.productUrl,
    });
  }
  return results;
}

/**
 * Applies a human's manual pick from `findMatchCandidates()` — or an
 * explicit "leave unmatched" decision (`choice: null`) — recorded with
 * `matchSource: 'manual'` either way, so the Listings page can tell a
 * listing that's been deliberately reviewed and confirmed as having no
 * match apart from one that's simply never been looked at yet. Assumes the
 * caller (the route) has already verified the listing and the chosen
 * supplier both belong to the requesting user.
 */
export async function applyManualMatch(
  env: Env,
  db: Database,
  listingId: string,
  choice: { supplierId: string; supplierProductId: string; title?: string; imageUrl?: string; productUrl?: string } | null,
): Promise<void> {
  if (!choice) {
    await db
      .update(listings)
      .set({ supplierId: null, supplierProductId: null, matchConfidence: 1, matchSource: 'manual', updatedAt: now() })
      .where(eq(listings.id, listingId));
    return;
  }

  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, choice.supplierId));
  if (!supplier) throw new Error(`Supplier ${choice.supplierId} not found`);

  const client = await createSupplierApiClientForSupplier(env, db, supplier);
  const offer = await client.getOffer(choice.supplierProductId);

  await db
    .update(listings)
    .set({
      supplierId: choice.supplierId,
      supplierProductId: choice.supplierProductId,
      matchConfidence: 1,
      matchSource: 'manual',
      updatedAt: now(),
    })
    .where(eq(listings.id, listingId));

  await upsertSupplierOffer(db, listingId, choice.supplierId, choice.supplierProductId, offer, 1, choice.title, choice.imageUrl, choice.productUrl);
}
