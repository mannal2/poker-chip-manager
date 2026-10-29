import { openLocal } from './helpers';
import { test, expect, type Page } from '@playwright/test';

const rotate = (page: Page) =>
  page.getByRole('button', { name: '화면 기준 한 자리 회전', exact: true }).click();
const firstSeat = (page: Page) => page.locator('.seat').first().getAttribute('style');

test('화면 회전은 저장 없이 바로 반영되고 새로고침 뒤에도 유지된다', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const unrotated = await firstSeat(page);
  await rotate(page);
  // A screen preference must not go through the save lock.
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const rotated = await firstSeat(page);
  expect(rotated).not.toBe(unrotated);
  await page.reload();
  await openLocal(page);
  expect(await firstSeat(page)).toBe(rotated);
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '현재 토너먼트 기록' })).not.toContainText('회전');
});

test('새 토너먼트는 회전하지 않은 화면에서 시작한다', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const unrotated = await firstSeat(page);
  await rotate(page);
  expect(await firstSeat(page)).not.toBe(unrotated);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '새 토너먼트', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  expect(await firstSeat(page)).toBe(unrotated);
});
