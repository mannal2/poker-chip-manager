import { defineConfig, devices } from '@playwright/test';

// These specs rewrite dist/local/sw.js, which every /local/ page registers. They run after the
// parallel phase, one at a time, so no other page can observe the temporary service worker.
const serviceWorkerSpecs = ['**/pwa.spec.ts', '**/startup-update.spec.ts'];
const browsers = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Local machines run 6 files at once; GitHub's 4-core runner keeps 2.
  workers: process.env.CI ? 2 : 6,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [
    ...browsers.map((b) => ({ ...b, testIgnore: serviceWorkerSpecs })),
    // Chained, not just workers: 1 each, so the two browsers never edit sw.js at the same time.
    ...browsers.map((b, i) => ({
      ...b,
      name: `${b.name}-sw`,
      testMatch: serviceWorkerSpecs,
      dependencies: i === 0 ? browsers.map((d) => d.name) : [`${browsers[i - 1].name}-sw`],
      workers: 1,
    })),
  ],
  webServer: {
    command: 'npm run build -- --mode test && npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173/local/',
    reuseExistingServer: false,
  },
});
