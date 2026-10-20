import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test('복원 뒤 사라진 이름 편집 초안은 카드 누름으로 저장되지 않는다', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill('폐기된초안');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.inline-name input')).toHaveCount(0);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await expect(page.locator('.seat .name').first()).toHaveText('P1');
});

test('이름 편집 중 조작권 변경 뒤 인수해도 다른 창의 인원·스택을 덮지 않는다', async ({
  page,
  context,
}) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill('옛초안');
  const other = await context.newPage();
  await other.goto('/local/');
  await openLocal(other);
  await other.getByRole('button', { name: '참가자 추가', exact: true }).click();
  await expect(other.locator('.seat')).toHaveCount(3);
  await expect(other.locator('main')).toHaveAttribute('aria-busy', 'false');
  await other.getByRole('textbox', { name: '시작 칩', exact: true }).fill('1500');
  await other.getByRole('textbox', { name: 'SB', exact: true }).focus();
  await expect(other.locator('.seat .stack').first()).toHaveText('1,500');
  await page.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(3);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await expect(page.locator('.seat')).toHaveCount(3);
  await expect(page.locator('.seat .name').first()).toHaveText('P1');
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.seat')).toHaveCount(3);
  await expect(page.locator('.seat .name').first()).toHaveText('P1');
});
