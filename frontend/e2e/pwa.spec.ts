import { openLocal } from './helpers';
import { test, expect, type Page } from '@playwright/test';
async function offlineReady(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration('/local/');
          return {
            active: registration?.active?.state,
            controller: navigator.serviceWorker.controller?.state,
            cached: !!(await caches.match('/local/index.html', { ignoreSearch: true })),
          };
        }),
      { timeout: 15000 },
    )
    .toEqual({ active: 'activated', controller: 'activated', cached: true });
}

test('A09 /local/ 앱 캐시 준비→오프라인 새로고침→이어하기', async ({ page, context }) => {
  await page.goto('/local/');
  await offlineReady(page);
  await openLocal(page);
  await page.locator('.seat .card-values').nth(1).click();
  await expect(page.locator('.seat').nth(1).locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await context.setOffline(true);
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.pot strong')).toHaveText('15');
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator('.pot strong')).toHaveText('20');
  const urls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(urls).toContain('/local/index.html');
  expect(urls).toContain('/local/manifest.webmanifest');
  expect(urls).not.toContain('/local/local/manifest.webmanifest');
  expect(
    urls.some((u) => /^\/(online|api|ws)(\/|$)/.test(u) || u === '/index.html' || u === '/'),
  ).toBe(false);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r?.scope;
  });
  expect(reg).toBe('http://127.0.0.1:4173/local/');
});
import { readFile, writeFile } from 'node:fs/promises';
test('A09 새 SW 대기·홈에서 수동 적용·진행 게임 보존', async ({ page }, info) => {
  test.setTimeout(60000);
  await page.goto('/local/');
  await offlineReady(page);
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  const origin = await page.evaluate(() => performance.timeOrigin),
    file = 'dist/local/sw.js',
    original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original + `\n/* update verification ${info.project.name} */`);
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await expect(page.getByRole('button', { name: '업데이트', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '홈', exact: true }).click();
    await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
    await expect(page.getByText('새 버전이 준비되었습니다.', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    await expect(page.getByRole('button', { name: '업데이트하기', exact: true })).toBeEnabled();
    await page.evaluate(() => {
      const original = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (...args) {
        const send = () => Reflect.apply(original, this, args);
        if (args[0]?.type === 'SKIP_WAITING')
          (window as unknown as { releaseUpdate: () => void }).releaseUpdate = send;
        else send();
      };
    });
    await page.getByRole('button', { name: '업데이트하기', exact: true }).click();
    await expect(page.getByText('업데이트하고 있습니다…', { exact: true })).toBeVisible();
    await page.mouse.click(3, 3);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '앱 업데이트' })).toBeVisible();
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { releaseUpdate?: () => void }).releaseUpdate === 'function',
    );
    await page.evaluate(() => (window as unknown as { releaseUpdate: () => void }).releaseUpdate());

    await page.waitForFunction((previous) => performance.timeOrigin !== previous, origin);
    await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(origin);
    await openLocal(page);
    await expect(page.locator('.pot strong')).toHaveText('15');
  } finally {
    await writeFile(file, original);
  }
});

test('A09 precache 실패를 준비 완료로 표시하지 않는다', async ({ page, context }) => {
  const file = 'dist/local/sw.js',
    original = await readFile(file, 'utf8');
  await writeFile(
    file,
    original.replaceAll('/local/icon-512.png', 'http://127.0.0.1:1/unavailable.png'),
  );
  try {
    await page.goto('/local/');
    await expect(page.getByText(/앱 파일을 저장하지 못했습니다/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('오프라인 준비 완료', { exact: true })).toHaveCount(0);
    await writeFile(file, original);
    await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
    await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await offlineReady(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
  } finally {
    await writeFile(file, original);
  }
});

test('홈 문구 제거·클릭 즉시 확인·최신 안내·바깥 닫기', async ({ page }) => {
  await page.goto('/local/');
  await offlineReady(page);
  await expect(page.getByText('오프라인 준비 완료', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '업데이트 확인', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').click({ position: { x: 15, y: 15 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('오프라인 확인은 최신으로 오인하지 않고 재시도로 복구', async ({ page, context }) => {
  await page.goto('/local/');
  await offlineReady(page);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect(page.getByText('업데이트를 확인하지 못했습니다.', { exact: true })).toBeVisible();
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toHaveCount(0);
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible();
});

test('적용 전 저장 읽기 실패는 업데이트를 시작하지 않고 오류·재시도 제공', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const file = 'dist/local/sw.js',
    original = await readFile(file, 'utf8');
  try {
    await page.goto('/local/');
    await offlineReady(page);
    await openLocal(page);
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '홈', exact: true }).click();
    await writeFile(file, original + '\n/* apply failure ' + info.project.name + ' */');
    await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
    await expect(page.getByRole('button', { name: '업데이트하기', exact: true })).toBeVisible({
      timeout: 15000,
    });
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(() => {
      const originalGet = IDBObjectStore.prototype.get;
      (window as unknown as { restoreGet: () => void }).restoreGet = () => {
        IDBObjectStore.prototype.get = originalGet;
      };
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name === 'slot') throw new Error('read failed');
        return originalGet.apply(this, args);
      };
    });
    await page.getByRole('button', { name: '업데이트하기', exact: true }).click();
    await expect(page.getByText('업데이트를 적용하지 못했습니다.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    await page.evaluate(() => (window as unknown as { restoreGet: () => void }).restoreGet());
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(page.getByRole('button', { name: '업데이트하기', exact: true })).toBeVisible();
    await page.mouse.click(3, 3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await writeFile(file, original);
  }
});

test('확인 중 닫기·재열기·시간초과는 늦은 결과로 덮어쓰지 않음', async ({ page }) => {
  await page.goto('/local/');
  await offlineReady(page);
  await page.clock.install();
  await page.evaluate(() => {
    const monitor = window as unknown as {
      releaseChecks: Array<() => void>;
      completedChecks: number;
    };
    monitor.releaseChecks = [];
    monitor.completedChecks = 0;
    const original = ServiceWorkerRegistration.prototype.update;
    ServiceWorkerRegistration.prototype.update = function () {
      return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
        monitor.releaseChecks.push(() => {
          void original.call(this).then((r) => {
            monitor.completedChecks++;
            resolve(r);
          }, reject);
        });
      });
    };
  });
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { releaseChecks: unknown[] }).releaseChecks.length),
    )
    .toBe(1);
  await page.mouse.click(3, 3);
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { releaseChecks: unknown[] }).releaseChecks.length),
    )
    .toBe(2);
  await page.evaluate(() =>
    (window as unknown as { releaseChecks: Array<() => void> }).releaseChecks[0](),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { completedChecks: number }).completedChecks),
    )
    .toBe(1);
  await expect(page.getByText('업데이트를 확인하고 있습니다…', { exact: true })).toBeVisible();
  await page.clock.fastForward(15001);
  await expect(page.getByText('업데이트를 확인하지 못했습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { releaseChecks: unknown[] }).releaseChecks.length),
    )
    .toBe(3);
  await page.evaluate(() =>
    (window as unknown as { releaseChecks: Array<() => void> }).releaseChecks[2](),
  );
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { releaseChecks: Array<() => void> }).releaseChecks[1](),
  );
});
