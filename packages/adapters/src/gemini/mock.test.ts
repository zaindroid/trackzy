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
});
