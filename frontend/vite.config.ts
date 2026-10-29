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
        // Only the local entry and the chunks it shares; other pages never run offline.
        globIgnores: ['assets/design-*', 'assets/storage-*', 'assets/home-*', 'assets/online-*'],
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
      output: {
        // Entry names prefix their files so the service worker can leave out home/online ones.
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Code every entry shares gets a readable name instead of one borrowed from a module.
        manualChunks: (id) => {
          const path = id.replaceAll('\\', '/');
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react';
          if (
            path.includes('/src/app/mount') ||
            path.includes('/src/shared/browser/') ||
            path.includes('modulepreload-polyfill')
          )
            return 'start';
        },
        // A chunk made only of online-game modules is online-only, even when split out later.
        chunkFileNames: (chunk) =>
          chunk.moduleIds.length > 0 &&
          chunk.moduleIds.every((id) => id.replaceAll('\\', '/').includes('/features/online-game/'))
            ? 'assets/online-[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
}));
