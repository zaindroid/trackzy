import { config } from './config.js';
import type { RadarItem } from './types.js';

/** POSTs the finished snapshot to the sourcing-portal ingest endpoint. */
export async function postToRadar(items: RadarItem[], mode: 'replace' | 'upsert' = 'replace'): Promise<void> {
  const res = await fetch(config.ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ingestToken}` },
    body: JSON.stringify({ mode, items }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Ingest failed: ${res.status} ${body}`);
  console.log(`[ingest] ${res.status} ${body}`);
}
