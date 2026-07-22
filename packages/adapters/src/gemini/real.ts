import type {
  GeminiDisputeInput,
  GeminiDisputeResult,
  GeminiEnv,
  GeminiExtractInput,
  GeminiExtractResult,
  GeminiExtractor,
  GeminiListingMatchInput,
  GeminiListingMatchResult,
} from './iface.js';

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    trackingNumber: { type: 'string', nullable: true },
    carrierDeclared: { type: 'string', enum: ['UPS', 'USPS', 'FEDEX', 'DHL'], nullable: true },
    externalOrderRef: { type: 'string', nullable: true },
    sku: { type: 'string', nullable: true },
    confidence: { type: 'number' },
  },
  required: ['confidence'],
};

const DISPUTE_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
};

function listingMatchSchema(candidateIds: string[]) {
  return {
    type: 'object',
    properties: {
      // Gemini's structured output enums must be non-empty; a "none" sentinel
      // keeps the schema valid even when the caller passes zero candidates.
      chosenId: { type: 'string', enum: [...candidateIds, 'none'] },
      confidence: { type: 'number' },
    },
    required: ['chosenId', 'confidence'],
  };
}

export class RealGeminiExtractor implements GeminiExtractor {
  constructor(private readonly env: GeminiEnv) {}

  private async generate<T>(prompt: string, responseSchema: object): Promise<T> {
    const model = this.env.GEMINI_MODEL ?? 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.env.GEMINI_API_KEY ?? ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      candidates?: { content: { parts: { text: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content.parts[0]?.text;
    if (!text) {
      throw new Error('Gemini response missing structured output');
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
    }>(prompt, EXTRACT_SCHEMA);

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

    return this.generate<GeminiDisputeResult>(prompt, DISPUTE_SCHEMA);
  }

  async embedText(text: string): Promise<number[]> {
    const model = this.env.GEMINI_EMBEDDING_MODEL ?? 'text-embedding-004';
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
      listingMatchSchema(input.candidates.map((c) => c.id)),
    );
    return { chosenId: result.chosenId === 'none' ? null : result.chosenId, confidence: result.confidence };
  }
}
