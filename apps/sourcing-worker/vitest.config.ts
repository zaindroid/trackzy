import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, '../../packages/sourcing-db/migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ['./tests/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: '../../wrangler.sourcing.test.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              MOCK_MODE: 'true',
              CREDENTIAL_ENCRYPTION_KEY: 'hmOZOoYn2Kc6SK8VaSU7DoKxgHVw72iVNPdgmDOM0iQ=',
              // Non-empty (placeholder) so the /ebay/start "configured?" guard
              // passes in tests; MOCK_MODE=true keeps every adapter mocked
              // regardless of these values.
              EBAY_CLIENT_ID: 'PLACEHOLDER__EBAY_CLIENT_ID',
              EBAY_CLIENT_SECRET: 'PLACEHOLDER__EBAY_CLIENT_SECRET',
              EBAY_RUNAME: 'PLACEHOLDER__EBAY_RUNAME',
              EBAY_DELETION_VERIFICATION_TOKEN: 'test-verification-token-0123456789',
              RADAR_INGEST_TOKEN: 'test-radar-ingest-token-0123456789',
              LEMONSQUEEZY_WEBHOOK_SECRET: 'test-ls-webhook-secret',
              GEMINI_API_KEY: 'PLACEHOLDER__GEMINI_API_KEY',
              GROQ_API_KEY: 'PLACEHOLDER__GROQ_API_KEY',
              APIFY_TOKEN: 'PLACEHOLDER__APIFY_TOKEN',
            },
          },
        },
      },
    },
  };
});
