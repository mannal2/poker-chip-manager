import { defineConfig, devices } from '@playwright/test';
import { sharedStateSpecs } from './e2e/sharedStateSpecs';

// Specs that change shared state run after the parallel phase, one at a time, so no other
// page can observe the temporary change. Add new ones to e2e/sharedStateSpecs.ts.
const serialSpecs = sharedStateSpecs.map((file) => `**/${file}`);
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
    ...browsers.map((b) => ({ ...b, testIgnore: serialSpecs })),
    // Chained, not just workers: 1 each, so the two browsers never edit shared files at once.
    ...browsers.map((b, i) => ({
      ...b,
      name: `${b.name}-serial`,
      testMatch: serialSpecs,
      dependencies: i === 0 ? browsers.map((d) => d.name) : [`${browsers[i - 1].name}-serial`],
      workers: 1,
    })),
  ],
  webServer: {
    command: 'npm run build -- --mode test && npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173/local/',
    reuseExistingServer: false,
  },
});
