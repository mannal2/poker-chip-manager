import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      filename: 'local/sw.js',
      scope: '/local/',
      manifest: false,
      workbox: {
        modifyURLPrefix: { '': '/' },
        globPatterns: [
          'local/index.html',
          'local/manifest.webmanifest',
          'assets/**/*.{js,css}',
          'local/icon*.png',
          'local/icon.svg',
        ],
        globIgnores: ['assets/design-*', 'assets/storage-*'],
        navigateFallback: '/local/index.html',
        navigateFallbackAllowlist: [/^\/local\//],
        navigateFallbackDenylist: [/^\/(online|api|ws)(\/|$)/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        local: 'local/index.html',
        online: 'online/index.html',
        ...(mode === 'test' ? { design: 'e2e/design.html', storage: 'e2e/storage.html' } : {}),
      },
    },
  },
}));
