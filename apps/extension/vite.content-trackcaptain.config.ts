import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Single-entry IIFE build — see vite.content-checkout.config.ts / vite.config.ts.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/trackCaptain.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content-trackcaptain.js',
      },
    },
  },
});
