import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test('저장 읽기 무응답은 제한 후 두 선택지, 다시 시도는 기존 게임 복원', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await page.addInitScript(() => {
    const monitor = window as unknown as {
      readHeld: boolean;
      restoreReads: () => void;
      releaseReads: () => void;
    };
    const original = IDBObjectStore.prototype.get;
    const requests: IDBRequest[] = [];
    monitor.restoreReads = () => {
      IDBObjectStore.prototype.get = original;
    };
    monitor.releaseReads = () => {
      for (const r of requests) r.dispatchEvent(new Event('success'));
    };
    IDBObjectStore.prototype.get = function (...args) {
      const r = original.apply(this, args);
      if (this.name === 'slot') {
        monitor.readHeld = true;
        const add = r.addEventListener;
        r.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type === 'success') requests.push(r);
          else add.call(this, type, listener, options);
        };
      }
      return r;
    };
  });
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { readHeld: boolean }).readHeld);
  await page.clock.fastForward(10001);
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '새 토너먼트 시작', exact: true })).toBeVisible();
  // The failure is recorded on the device with its phase so an intermittent error can be reported.
  await page.getByText('오류 정보', { exact: true }).click();
  await expect(page.locator('.error-log pre')).toContainText('게임 읽기 · Error');
  await page.evaluate(() => (window as unknown as { restoreReads: () => void }).restoreReads());
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await openLocal(page);
  await expect(page.locator('.pot strong')).toHaveText('15');
});

test('앱 복귀는 조작권을 재확인하고 다른 창의 게임을 자동 인수하지 않는다', async ({
  page,
  context,
}) => {
  await page.goto('/local/');
  await openLocal(page);
  const other = await context.newPage();
  await other.goto('/local/');
  await other.evaluate(() => {
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (data) {
      if (typeof data === 'object') post.call(this, data);
    };
  });
  await other.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await other.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(other.locator('.seat')).toHaveCount(2);
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: '이 창에서 조작하기', exact: true })).toBeVisible();
});

test('resume 이벤트 후 저장 연결을 다시 열고 진행 게임 복원', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await page.evaluate(() => {
    const original = IDBFactory.prototype.open;
    const monitor = window as unknown as { reopened: number };
    monitor.reopened = 0;
    IDBFactory.prototype.open = function (...args) {
      monitor.reopened++;
      return original.apply(this, args);
    };
  });
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { reopened: number }).reopened))
    .toBeGreaterThan(0);
  await expect(page.locator('.pot strong')).toHaveText('15');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
});

test('초안·기록 UI 재렌더는 저장 연결을 다시 열거나 조작권을 잃지 않는다', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await page.evaluate(() => {
    const original = IDBFactory.prototype.open;
    const monitor = window as unknown as { reopened: number };
    monitor.reopened = 0;
    IDBFactory.prototype.open = function (...args) {
      monitor.reopened++;
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '5칩 추가', exact: true }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('10');
  await page.getByRole('button', { name: '미확정 입력 초기화', exact: true }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('5');
  await page.getByLabel('현재 토너먼트 기록', { exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('HAND 01');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { reopened: number }).reopened)).toBe(0);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '콜 5', exact: true }).click();
  await expect(page.getByRole('button', { name: '체크', exact: true })).toBeVisible();
  await expect(page.locator('.pot strong')).toHaveText('20');
});
