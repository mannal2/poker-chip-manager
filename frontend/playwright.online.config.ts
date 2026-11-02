import { defineConfig, devices } from '@playwright/test';

const deployGate = /deploy-gate\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e/online',
  use: { baseURL: 'http://127.0.0.1:4174' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: deployGate },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: deployGate },
    // 서버 전체 게이트를 바꾸므로 다른 프로젝트가 끝난 뒤 혼자 실행한다
    {
      name: 'deploy-gate',
      use: { ...devices['Desktop Chrome'] },
      testMatch: deployGate,
      dependencies: ['chromium', 'webkit'],
      timeout: 150_000,
    },
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
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
