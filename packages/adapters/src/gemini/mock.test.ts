import { describe, expect, it } from 'vitest';
import { MockGeminiExtractor } from './mock.js';

describe('MockGeminiExtractor', () => {
  const extractor = new MockGeminiExtractor();

  it('extracts a tracking number embedded in unstructured prose', async () => {
    const result = await extractor.extractTracking({
      subject: 'Re: your package',
      text: 'Hey, just a heads up your package 1Z999AA10123456780 is on the way!',
    });
    expect(result.candidate?.trackingNumber).toBe('1Z999AA10123456780');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns a low-confidence null candidate when nothing tracking-shaped is present', async () => {
    const result = await extractor.extractTracking({
      subject: 'Thanks for your order',
      text: 'We appreciate your business and will be in touch soon.',
    });
    expect(result.candidate).toBeNull();
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('drafts a dispute email referencing the tracking number and reason', async () => {
    const result = await extractor.draftDispute({
      reason: 'No scan update in 7 days',
      trackingNumber: '1Z999AA10123456780',
      carrier: 'UPS',
    });
    expect(result.subject).toContain('1Z999AA10123456780');
    expect(result.body).toContain('No scan update in 7 days');
  });

  describe('embedText', () => {
    it('is deterministic for the same input', async () => {
      const a = await extractor.embedText('Widget Red Large');
      const b = await extractor.embedText('Widget Red Large');
      expect(a).toEqual(b);
    });

    it('gives similar text high cosine similarity and dissimilar text low similarity', async () => {
      const a = await extractor.embedText('Widget Red Large');
      const b = await extractor.embedText('Widget Red Large 2');
      const c = await extractor.embedText('Totally unrelated gizmo product');

      const cosine = (x: number[], y: number[]) => x.reduce((sum, v, i) => sum + v * (y[i] ?? 0), 0);
      expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
    });
  });

  describe('pickBestListingMatch', () => {
    it('picks the candidate with the highest title similarity', async () => {
      const result = await extractor.pickBestListingMatch({
        targetTitle: 'Widget - Red / Large',
        candidates: [
          { id: 'p1', title: 'Widget Red Large 2' },
          { id: 'p2', title: 'Completely unrelated product' },
        ],
      });
      expect(result.chosenId).toBe('p1');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('returns null when no candidate is a plausible match', async () => {
      const result = await extractor.pickBestListingMatch({
        targetTitle: 'Widget Red Large',
        candidates: [{ id: 'p1', title: 'Xylophone Zebra Quilt' }],
      });
      expect(result.chosenId).toBeNull();
    });

    it('returns null with zero confidence for an empty candidate list', async () => {
      const result = await extractor.pickBestListingMatch({ targetTitle: 'Widget', candidates: [] });
      expect(result).toEqual({ chosenId: null, confidence: 0 });
    });
  });

  describe('classifyTrackingException', () => {
    it('classifies a stuck/lost-sounding status as exception, flagged stuck or lost', async () => {
      const result = await extractor.classifyTrackingException('Package appears lost in transit');
      expect(result).toEqual({ category: 'exception', isStuckOrLost: true });
    });

    it('classifies a delivered-sounding status as delivered', async () => {
      const result = await extractor.classifyTrackingException('Item left at front door');
      expect(result).toEqual({ category: 'delivered', isStuckOrLost: false });
    });

    it('classifies a normal-movement status as in_transit', async () => {
      const result = await extractor.classifyTrackingException('Departed facility, in transit to next hub');
      expect(result).toEqual({ category: 'in_transit', isStuckOrLost: false });
    });

    it('falls back to needs_review for genuinely unclassifiable text', async () => {
      const result = await extractor.classifyTrackingException('Status code 47B');
      expect(result).toEqual({ category: 'needs_review', isStuckOrLost: false });
    });
  });

  describe('suggestListingTitle', () => {
    it('appends missing category/keyFeatures terms not already in the title', async () => {
      const result = await extractor.suggestListingTitle({
        currentTitle: 'Phone Case',
        category: 'Shockproof',
        keyFeatures: ['MagSafe', 'Clear'],
      });
      expect(result.suggestedTitle).toContain('Phone Case');
      expect(result.suggestedTitle).toContain('Shockproof');
      expect(result.suggestedTitle).toContain('MagSafe');
      expect(result.suggestedTitle).toContain('Clear');
      expect(result.reasoning).toContain('Shockproof');
    });

    it('does not duplicate a term that already appears in the title (case-insensitive)', async () => {
      const result = await extractor.suggestListingTitle({
        currentTitle: 'Clear Phone Case with MagSafe',
        keyFeatures: ['magsafe', 'Clear'],
      });
      expect(result.suggestedTitle).toBe('Clear Phone Case with MagSafe');
      expect(result.reasoning).toContain('already includes');
    });

    it('truncates the suggested title to 80 characters', async () => {
      const result = await extractor.suggestListingTitle({
        currentTitle: 'A'.repeat(70),
        keyFeatures: ['Extra Long Feature Name That Pushes This Well Past The Limit'],
      });
      expect(result.suggestedTitle.length).toBeLessThanOrEqual(80);
    });
  });
});
