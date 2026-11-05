import { expect, test } from '@playwright/test';

test('local back returns home before revisiting multiplayer and forward restores the game', async ({
  page,
}) => {
  await page.goto('/online/');
  await page.getByRole('link', { name: '앱 홈으로', exact: true }).click();
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(2);
  await page.goBack();
  await expect(page).toHaveURL(/\/local\/$/);
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.locator('.seat')).toHaveCount(2);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/online\/$/);
});

test('repeated local entry and reload preserve settings and return home on back', async ({
  page,
}) => {
  await page.goto('/local/');
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await page.getByLabel('시작 칩', { exact: true }).fill('1500');
  await page.getByLabel('SB', { exact: true }).focus();
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
  for (let i = 0; i < 2; i++) {
    await page.goBack();
    await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
    await expect(page.getByLabel('시작 칩', { exact: true })).toHaveValue('1500');
  }
  await page.reload();
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
});
