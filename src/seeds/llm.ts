export interface NicheGenOptions {
  apiKey?: string;
  model: string;
  count: number;
  themes: string[];
}

/**
 * LLM-driven niche generation (Groq, OpenAI-compatible). The crawler proposes
 * its OWN specific, long-tail product niches each run instead of relying on a
 * hand-maintained list — this is the "let the LLM find the right seeds again
 * and again" step. It deliberately asks for SPECIFIC phrases (not broad heads
 * like "phone case") because broad niches score badly on competition; and it
 * varies output run-to-run so Radar keeps discovering fresh opportunities.
 *
 * Takes its config as params (no module-level env dependency) so it stays
 * unit-testable. Returns [] if no apiKey (caller falls back to seeds.json).
 */
export async function generateNiches({ apiKey, model, count, themes }: NicheGenOptions): Promise<string[]> {
  if (!apiKey) return [];

  const themeLine = themes.length
    ? `Bias toward these areas: ${themes.join(', ')}.`
    : 'Range across popular consumer categories (home, pet, auto, fitness, gadgets, beauty, kids).';
  const nonce = Math.random().toString(36).slice(2, 8);

  const prompt = [
    'You are a dropshipping product researcher. Propose SPECIFIC, long-tail product niches that',
    'sell steadily on eBay and are cheaply sourceable on AliExpress.',
    themeLine,
    'Rules:',
    '- Each niche is a concrete, searchable product phrase of 3-6 words.',
    '- Specific enough to have MANAGEABLE competition — e.g. "magnetic vent car phone mount",',
    '  NOT a broad head term like "phone mount" or "car accessories".',
    '- No brand names. No restricted/hazardous/counterfeit items.',
    '- Give genuinely varied ideas (variety token: ' + nonce + ').',
    `Return strict JSON: {"niches": ["...", ...]} with exactly ${count} items and nothing else.`,
  ].join('\n');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { niches?: unknown };
  const niches = Array.isArray(parsed.niches)
    ? parsed.niches
        // The model occasionally prepends the variety token to a niche — strip it.
        .map((n) => String(n).replace(new RegExp(`\\b${nonce}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    : [];
  // Dedupe (case-insensitive) and bound.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of niches) {
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out.slice(0, count);
}
