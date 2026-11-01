import { expect, test } from '@playwright/test';
import { createRoom } from './managementSupport';

// 같은 세션의 새 탭이 관전으로 시작하고 인수 후 이전 탭의 조작을 막는지 확인한다.
test('a second tab observes until takeover and closing the first preserves presence', async ({ page, context }) => {
  await createRoom(page);
  const second = await context.newPage();
  await second.goto('/online/');
  await expect(second.locator('.seat')).toHaveCount(1);
  await expect(second.getByRole('button', { name: '이 화면에서 이어하기', exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeDisabled();
  await second.getByRole('button', { name: '이 화면에서 이어하기', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '이 화면에서 이어하기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeDisabled();
  await page.close();
  await expect(second.locator('.seat .disconnected')).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeEnabled();
});

// 서버의 세션당 여덟 스트림 한도를 넘는 새로고침도 종료 스트림을 반환하는지 확인한다.
test('repeated document reloads release streams and retain automatic control', async ({ page }) => {
  await createRoom(page);
  for (let reload = 0; reload < 10; reload++) {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '이 화면에서 이어하기', exact: true })).toHaveCount(0);
  }
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeEnabled();
});
