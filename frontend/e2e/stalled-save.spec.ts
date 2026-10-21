import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';

interface Faults {
  held: number;
  restoreEvents: () => void;
  releaseEvents: () => void;
  invalidate: () => void;
}
async function holdSave(page: Page, name = '저장된이름') {
  await page.evaluate(() => {
    const faults = window as unknown as Faults;
    const original = IDBTransaction.prototype.addEventListener;
    const held: Array<() => void> = [];
    let database: IDBDatabase;
    faults.held = 0;
    faults.restoreEvents = () => {
      IDBTransaction.prototype.addEventListener = original;
    };
    faults.releaseEvents = () => {
      held.splice(0).forEach((release) => release());
    };
    faults.invalidate = () => database.dispatchEvent(new Event('close'));
    IDBTransaction.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'complete' && this.mode === 'readwrite' && listener) {
        database = this.db;
        original.call(
          this,
          type,
          (event) => {
            held.push(() => {
              if (typeof listener === 'function') listener.call(this, event);
              else listener.handleEvent(event);
            });
            faults.held++;
          },
          options,
        );
      } else original.call(this, type, listener, options);
    };
  });
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).press('Enter');
  await page.waitForFunction(() => (window as unknown as Faults).held > 0);
}
async function restoreEvents(page: Page) {
  await page.evaluate(() => (window as unknown as Faults).restoreEvents());
}
async function releaseEvents(page: Page) {
  await page.evaluate(() => (window as unknown as Faults).releaseEvents());
}
async function ready(page: Page) {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
async function recoveryScreen(page: Page) {
  await page.evaluate(() => (window as unknown as Faults).invalidate());
  await expect(page.getByText('저장 정보를 불러오지 못했습니다.', { exact: true })).toBeVisible();
  await restoreEvents(page);
}
async function confirmRestart(page: Page) {
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '새 토너먼트 시작', exact: true }).click();
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('poker-chip-manager');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const tx = db.transaction(['slot', 'events', 'control'], 'readonly');
        const saved = tx.objectStore('slot').get('current');
        const events = tx.objectStore('events').getAll();
        const control = tx.objectStore('control').get('owner');
        tx.oncomplete = () =>
          resolve(
            JSON.stringify({ saved: saved.result, events: events.result, control: control.result }),
          );
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}

test('이름 저장 응답 유실은 제한 후 재시도·핸드 시작 1회·늦은 응답 무시', async ({ page }) => {
  await ready(page);
  await page.clock.install();
  await holdSave(page);
  await page.clock.fastForward(8001);
  await expect(page.getByRole('button', { name: '재시도', exact: true })).toBeVisible();
  await restoreEvents(page);
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('.seat .name').first()).toHaveText('저장된이름');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await releaseEvents(page);
  await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.pot strong')).toHaveText('15');
  await expect(page.locator('.meta')).toContainText('01');
});

test('저장 중 연결 종료: 복구 취소는 보존, 확인하면 즉시 새 게임·이전 응답 무시', async ({
  page,
}) => {
  await ready(page);
  await holdSave(page);
  await recoveryScreen(page);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: '새 토너먼트 시작', exact: true }).click();
  await expect(page.getByText('저장 정보를 불러오지 못했습니다.', { exact: true })).toBeVisible();
  await confirmRestart(page);
  await expect(page.locator('.seat .name')).toHaveText(['P1', 'P2']);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await releaseEvents(page);
  await expect(page.locator('.seat .name')).toHaveText(['P1', 'P2']);
  await expect(page.locator('.pot strong')).toHaveText('15');
});

test('저장 대기 중 메뉴 새 토너먼트도 확인 후 복구 가능', async ({ page }) => {
  await ready(page);
  await holdSave(page);
  await restoreEvents(page);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '새 토너먼트', exact: true }).click();
  await expect(page.locator('.seat .name')).toHaveText(['P1', 'P2']);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await releaseEvents(page);
  await expect(page.locator('.seat .name')).toHaveText(['P1', 'P2']);
});

test('복구 교체 쓰기 실패는 이전 이름·기록 보존 후 다시 시도로 복원', async ({ page }) => {
  await ready(page);
  await holdSave(page, '원본보존');
  await recoveryScreen(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'slot') throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await confirmRestart(page);
  await expect(page.getByText('저장 정보를 불러오지 못했습니다.', { exact: true })).toBeVisible();
  expect(await snapshot(page)).toBe(before);
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.seat .name').first()).toHaveText('원본보존');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('프리플랍');
  await releaseEvents(page);
});

test('저장 중 앱 복귀는 완료 제한 후 저장 연결·미확정 요청을 재검증', async ({ page }) => {
  await ready(page);
  await page.clock.install();
  await holdSave(page, '복귀이름');
  await restoreEvents(page);
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  await page.clock.fastForward(8001);
  await expect(page.locator('.seat .name').first()).toHaveText('복귀이름');
  await expect(page.locator('.notice')).toContainText('저장 결과를 확인한 뒤');
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await releaseEvents(page);
});

test('연결 종료 후 저장 제한에 도달해도 재시도는 새 연결에서 같은 요청 확인', async ({ page }) => {
  await ready(page);
  await page.clock.install();
  await holdSave(page, '연결복구');
  await page.evaluate(() => (window as unknown as Faults).invalidate());
  await page.clock.fastForward(8001);
  await expect(page.getByRole('button', { name: '재시도', exact: true })).toBeVisible();
  await restoreEvents(page);
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('.seat .name').first()).toHaveText('연결복구');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await releaseEvents(page);
});
