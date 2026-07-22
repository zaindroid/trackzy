import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Popup-only build: a normal Vite HTML entry, ES modules are fine here since
// the popup runs as a regular extension page (not a content script). The
// three non-HTML entries (background + two content scripts) are built by
// separate single-entry configs — see vite.background.config.ts and
// vite.content.config.ts — because Chrome loads `content_scripts` as classic
// (non-module) scripts that cannot `import` a shared chunk; building them
// together in one multi-entry ES-module bundle silently produces a
// `chunks/*.js` file content scripts can't actually load. No plugin
// dependency needed to work around this — just separate `vite build` runs
// (see package.json's `build` script), each emitting one self-contained IIFE.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, 'popup.html') },
    },
  },
});
