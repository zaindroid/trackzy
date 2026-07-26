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
            // Explicit bindings here always win over wrangler.test.toml's [vars] AND
            // over the developer's local .dev.vars (Wrangler's normal precedence is
            // .dev.vars > [vars], which would otherwise let a real GEMINI_API_KEY in
            // .dev.vars silently turn the test suite into live network calls — tests
            // must stay hermetic and pass with zero credentials, per spec).
            bindings: {
              TEST_MIGRATIONS: migrations,
              MOCK_MODE: 'true',
              GEMINI_API_KEY: 'PLACEHOLDER__GEMINI_API_KEY',
              SHOPIFY_WEBHOOK_SECRET: 'test-shopify-webhook-secret',
              SEVENTEENTRACK_API_KEY: 'test-17track-shared-secret',
              EBAY_DELETION_VERIFICATION_TOKEN: 'test-ebay-deletion-verification-token',
              CREDENTIAL_ENCRYPTION_KEY: 'hmOZOoYn2Kc6SK8VaSU7DoKxgHVw72iVNPdgmDOM0iQ=',
              // PLACEHOLDER__ prefixed (not real-looking) deliberately — these only
              // need to be non-empty for connections.test.ts's own start/callback
              // flow, but any *other* test that spreads the shared `env` (e.g.
              // trackingUploader.test.ts's REAL_ENV) must still see eBay's adapter
              // resolve to its mock, not flip to real just because these are set.
              EBAY_CLIENT_ID: 'PLACEHOLDER__EBAY_CLIENT_ID',
              EBAY_CLIENT_SECRET: 'PLACEHOLDER__EBAY_CLIENT_SECRET',
              EBAY_RUNAME: 'PLACEHOLDER__EBAY_RUNAME',
              ALIEXPRESS_APP_KEY: 'PLACEHOLDER__ALIEXPRESS_APP_KEY',
              ALIEXPRESS_APP_SECRET: 'PLACEHOLDER__ALIEXPRESS_APP_SECRET',
            },
          },
        },
      },
    },
  };
});
