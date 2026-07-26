import { isMockMode } from '../mockMode.js';
import type { GeminiEnv, GeminiExtractor } from './iface.js';
import { RealGeminiExtractor } from './real.js';
import { MockGeminiExtractor } from './mock.js';

export * from './iface.js';
export { RealGeminiExtractor } from './real.js';
export { MockGeminiExtractor } from './mock.js';

export function createGeminiExtractor(env: GeminiEnv): GeminiExtractor {
  // Both keys required now — GEMINI_API_KEY for embedText, GROQ_API_KEY for
  // everything else (see iface.ts docstring). Either one missing/placeholder
  // means at least one method would fail against a real account, so mock
  // mode is the safer default in that case, same convention as every other
  // adapter's multi-secret gate (e.g. eBay's CLIENT_ID + CLIENT_SECRET).
  if (isMockMode(env.MOCK_MODE, env.GEMINI_API_KEY, env.GROQ_API_KEY)) {
    return new MockGeminiExtractor();
  }
  return new RealGeminiExtractor(env);
}
