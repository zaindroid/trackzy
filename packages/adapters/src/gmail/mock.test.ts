import { describe, expect, it } from 'vitest';
import { MockGmailClient } from './mock.js';

describe('MockGmailClient', () => {
  it('lists fixture messages newer than `sinceUnixMs`', async () => {
    const client = new MockGmailClient();
    const messages = await client.listNewMessages('subject:(shipped)', 0);
    expect(messages.length).toBe(2);
  });

  it('excludes fixture messages older than `sinceUnixMs`', async () => {
    const client = new MockGmailClient();
    const messages = await client.listNewMessages('subject:(shipped)', Date.now() + 1_000_000);
    expect(messages).toEqual([]);
  });

  it('getMessage returns full message content for a known id', async () => {
    const client = new MockGmailClient();
    const message = await client.getMessage('gmail-mock-amazon-1');
    expect(message.subject).toBe('Your package has shipped!');
    expect(message.textBody).toContain('TBA123456789012');
  });

  it('getMessage throws for an unknown id', async () => {
    const client = new MockGmailClient();
    await expect(client.getMessage('does-not-exist')).rejects.toThrow();
  });
});
