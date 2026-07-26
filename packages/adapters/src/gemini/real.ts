import type {
  ClassifyTrackingExceptionResult,
  GeminiDisputeInput,
  GeminiDisputeResult,
  GeminiEnv,
  GeminiExtractInput,
  GeminiExtractResult,
  GeminiExtractor,
  GeminiListingMatchInput,
  GeminiListingMatchResult,
  GeminiTitleSuggestionInput,
  GeminiTitleSuggestionResult,
  ListingContentInput,
  ListingContentResult,
  OpportunityAnalysisInput,
  OpportunityAnalysisResult,
  RefineKeywordsInput,
  ExpandNichesInput,
} from './iface.js';

// Standard (non-Gemini-flavored) JSON Schema, per Groq's OpenAI-compatible
// Structured Outputs — `type` unions for nullability plus `additionalProperties:
// false` and every property listed in `required`, matching OpenAI's strict
// schema mode Groq mirrors. TODO(HUMAN): this exact enforcement shape is
// unverified against a live Groq account; if a call ever throws a schema
// validation error, this is the first thing to check.
const TRACKING_EXCEPTION_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['in_transit', 'delivered', 'exception', 'needs_review'] },
    isStuckOrLost: { type: 'boolean' },
  },
  required: ['category', 'isStuckOrLost'],
  additionalProperties: false,
};

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    trackingNumber: { type: ['string', 'null'] },
    carrierDeclared: { type: ['string', 'null'], enum: ['UPS', 'USPS', 'FEDEX', 'DHL', null] },
    externalOrderRef: { type: ['string', 'null'] },
    sku: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['trackingNumber', 'carrierDeclared', 'externalOrderRef', 'sku', 'confidence'],
  additionalProperties: false,
};

const DISPUTE_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
};

const TITLE_SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestedTitle: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['suggestedTitle', 'reasoning'],
  additionalProperties: false,
};

// aspects is an array of {name,value} rather than a free-form object because
// strict JSON-schema structured output can't express a dynamic-keyed record;
// converted to a Record<string,string> at the adapter boundary below.
const LISTING_CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    descriptionHtml: { type: 'string' },
    aspects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'string' } },
        required: ['name', 'value'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 12,
    },
  },
  required: ['title', 'descriptionHtml', 'aspects'],
  additionalProperties: false,
};

const REFINE_KEYWORDS_SCHEMA = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
  },
  required: ['keywords'],
  additionalProperties: false,
};

const EXPAND_NICHES_SCHEMA = {
  type: 'object',
  properties: {
    niches: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 24 },
  },
  required: ['niches'],
  additionalProperties: false,
};

const OPPORTUNITY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    sellPriceMinCents: { type: 'integer' },
    sellPriceMaxCents: { type: 'integer' },
    targetSourcePriceCents: { type: 'integer' },
    marginEstimateCents: { type: 'integer' },
    risk: { type: 'string' },
    recommendedKeywords: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 5 },
  },
  required: [
    'verdict',
    'sellPriceMinCents',
    'sellPriceMaxCents',
    'targetSourcePriceCents',
    'marginEstimateCents',
    'risk',
    'recommendedKeywords',
  ],
  additionalProperties: false,
};

function listingMatchSchema(candidateIds: string[]) {
  return {
    type: 'object',
    properties: {
      // Structured-output enums must be non-empty; a "none" sentinel keeps
      // the schema valid even when the caller passes zero candidates.
      chosenId: { type: 'string', enum: [...candidateIds, 'none'] },
      confidence: { type: 'number' },
    },
    required: ['chosenId', 'confidence'],
    additionalProperties: false,
  };
}

export class RealGeminiExtractor implements GeminiExtractor {
  constructor(private readonly env: GeminiEnv) {}

