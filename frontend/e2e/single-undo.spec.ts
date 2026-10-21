import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';
async function start(page: Page) {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
test('마지막 폴드는 확인 없이 다음 핸드, 재접속 후 무르기 한 번', async ({ page }) => {
  await start(page);
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await expect(page.getByLabel('현재 토너먼트 기록', { exact: true })).toContainText('02');
  expect(dialogs).toBe(0);
  await page.reload();
  await openLocal(page);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('현재 토너먼트 기록', { exact: true })).toContainText('01');
  await expect(page.locator('.seat .stack').first()).toHaveText('995');
  await expect(page.getByRole('button', { name: '취소', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByLabel('현재 토너먼트 기록', { exact: true }).click();
  await expect(page.locator('.history-list')).not.toContainText('획득');
  await expect(page.locator('.history-list')).not.toContainText('HAND 02');
});
test('올인 승자 확정 후 종료 화면에서도 무르기', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator('.settlement-count')).toBeVisible();
  await page.locator('.seat').first().click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('.summary')).toContainText('토너먼트 종료');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.settlement-count')).toBeVisible();
  await expect(page.locator('.seat .stack').first()).toHaveText('0');
  await expect(page.getByRole('button', { name: '취소', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('무르기 저장 실패 후 재시도는 이전 승자 초안을 버린다', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator('.settlement-count')).toBeVisible();
  await page.locator('.seat').first().click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('.summary')).toContainText('토너먼트 종료');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'events') throw new DOMException('용량 부족', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('.settlement-count')).toHaveText('0명 선택');
  await page.locator('.seat').last().click();
  await expect(page.locator('.settlement-count')).toHaveText('1명 선택');
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('.summary')).toContainText('P2 우승');
});
