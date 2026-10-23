import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';
async function start(page: Page, initial?: number) {
  await page.goto('/local/');
  await openLocal(page);
  if (initial) {
    await page.getByLabel('시작 칩', { exact: true }).fill(String(initial));
    await page.getByLabel('SB', { exact: true }).focus();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  }
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
}
const idle = (p: Page) => expect(p.locator('main')).toHaveAttribute('aria-busy', 'false');
test('콜0 BB옵션·각 스트리트는 폴드 차단, 베팅을 받으면 활성', async ({ page }) => {
  await start(page);
  const fold = page.getByRole('button', { name: '폴드', exact: true });
  await expect(fold).toHaveAttribute('aria-disabled', 'false');
  await page.getByRole('button', { name: /^콜 / }).click();
  await idle(page);
  await expect(fold).toHaveAttribute('aria-disabled', 'true');
  const actor = await page.locator('.seat.active').getAttribute('data-player');
  await fold.click({ force: true });
  await expect(page.locator('.seat.active')).toHaveAttribute('data-player', actor!);
  await expect(page.locator('.seat.out')).toHaveCount(0);
  await page.getByRole('button', { name: '체크', exact: true }).click();
  await idle(page);
  for (const street of ['FLOP', 'TURN', 'RIVER']) {
    await expect(page.locator('.board')).toHaveAttribute('data-street', street);
    await expect(fold).toHaveAttribute('aria-disabled', 'true');
    const current = await page.locator('.seat.active').getAttribute('data-player');
    await fold.click({ force: true });
    await expect(page.locator('.seat.active')).toHaveAttribute('data-player', current!);
    await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
    await page.getByRole('button', { name: 'BET', exact: true }).click();
    await idle(page);
    await expect(fold).toHaveAttribute('aria-disabled', 'false');
    await page.getByRole('button', { name: /^콜 / }).click();
    await idle(page);
  }
  await expect(page.locator('.settlement-count')).toBeVisible();
});
test('짧은 올인 콜도 폴드 가능', async ({ page }) => {
  await start(page, 10);
  await expect(page.getByRole('button', { name: '콜 5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '폴드', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
});
