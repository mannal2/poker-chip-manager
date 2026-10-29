import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test('기록 조회 실패를 표시하고 다시 열면 정상 조회', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('group', { name: 'P1', exact: true }).locator('.card-values').click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.openCursor;
    let fail = true;
    IDBObjectStore.prototype.openCursor = function (...args) {
      if (this.name === 'events' && fail) {
        fail = false;
        throw new Error('history-read-failed');
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('history-read-failed');
  await expect(page.getByText('기록 불러오는 중…', { exact: true })).toHaveCount(0);
  await expect(page.getByText('아직 기록이 없습니다.', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('HAND 01');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
