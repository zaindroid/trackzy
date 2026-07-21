import { isMockMode } from '../mockMode.js';
import type { GeminiEnv, GeminiExtractor } from './iface.js';
import { RealGeminiExtractor } from './real.js';
import { MockGeminiExtractor } from './mock.js';

export * from './iface.js';
export { RealGeminiExtractor } from './real.js';
export { MockGeminiExtractor } from './mock.js';

export function createGeminiExtractor(env: GeminiEnv): GeminiExtractor {
  if (isMockMode(env.MOCK_MODE, env.GEMINI_API_KEY)) {
    return new MockGeminiExtractor();
  }
  return new RealGeminiExtractor(env);
}
