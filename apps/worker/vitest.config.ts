import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, '../../packages/db/migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ['./tests/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: '../../wrangler.test.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              SHOPIFY_WEBHOOK_SECRET: 'test-shopify-webhook-secret',
              SEVENTEENTRACK_API_KEY: 'test-17track-shared-secret',
            },
          },
        },
      },
    },
  };
});
