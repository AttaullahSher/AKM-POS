import { defineConfig } from 'vite';

// AKM-POS is a multi-page app: the POS (index.html) and the dashboard.
// Vite bundles + hashes each page's module graph, so the old manual
// ?v=4.0 cache-busting (and the duplicate-Firebase-init bug it caused) is gone.
export default defineConfig({
  appType: 'mpa',          // multi-page — no SPA index fallback
  publicDir: 'public',     // copied verbatim to dist/ (icons, manifest, sw.js)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,   // F12 console shows real file:line, not minified gibberish

    rollupOptions: {
      input: {
        main: 'index.html',
        dashboard: 'dashboard.html',
      },
    },
  },
});
