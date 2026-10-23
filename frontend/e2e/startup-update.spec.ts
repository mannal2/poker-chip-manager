import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { openLocal } from './helpers';
async function ready(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = await navigator.serviceWorker.getRegistration('/local/');
          return (
            !!r?.active &&
            !!navigator.serviceWorker.controller &&
            !!(await caches.match('/local/index.html', { ignoreSearch: true }))
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);
}
async function home(page: Page) {
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '홈', exact: true }).click();
}
const file = 'dist/local/sw.js';
test('실행 시 준비된 새 버전 안내·나중에/바깥 닫기·이번 실행 억제·재실행·수동 유지', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const original = await readFile(file, 'utf8');
  try {
    await page.goto('/local/');
    await ready(page);
    await writeFile(file, original + `\n/* startup ${info.project.name} */`);
    await page.reload();
    await ready(page);
    await expect(
      page.getByText('새 버전이 준비되었습니다. 업데이트할까요?', { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: '나중에', exact: true }).click();
    await openLocal(page);
    await home(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: /^앱 업데이트/ }).click();
    await expect(page.getByRole('button', { name: '업데이트하기', exact: true })).toBeVisible();
    await page.mouse.click(3, 3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(page.getByRole('button', { name: '나중에', exact: true })).toBeVisible();
    await page.mouse.click(3, 3);
    await openLocal(page);
    await home(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await writeFile(file, original);
  }
});
test('게임 중 감지는 홈까지 보류, 저장 읽기 실패는 적용 차단, 재시도 후 게임 보존', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const original = await readFile(file, 'utf8');
  try {
    await page.goto('/local/');
    await ready(page);
    await openLocal(page);
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.pot strong')).toHaveText('15');
    await writeFile(file, original + `\n/* startup apply ${info.project.name} */`);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration('/local/'))!.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => !!(await navigator.serviceWorker.getRegistration('/local/'))?.waiting,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await home(page);
    await expect(page.getByRole('button', { name: '나중에', exact: true })).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(() => {
      const old = IDBObjectStore.prototype.get;
      (window as unknown as { restoreGet: () => void }).restoreGet = () => {
        IDBObjectStore.prototype.get = old;
      };
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name === 'slot') throw Error('read failed');
        return old.apply(this, args);
      };
    });
    await page.getByRole('button', { name: '업데이트', exact: true }).click();
    await expect(page.getByText('업데이트를 적용하지 못했습니다.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    await page.evaluate(() => (window as unknown as { restoreGet: () => void }).restoreGet());
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(page.getByRole('button', { name: '업데이트', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '업데이트', exact: true }).click();
    await page.waitForFunction((old) => performance.timeOrigin !== old, origin);
    await ready(page);
    await openLocal(page);
    await expect(page.locator('.pot strong')).toHaveText('15');
  } finally {
    await writeFile(file, original);
  }
});
test('최초 설치·최신·오프라인·확인 오류에서는 자동 안내 없이 사용 가능', async ({
  page,
  context,
}) => {
  await page.goto('/local/');
  await ready(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.addInitScript(() => {
    (window as unknown as { startupChecks: number }).startupChecks = 0;
    ServiceWorkerRegistration.prototype.update = function () {
      (window as unknown as { startupChecks: number }).startupChecks++;
      return Promise.reject(Error('offline check'));
    };
  });
  await page.reload();
  await ready(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { startupChecks: number }).startupChecks))
    .toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openLocal(page);
  await home(page);
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
});

test('실행 확인이 응답하지 않아도 시간 제한 후 조용히 사용, 수동 확인은 독립적으로 복구', async ({
  page,
}) => {
  await page.goto('/local/');
  await ready(page);
  await page.addInitScript(() => {
    const original = ServiceWorkerRegistration.prototype.update;
    (window as unknown as { startupChecks: number }).startupChecks = 0;
    ServiceWorkerRegistration.prototype.update = function () {
      const count = ++(window as unknown as { startupChecks: number }).startupChecks;
      if (count === 1) return new Promise<ServiceWorkerRegistration>(() => {});
      return original.call(this);
    };
  });
  await page.clock.install();
  await page.reload();
  await ready(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { startupChecks: number }).startupChecks))
    .toBeGreaterThan(0);
  await page.clock.fastForward(15001);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible();
});

test('자동 업데이트 적용 중 늦은 설치 제안은 진행창을 바꾸지 않는다', async ({ page }, info) => {
  test.setTimeout(60000);
  const original = await readFile(file, 'utf8');
  try {
    await page.goto('/local/');
    await ready(page);
    await writeFile(file, original + `\n/* install race ${info.project.name} */`);
    await page.reload();
    await ready(page);
    await expect(page.getByRole('button', { name: '업데이트', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.evaluate(() => {
      const original = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (...args) {
        if (args[0]?.type === 'SKIP_WAITING')
          (window as unknown as { releaseUpdate: () => void }).releaseUpdate = () =>
            Reflect.apply(original, this, args);
        else Reflect.apply(original, this, args);
      };
    });
    await page.getByRole('button', { name: '업데이트', exact: true }).click();
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { releaseUpdate?: () => void }).releaseUpdate === 'function',
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })),
    );
    await expect(page.getByText('업데이트하고 있습니다…', { exact: true })).toBeVisible();
    await page.mouse.click(3, 3);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '앱 업데이트', exact: true })).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(() => (window as unknown as { releaseUpdate: () => void }).releaseUpdate());
    await page.waitForFunction((old) => performance.timeOrigin !== old, origin);
  } finally {
    await writeFile(file, original);
  }
});
