import type { AliexpressDsClient, AliexpressDsProduct } from './iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, network-free mock. */
export class MockAliexpressDsClient implements AliexpressDsClient {
  async searchProducts(keyword: string, maxProducts = 8): Promise<AliexpressDsProduct[]> {
    const base = hashString(keyword);
    const count = Math.min(maxProducts, 3 + (base % 4));
    return Array.from({ length: count }, (_, i) => {
      const id = `${base}${i}`;
      const img = `https://picsum.photos/seed/DS${id}/600/600`;
      return {
        productId: `AE${id}`,
        title: `${keyword} (AliExpress DS) variant ${i + 1}`,
        costCents: 150 + ((base + i * 71) % 1500),
        imageUrl: img,
        imageUrls: [img, `https://picsum.photos/seed/DS${id}b/600/600`],
        productUrl: `https://www.aliexpress.com/item/${id}.html`,
        orders: (base + i * 13) % 8000,
        rating: 4 + ((base + i) % 10) / 10,
      };
    }).sort((a, b) => a.costCents - b.costCents);
  }
}
