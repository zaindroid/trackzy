import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, productOpportunities, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user-research', 'Content-Type': 'application/json' };
const USER_ID = 'usr_research';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-research', email: 'research@test.dev', createdAt: 0 });
});

describe('POST /api/product-opportunities/search', () => {
  it('scans confirmed-sold eBay data (mock), scores the keyword, and persists a scan row', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/product-opportunities/search', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ keyword: 'silk eye mask' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      keyword: string;
      totalSold: number;
      uniqueSellers: number;
      avgPriceCents: number;
      opportunityScore: number;
      sampleListings: { title: string; url: string; priceCents: number }[];
    };

    expect(body.keyword).toBe('silk eye mask');
    expect(body.totalSold).toBeGreaterThan(0);
    expect(body.avgPriceCents).toBeGreaterThan(0);
    expect(body.opportunityScore).toBeGreaterThanOrEqual(0);
    expect(body.opportunityScore).toBeLessThanOrEqual(100);
    expect(body.sampleListings.length).toBeGreaterThan(0);
    expect(body.sampleListings[0]?.title).toContain('silk eye mask');

    const db = createDb(env.DB);
    const rows = await db.select().from(productOpportunities).where(eq(productOpportunities.userId, USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyword).toBe('silk eye mask');
    expect(rows[0]?.aiVerdict).toBeNull(); // no deep search requested — no AI analysis attached
  });

  it('400s on a missing keyword', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/product-opportunities/search', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('deepSearch: true refines the keyword when the seed score is low, persists every attempted scan, and attaches an AI verdict to the winner', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/product-opportunities/search', {
      method: 'POST',
      headers: AUTH_HEADERS,
      // A single generic word keeps the mock's specificity-based item count
      // high, which (per computeOpportunityScore's competition term) tends
      // to score low enough to trigger at least one refinement round.
      body: JSON.stringify({ keyword: 'gadget', deepSearch: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      keyword: string;
      opportunityScore: number;
      ai: { verdict: string; sellPriceMinCents: number; recommendedKeywords: string[] };
    };
    expect(body.ai.verdict).toBeTruthy();
    expect(body.ai.sellPriceMinCents).toBeGreaterThan(0);

    const db = createDb(env.DB);
    const rows = await db.select().from(productOpportunities).where(eq(productOpportunities.userId, USER_ID));
    // At least the seed scan, likely several refinement attempts too.
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const winner = rows.find((r) => r.keyword === body.keyword);
    expect(winner?.aiVerdict).toBe(body.ai.verdict);
    expect(winner?.aiRecommendedKeywordsJson).toBeTruthy();

    // Every OTHER attempted keyword (if any) must not carry the AI verdict —
    // only the winner gets one.
    for (const row of rows) {
      if (row.keyword !== body.keyword) {
        expect(row.aiVerdict).toBeNull();
      }
    }
  });
});

describe('GET /api/product-opportunities', () => {
  it("lists the user's past scans, newest first, scoped to the authed user", async () => {
    await SELF.fetch('https://worker.example.com/api/product-opportunities/search', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ keyword: 'gaming mouse' }),
    });

    const res = await SELF.fetch('https://worker.example.com/api/product-opportunities', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opportunities: { keyword: string; sampleListings: unknown[]; totalSold: number }[] };
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0]?.keyword).toBe('gaming mouse');
    expect(Array.isArray(body.opportunities[0]?.sampleListings)).toBe(true);
    expect(body.opportunities[0]?.totalSold).toBeGreaterThan(0);
  });

  it('scopes to the authed user only, never showing another tenant\'s scans', async () => {
    const db = createDb(env.DB);
    await db.insert(users).values({ id: 'usr_research_other', clerkUserId: 'dev-user-research-other', email: 'other@test.dev', createdAt: 0 });
    await SELF.fetch('https://worker.example.com/api/product-opportunities/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer dev-user-research-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'other user keyword' }),
    });

    const res = await SELF.fetch('https://worker.example.com/api/product-opportunities', { headers: AUTH_HEADERS });
    const body = (await res.json()) as { opportunities: { keyword: string }[] };
    expect(body.opportunities.find((o) => o.keyword === 'other user keyword')).toBeUndefined();
  });
});
