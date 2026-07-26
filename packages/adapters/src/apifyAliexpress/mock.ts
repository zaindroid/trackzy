import type { AliexpressProduct, ApifyAliexpressClient } from './iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, network-free mock. */
export class MockApifyAliexpressClient implements ApifyAliexpressClient {
  async searchProducts(keyword: string, maxProducts = 50): Promise<AliexpressProduct[]> {
    const base = hashString(keyword);
    const count = Math.min(maxProducts, 3 + (base % 5));
    return Array.from({ length: count }, (_, i) => {
      const id = `${base}${i}`;
      const imageUrls = [
        `https://picsum.photos/seed/AE${id}a/600/600`,
        `https://picsum.photos/seed/AE${id}b/600/600`,
        `https://picsum.photos/seed/AE${id}c/600/600`,
      ];
      return {
        productId: `AE${id}`,
        title: `${keyword} (AliExpress) - variant ${i + 1}`,
        priceCents: 200 + ((base + i * 53) % 1800),
        imageUrl: imageUrls[0],
        imageUrls,
        productUrl: `https://www.aliexpress.com/item/${id}.html`,
        soldCount: (base + i * 7) % 5000,
      };
    });
  }
}
