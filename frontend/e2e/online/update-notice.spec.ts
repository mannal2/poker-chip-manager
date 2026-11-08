import { expect, test } from '@playwright/test';
import { createRoom } from './managementSupport';

test('offers a safe refresh and resumes the same participant in the same room', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let changed = false;
  await page.route('**/online/', async (route) => {
    if (route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: changed ? body.replace(/(src="[^"]*online-[^"]+)(")/, '$1?v=new$2') : body,
    });
  });
  const code = await createRoom(page);
  changed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const refresh = page.getByRole('button', { name: '새 버전으로 새로고침', exact: true });
  await expect(refresh).toBeVisible();
  const notice = await refresh.boundingBox();
  const header = await page.locator('.meta').boundingBox();
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(header!.y);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/commands', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Alice 이름 수정', exact: true }).click();
  await page.getByRole('textbox', { name: 'Alice 이름 수정', exact: true }).fill('Updated');
  await page.getByRole('textbox', { name: 'Alice 이름 수정', exact: true }).press('Enter');
  await expect(refresh).toBeDisabled();
  release();
  await expect(page.locator('.seat .name')).toHaveText('Updated');
  await expect(refresh).toBeEnabled();
  changed = false;
  await refresh.click();
  await expect(page.getByTestId('room-code')).toHaveText(code);
  await expect(page.locator('.seat .name')).toHaveText('Updated');
  await expect(refresh).toHaveCount(0);
});
