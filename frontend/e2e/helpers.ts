import { expect, type Page } from '@playwright/test';
export async function openLocal(page: Page) {
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const claim = page.getByRole('button', { name: '이 창에서 조작하기', exact: true });
  if (await claim.isVisible()) {
    await claim.click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  }
}
