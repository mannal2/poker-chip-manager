import { openLocal } from './helpers';
import { test, expect } from '@playwright/test';
async function two(page: import('@playwright/test').Page) {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
}
async function menu(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
}
test('A08 블라인드 예약·마지막 fold 자동 진행·기록·홈 복원·새 게임 재사용', async ({ page }) => {
  await two(page);
  await page.getByRole('button', { name: '다음 핸드 블라인드 설정', exact: true }).click();
  await page.getByLabel('다음 SB', { exact: true }).fill('10');
  await page.getByLabel('다음 BB', { exact: true }).fill('20');
  await page.getByRole('button', { name: '예약', exact: true }).click();
  await expect(page.locator('#blinds')).toHaveText('5 / 10 → 10 / 20');
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await expect(page.locator('.meta')).toContainText('02');
  await expect(page.locator('#blinds')).toHaveText('10 / 20');
  await expect(page.locator('.pot strong')).toHaveText('30');
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toContainText('블라인드 예약');
  await expect(page.getByRole('dialog')).toContainText('폴드');
  await expect(page.getByRole('dialog')).toContainText('획득');
  await expect(page.getByRole('dialog')).not.toContainText('- 0칩 획득');
  await page.mouse.click(3, 3);
  await menu(page);
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.pot strong')).toHaveText('30');
  await menu(page);
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '새 토너먼트', exact: true }).click();
  await expect(page.locator('.pot strong')).toHaveText('30');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '새 토너먼트', exact: true }).click();
  await expect(page.getByLabel('시작 칩', { exact: true })).toHaveValue('1000');
  await expect(page.getByLabel('SB', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('BB', { exact: true })).toHaveValue('10');
});
