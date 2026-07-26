import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema.js';

export * from './schema.js';

export type Database = ReturnType<typeof createDb>;

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
