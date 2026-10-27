import { readFileSync, readdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/** /assets/ files a built HTML page links, and every chunk those files import in turn. */
function assetsReachedFrom(html: string) {
  const reached = new Set<string>();
  const pending = [...readFileSync(`dist/${html}`, 'utf8').matchAll(/"\/assets\/([^"]+)"/g)].map(
    (m) => m[1],
  );
  while (pending.length) {
    const file = pending.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    if (!file.endsWith('.js')) continue;
    for (const m of readFileSync(`dist/assets/${file}`, 'utf8').matchAll(
      /["'`]\.\/([\w.-]+\.js)["'`]/g,
    ))
      pending.push(m[1]);
  }
  return reached;
}

test.describe('빌드 결과물', () => {
  // Reads dist/ only, so it does not depend on the browser; run it once.
  test.skip(({ browserName }) => browserName !== 'chromium', '브라우저와 무관한 파일 검사');
  test('서비스 워커는 로컬이 실제로 불러오는 파일만 정확히 저장한다', () => {
    const precached = new Set(
      [...readFileSync('dist/local/sw.js', 'utf8').matchAll(/url:"\/assets\/([^"]+)"/g)].map(
        (m) => m[1],
      ),
    );
    const local = assetsReachedFrom('local/index.html');
    // Nothing the local app needs is missing, so it still opens offline...
    expect([...local].filter((file) => !precached.has(file))).toEqual([]);
    // ...and nothing else is stored: no home/online-only files, no test harness files.
    expect([...precached].filter((file) => !local.has(file))).toEqual([]);
    const otherOnly = [
      ...assetsReachedFrom('index.html'),
      ...assetsReachedFrom('online/index.html'),
    ].filter((file) => !local.has(file));
    expect(otherOnly.length).toBeGreaterThan(0);
    for (const file of otherOnly) expect(precached.has(file), file).toBe(false);
    const built = new Set(readdirSync('dist/assets'));
    for (const file of precached) expect(built.has(file), file).toBe(true);
  });
});

test('루트 주소는 앱 홈으로 이동한다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/local\/$/);
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
});

test('온라인 화면은 로컬 코드를 받지 않고 서비스 워커 제어도 받지 않는다', async ({ page }) => {
  // Visit the local app first so its service worker is installed, then switch pages.
  await page.goto('/local/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.goto('/online/');
  await expect(page.getByRole('heading', { name: '멀티플레이 모드 · 준비 중' })).toBeVisible();
  await expect(page.getByRole('link', { name: '앱 홈으로' })).toHaveAttribute('href', '/local/');
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  expect(requested.filter((path) => /^\/assets\/(local|workbox)/.test(path))).toEqual([]);
  expect(requested.some((path) => /^\/assets\/online-/.test(path))).toBe(true);
});
