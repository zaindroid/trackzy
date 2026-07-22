import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Single-entry IIFE build — Chrome's `content_scripts` loader runs these as
// classic (non-module) scripts, so every dependency must be inlined rather
// than split into a shared chunk. See vite.config.ts.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/checkout.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content-checkout.js',
      },
    },
  },
});
