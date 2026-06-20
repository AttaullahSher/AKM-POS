import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// AKM-POS is a multi-page app: the POS (index.html) and the dashboard.
// vite-plugin-pwa generates a Workbox service worker at build time that
// knows every hashed bundle filename → full offline support.
export default defineConfig({
  appType: 'mpa',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        dashboard: 'dashboard.html',
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,   // HTML files already register /sw.js themselves
      manifest: false,        // use existing public/manifest.webmanifest
      filename: 'sw.js',      // match the path registered in the HTML
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/dashboard\.html/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'akm-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
