import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/online',
  use: { baseURL: 'http://127.0.0.1:4174' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: `${process.platform === 'win32' ? '..\\backend\\gradlew.bat' : '../backend/gradlew'} -p ../backend :server:bootRun --args=--spring.profiles.active=e2e`,
      url: 'http://127.0.0.1:8080/api/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run build && npm run preview -- --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174/online/',
      reuseExistingServer: false,
    },
  ],
});
