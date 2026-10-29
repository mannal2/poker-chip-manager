import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';

async function start(page: Page) {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

test('조작권 변경은 승자 선택을 폐기하고 다시 인수해도 복원하지 않음', async ({
  page,
  context,
}) => {
  await start(page);
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator('.settlement-count')).toHaveText('승자 선택');
  await page.locator('.seat').first().click();
  await expect(page.locator('.seat.selected')).toHaveCount(1);
  const other = await context.newPage();
  await other.goto('/local/');
  await openLocal(other);
  await expect(page.getByRole('alert')).toContainText('다른 화면');
  await expect(page.locator('.seat.selected')).toHaveCount(0);
  await page.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.settlement-count')).toHaveText('승자 선택');
  await expect(page.locator('.seat.selected')).toHaveCount(0);
});

test('블라인드 폼은 현재값·예약값을 표시하고 검증·닫기 후 초안 폐기를 유지', async ({ page }) => {
  await start(page);
  const open = () =>
    page.getByRole('button', { name: '다음 핸드 블라인드 설정', exact: true }).click();
  const sb = page.getByLabel('다음 SB', { exact: true });
  const bb = page.getByLabel('다음 BB', { exact: true });
  await open();
  await expect(sb).toHaveValue('5');
  await expect(bb).toHaveValue('10');
  await sb.fill('10');
  await page.getByRole('button', { name: '예약', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('0 < SB < BB');
  await bb.fill('20');
  await page.getByRole('button', { name: '예약', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#blinds')).toHaveText('5 / 10 → 10 / 20');
  await open();
  await expect(sb).toHaveValue('10');
  await expect(bb).toHaveValue('20');
  await sb.fill('15');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await open();
  await expect(sb).toHaveValue('10');
  await expect(bb).toHaveValue('20');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await expect(page.locator('#blinds')).toHaveText('10 / 20');
  await open();
  await expect(sb).toHaveValue('10');
  await expect(bb).toHaveValue('20');
});
