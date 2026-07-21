import type {
  GeminiDisputeInput,
  GeminiDisputeResult,
  GeminiEnv,
  GeminiExtractInput,
  GeminiExtractResult,
  GeminiExtractor,
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

export class RealGeminiExtractor implements GeminiExtractor {
  constructor(private readonly env: GeminiEnv) {}

  private async generate<T>(prompt: string, responseSchema: object): Promise<T> {
    const model = this.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
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
}
