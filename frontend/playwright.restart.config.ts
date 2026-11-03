import { defineConfig, devices } from '@playwright/test';

// The spec starts and kills the backend itself on 8080, which the preview proxy targets, so this
// suite never runs at the same time as the online suite. Its preview uses 4175 to stay apart.
export default defineConfig({
  testDir: './e2e/restart',
  workers: 1,
  timeout: 240_000,
  use: { baseURL: 'http://127.0.0.1:4175' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/online/',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
