import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Single-entry IIFE build — see vite.content-checkout.config.ts / vite.config.ts.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/ebayTracking.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content-ebay-tracking.js',
      },
    },
  },
});
