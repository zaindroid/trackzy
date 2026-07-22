import type { GmailClient, GmailMessage, GmailMessageSummary } from './iface.js';

const FIXTURE_MESSAGES: GmailMessage[] = [
  {
    id: 'gmail-mock-amazon-1',
    subject: 'Your package has shipped!',
    from: 'ship-confirm@amazon.com',
    textBody: [
      'Your package has shipped!',
      'Order #: 111-2223334-5556667',
      'Tracking ID: TBA123456789012',
      'Carrier: Amazon Logistics',
    ].join('\n'),
    internalDate: Date.now() - 3_600_000,
  },
  {
    id: 'gmail-mock-aliexpress-1',
    subject: 'Your order has been shipped!',
    from: 'noreply@aliexpress.com',
    textBody: [
      'Your order has been shipped!',
      'Order ID: 8012345678901234',
      'Tracking Number: LP00123456789CN',
      'Shipping Company: CAINIAO',
    ].join('\n'),
    internalDate: Date.now() - 1_800_000,
  },
];

/** Deterministic, fixture-backed Gmail mock — no OAuth, no network. */
export class MockGmailClient implements GmailClient {
  async listNewMessages(_query: string, sinceUnixMs: number): Promise<GmailMessageSummary[]> {
    return FIXTURE_MESSAGES.filter((m) => m.internalDate >= sinceUnixMs).map((m) => ({ id: m.id }));
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const message = FIXTURE_MESSAGES.find((m) => m.id === id);
    if (!message) throw new Error(`MockGmailClient: no fixture message with id ${id}`);
    return message;
  }
}
