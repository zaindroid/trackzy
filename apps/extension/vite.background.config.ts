import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Single-entry IIFE build so this file is fully self-contained — no shared
// chunk, safe for Chrome's service-worker loader either with or without
// "type": "module" in manifest.json. See vite.config.ts for why this is a
// separate build rather than one multi-entry config.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/background/background.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'background.js',
      },
    },
  },
});
