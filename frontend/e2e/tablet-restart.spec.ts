import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

async function playing(page: import('@playwright/test').Page) {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
}

test('손상 저장은 두 선택지, 새 토너먼트 취소·확인·새로고침 복원', async ({ page }) => {
  await playing(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('poker-chip-manager', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('slot', 'readwrite');
    tx.objectStore('slot').put({ schemaVersion: 999 }, 'current');
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '새 토너먼트 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '새 토너먼트 시작', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(2);
  await expect(page.locator('.seat .name')).toHaveText(['P1', 'P2']);
  await expect(page.locator('.seat .badge')).toHaveCount(0);
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.seat .stack')).toHaveText(['1,000', '1,000']);
});

test('복구 화면의 새 토너먼트 쓰기 실패는 기존 게임 보존·다시 시도 가능', async ({ page }) => {
  await playing(page);
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get,
      put = IDBObjectStore.prototype.put;
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => {
      IDBObjectStore.prototype.get = get;
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'slot') throw Error('read failed');
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'slot') throw Error('write failed');
      return put.apply(this, args);
    };
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '새 토너먼트 시작', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('불러오지 못했습니다');
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('15');
});
