import { expect, test } from '@playwright/test';

// 실제 서버에서 방을 만들고 다른 기기가 소문자 코드로 참가하는지 확인한다
test('creates a room and joins with a lowercase invite code', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  const code = await page.getByTestId('room-code').textContent();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(`/online/?code=${code!.toLowerCase()}`);
    await expect(guest.getByLabel('방 코드', { exact: true })).toHaveValue(code!);
    await guest.getByLabel('이름', { exact: true }).fill('Bob');
    await guest.getByRole('button', { name: '방 참가', exact: true }).click();
    await expect(guest.getByTestId('room-code')).toHaveText(code!);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
// 없는 방의 오류가 입력 화면에 남는지 확인한다
test('shows a missing room rejection', async ({ page }) => {
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByLabel('방 코드', { exact: true }).fill('AAAAAA');
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('방을 찾을 수 없습니다.');
  await expect(page.getByRole('button', { name: '방 참가', exact: true })).toBeEnabled();
});
// 홈 이동이 새 문서 탐색으로 온라인 경로를 여는지 확인한다
test('navigates from app home using a document request', async ({ page }) => {
  await page.goto('/local/');
  const navigation = page.waitForRequest(
    (request) => request.isNavigationRequest() && new URL(request.url()).pathname === '/online/',
  );
  await page.getByRole('button', { name: '멀티플레이 모드', exact: true }).click();
  await navigation;
  await expect(page).toHaveURL(/\/online\/$/);
  await expect(page.getByRole('heading', { name: '멀티플레이 모드', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
