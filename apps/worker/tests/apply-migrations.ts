import { applyD1Migrations, env } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers/config').D1Migration[];
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
