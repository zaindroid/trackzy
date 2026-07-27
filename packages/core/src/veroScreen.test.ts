import { describe, expect, it } from 'vitest';
import { screenVero } from './veroScreen.js';

describe('screenVero', () => {
  it('blocks branded niches (the top eBay-suspension risk)', () => {
    expect(screenVero('nike air max shoes').blocked).toBe(true);
    expect(screenVero('louis vuitton wallet').blocked).toBe(true);
    expect(screenVero('disney frozen backpack').blocked).toBe(true);
    expect(screenVero('iPhone 15 case').blocked).toBe(true);
    const r = screenVero('Gucci belt');
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('brand');
    expect(r.matchedTerm).toBe('gucci');
  });

  it('blocks counterfeit-intent phrases regardless of brand', () => {
    expect(screenVero('aaa quality replica handbag').blocked).toBe(true);
    expect(screenVero('designer inspired by luxury bag').blocked).toBe(true);
    const r = screenVero('1:1 mirror quality watch');
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('risk-phrase');
  });

  it('allows clean generic products', () => {
    expect(screenVero('silicone dog lick mat').blocked).toBe(false);
    expect(screenVero('magnetic phone mount').blocked).toBe(false);
    expect(screenVero('stainless steel water bottle').blocked).toBe(false);
    expect(screenVero('led strip lights 5m').blocked).toBe(false);
  });

  it('matches on whole words only — no substring false positives', () => {
    // "vans" the brand vs a word merely containing it; "lego" inside "allegory".
    expect(screenVero('caravans awning').blocked).toBe(false);
    expect(screenVero('allegory art print').blocked).toBe(false);
    // But the real brand token still trips.
    expect(screenVero('vans old skool').blocked).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(screenVero('POKEMON Cards!!!').blocked).toBe(true);
    expect(screenVero('star-wars lightsaber').blocked).toBe(true);
  });
});