  /**
   * Every chat/JSON call site runs through Groq's OpenAI-compatible chat
   * completions endpoint (see iface.ts docstring for why this moved off
   * Gemini). `schemaName` is required by Groq/OpenAI's structured-output
   * request shape (`response_format.json_schema.name`) but never inspected
   * by the caller.
   */
  private async generate<T>(prompt: string, schemaName: string, responseSchema: object): Promise<T> {
    const model = this.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.env.GROQ_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, schema: responseSchema, strict: true },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { choices?: { message: { content: string } }[] };
    const text = json.choices?.[0]?.message.content;
    if (!text) {
      throw new Error('Groq response missing structured output');
    }
    return JSON.parse(text) as T;
  }

  async extractTracking(input: GeminiExtractInput): Promise<GeminiExtractResult> {
    const prompt = [
      'Extract the shipment tracking number and, if stated, the carrier from this supplier email.',
      input.supplierName ? `Supplier: ${input.supplierName}` : '',
      `Subject: ${input.subject}`,
      'Body:',
      input.text,
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.generate<{
      trackingNumber?: string | null;
      carrierDeclared?: 'UPS' | 'USPS' | 'FEDEX' | 'DHL' | null;
      externalOrderRef?: string | null;
      sku?: string | null;
      confidence: number;
    }>(prompt, 'tracking_extraction', EXTRACT_SCHEMA);

    if (!result.trackingNumber) {
      return { candidate: null, confidence: result.confidence };
    }

    return {
      candidate: {
        trackingNumber: result.trackingNumber,
        carrierDeclared: result.carrierDeclared ?? undefined,
        externalOrderRef: result.externalOrderRef ?? undefined,
        sku: result.sku ?? undefined,
        confidence: result.confidence,
      },
      confidence: result.confidence,
    };
  }

  async draftDispute(input: GeminiDisputeInput): Promise<GeminiDisputeResult> {
    const prompt = [
      'Draft a short, professional email to a shipping carrier disputing an undelivered or lost package.',
      `Reason: ${input.reason}`,
      `Tracking number: ${input.trackingNumber}`,
      input.carrier ? `Carrier: ${input.carrier}` : '',
      input.orderNumber ? `Order number: ${input.orderNumber}` : '',
      'Return a subject line and a body.',
    ]
      .filter(Boolean)
      .join('\n');

    return this.generate<GeminiDisputeResult>(prompt, 'dispute_draft', DISPUTE_SCHEMA);
  }

  async embedText(text: string): Promise<number[]> {
    // Still Gemini — Groq has no embeddings API at all (see iface.ts
    // docstring). `text-embedding-004` was retired by Google on 2026-01-14
    // (confirmed live: every embedText call was 404ing against a real
    // account, breaking the listing-match cascade's embedding step — see
    // DECISIONS.md). `gemini-embedding-001` is Google's current
    // replacement, same `embedContent` request/response shape.
    const model = this.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.env.GEMINI_API_KEY ?? ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });
    if (!res.ok) {
      throw new Error(`Gemini embedding request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { embedding: { values: number[] } };
    return json.embedding.values;
  }

  /**
   * Final SKU/listing-matching cascade stage (spec section 8): constrained to
   * choosing one of the provided candidate ids (or "none") — never a
   * free-text answer, so the LLM can only narrow an already-bounded
   * decision, not invent a product that doesn't exist in our data.
   */
  async pickBestListingMatch(input: GeminiListingMatchInput): Promise<GeminiListingMatchResult> {
    if (input.candidates.length === 0) {
      return { chosenId: null, confidence: 0 };
    }

    const prompt = [
      'You are matching a marketplace listing to the correct supplier product.',
      `Listing title: ${input.targetTitle}`,
      'Candidate supplier products (choose the id of the one that is the same physical product, or "none" if none match):',
      ...input.candidates.map((c) => `- id=${c.id}: ${c.title}`),
    ].join('\n');

    const result = await this.generate<{ chosenId: string; confidence: number }>(
      prompt,
      'listing_match',
      listingMatchSchema(input.candidates.map((c) => c.id)),
    );
    return { chosenId: result.chosenId === 'none' ? null : result.chosenId, confidence: result.confidence };
  }

  /**
   * Delivery-exception triage (spec section 9): only called for a raw
   * carrier status the deterministic STATUS_MAP in webhooks.tracking.ts
   * didn't recognize. Constrained to the same 4-value status vocabulary
   * every mapped status already uses, so its output slots into
   * `fulfillments.trackingStatus`/`tracking_events.status` exactly like a
   * deterministic result would.
   */
  async classifyTrackingException(rawStatus: string): Promise<ClassifyTrackingExceptionResult> {
    const prompt = [
      'Classify this raw shipping carrier status into exactly one category.',
      `Raw status: ${rawStatus}`,
      'Categories: in_transit (still moving normally), delivered (successfully delivered),',
      'exception (stuck, lost, returned, damaged, or otherwise failed), needs_review (unclear/ambiguous).',
      'Also indicate whether this specifically looks stuck or lost (warranting a carrier claim).',
    ].join('\n');

    return this.generate<ClassifyTrackingExceptionResult>(prompt, 'tracking_exception_classification', TRACKING_EXCEPTION_SCHEMA);
  }

  /**
   * Listing title optimization — the fifth (and, per the hard rule's
   * original spec, deliberately exceptional) LLM call site, added post-build
   * at the user's explicit request. Never touches price/margin/stock; the
   * result is a suggestion a human reviews and chooses to apply via
   * PATCH /api/listings/:id/apply-title, never auto-applied to a live
   * marketplace listing straight from this call — see routes/api/listings.ts.
   */
  async suggestListingTitle(input: GeminiTitleSuggestionInput): Promise<GeminiTitleSuggestionResult> {
    const prompt = [
      'Suggest a better, more search-optimized product listing title for an eBay/Amazon-style marketplace.',
      `Current title: ${input.currentTitle}`,
      input.category ? `Category: ${input.category}` : '',
      input.keyFeatures?.length ? `Key features: ${input.keyFeatures.join(', ')}` : '',
      'Include concrete, searchable keywords a buyer would actually type (brand, model, size, color,',
      'material, compatibility) rather than vague marketing language. Keep it under 80 characters.',
      'Briefly explain why the new title is better.',
    ]
      .filter(Boolean)
      .join('\n');

    return this.generate<GeminiTitleSuggestionResult>(prompt, 'title_suggestion', TITLE_SUGGESTION_SCHEMA);
  }

  /**
   * Product-discovery "deep search" step (see DECISIONS.md): when a scanned
   * keyword's opportunity score is below the caller's threshold, generates
   * more specific sub-keywords to try instead — the same idea as the
   * original tool's Ollama-powered keyword refinement, ported to Groq.
   */
  async suggestRefinedKeywords(input: RefineKeywordsInput): Promise<string[]> {
    const prompt = [
      'A dropshipper is researching whether a product keyword is worth listing on eBay.',
      `Seed keyword: "${input.seedKeyword}"`,
      `Its current opportunity score is ${input.currentScore}/100 (higher is better) — too low to be worth listing as-is.`,
      input.sampleTitles.length ? `Sample sold listing titles found for this keyword:\n${input.sampleTitles.map((t) => `- ${t}`).join('\n')}` : '',
      'Suggest 5-8 more specific, narrower sub-keywords (e.g. adding a material, size, use-case, or',
      'bundle angle) that might reveal a better niche within this broader product category — the kind',
      'a real seller would search for, not generic marketing phrases.',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.generate<{ keywords: string[] }>(prompt, 'refined_keywords', REFINE_KEYWORDS_SCHEMA);
    return result.keywords;
  }

  async expandNiches(input: ExpandNichesInput): Promise<string[]> {
    const nonce = Math.random().toString(36).slice(2, 8);
    const prompt = [
      'You are a dropshipping product researcher doing a DEEP, VERSATILE search from one seed.',
      `Seed: "${input.seed}"`,
      `Generate ${input.count} DISTINCT, specific product niches related to the seed that could sell on`,
      'eBay and are cheaply sourceable on AliExpress. Maximize VARIETY — deliberately span different',
      'angles so we surface a wide range of high-potential winners, e.g.:',
      '- material / build variants (silicone, stainless steel, bamboo, magnetic…)',
      '- specific use-cases or settings (car, travel, gym, kitchen, bedroom…)',
      '- target audiences (kids, pets, seniors, gamers…)',
      '- form factors / bundles (mini, foldable, rechargeable, set of N…)',
      '- closely adjacent products in the same buyer’s basket',
      'Rules: each niche is a concrete, searchable 3-6 word phrase (NOT a broad head term like the seed',
      'alone); specific enough for manageable competition; no brand names; no restricted/hazardous items.',
      `Vary the ideas genuinely (variety token: ${nonce}).`,
      `Return strict JSON: {"niches": [...]} with exactly ${input.count} distinct items.`,
    ].join('\n');

    const result = await this.generate<{ niches: string[] }>(prompt, 'niche_expansion', EXPAND_NICHES_SCHEMA);
    // Dedupe case-insensitively and bound.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of result.niches ?? []) {
      const v = String(n).replace(new RegExp(`\\b${nonce}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
      const k = v.toLowerCase();
      if (v && !seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
    }
    return out.slice(0, input.count);
  }

  /**
   * Product-discovery final analysis (see DECISIONS.md): a human-readable
   * verdict on the winning keyword from a deep search — never auto-acted on,
   * purely advisory copy for a human deciding whether to actually source and
   * list the product.
   */
  async analyzeOpportunity(input: OpportunityAnalysisInput): Promise<OpportunityAnalysisResult> {
    const prompt = [
      'Analyze this eBay product-research scan for a dropshipper deciding whether to list it.',
      `Keyword: ${input.keyword}`,
      `Average sold price: $${(input.avgPriceCents / 100).toFixed(2)}`,
      `Confirmed sales found: ${input.totalSold}`,
      `Unique competing sellers: ${input.uniqueSellers}`,
      `Free shipping prevalence: ${input.freeShippingPercent}%`,
      'Give a short verdict (worth listing? why/why not), a realistic sell-price range, a target',
      'sourcing price that would leave a reasonable margin, an estimated margin, a one-line risk note',
      '(competition, price volatility, seasonality, etc.), and up to 5 more specific next keywords worth',
      'researching. Report every price/margin figure in US cents (e.g. $19.99 is 1999), matching the',
      'field names ending in "Cents" — never dollars.',
    ].join('\n');

    const result = await this.generate<{
      verdict: string;
      sellPriceMinCents: number;
      sellPriceMaxCents: number;
      targetSourcePriceCents: number;
      marginEstimateCents: number;
      risk: string;
      recommendedKeywords: string[];
    }>(prompt, 'opportunity_analysis', OPPORTUNITY_ANALYSIS_SCHEMA);
    return result;
  }

  /**
   * Sourcing portal: generates the eBay listing content (title, HTML
   * description, item specifics) for a product the bot found and margin-
   * checked. A human reviews/edits and one-click publishes — never
   * auto-listed straight from this call (see the plan). Pre-listing/authoring
   * phase, no money-path decision.
   */
  async generateListingContent(input: ListingContentInput): Promise<ListingContentResult> {
    const prompt = [
      'You are an expert eBay copywriter. Write a compelling, conversion-optimized fixed-price listing',
      'for a dropshipped product that a shopper would actually want to buy.',
      'Tone: professional and trustworthy. Do NOT use any emojis or decorative symbols anywhere',
      '(title, description, or aspects). Plain professional retail English only.',
      `Buyer search term / niche: ${input.keyword}`,
      `Supplier product title (source of truth for what the item is): ${input.supplierTitle}`,
      `Typical eBay sold price for this item: $${(input.avgSoldPriceCents / 100).toFixed(2)}`,
      'Produce:',
      '- title: a search-optimized eBay title UNDER 80 characters, front-loaded with the words a buyer',
      '  would type (product type, key attributes, material/size/color), no ALL-CAPS spam, no emojis.',
      '- descriptionHtml: a rich, persuasive HTML product description that reads like a professional',
      '  storefront listing — NOT one or two sentences. Structure it as:',
      '    1) An <h2> headline and a short hook paragraph selling the main benefit.',
      '    2) An <h3>Key Features</h3> with a <ul> of 5-8 concrete feature/benefit bullets, each pairing',
      '       a feature with why it matters to the buyer (derive them from the supplier title/attributes).',
      '    3) An <h3>Why You\'ll Love It</h3> paragraph covering real use-cases / who it\'s for.',
      '    4) An <h3>What You Get</h3> line and a short trust/quality reassurance (fast dispatch, quality',
      '       checked) — WITHOUT inventing brand names, authenticity, warranties, or specs you cannot',
      '       verify from the supplier title. Accurate and enthusiastic, never false.',
      '  Use clean semantic HTML (h2/h3/p/ul/li/strong) and keep it scannable. Aim for 120-220 words.',
      '- aspects: eBay item specifics as name/value pairs (e.g. Type, Material, Color, Size, Features,',
      '  Compatibility, Brand). Provide as many accurate specifics as the supplier title supports (buyers',
      '  filter on these). Use "Generic"/"Unbranded" for Brand unless the title clearly names a real brand.',
    ].join('\n');

    const result = await this.generate<{
      title: string;
      descriptionHtml: string;
      aspects: { name: string; value: string }[];
    }>(prompt, 'listing_content', LISTING_CONTENT_SCHEMA);

    const aspects: Record<string, string> = {};
    for (const { name, value } of result.aspects) {
      if (name) aspects[name] = value;
    }
    return { title: result.title, descriptionHtml: result.descriptionHtml, aspects };
  }
}
