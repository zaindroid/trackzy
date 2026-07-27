const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * fetch() with a hard timeout. Without this, an upstream (Groq, ScraperAPI,
 * AliExpress) that hangs mid-request never rejects — a Worker background job
 * (waitUntil) can then sit at "running" forever, since nothing throws to hit
 * the caller's catch block. Aborts and throws once the timeout elapses.
 */
export async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`Request to ${String(input)} timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
