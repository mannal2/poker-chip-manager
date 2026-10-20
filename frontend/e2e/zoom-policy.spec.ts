import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test('확대 입력만 차단하고 일반 휠·편집 입력은 유지', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const prevented = await page.evaluate(() => {
    const send = (event: Event) => !document.dispatchEvent(event);
    return {
      pinchWheel: send(new WheelEvent('wheel', { ctrlKey: true, deltaY: -50, cancelable: true })),
      wheel: send(new WheelEvent('wheel', { deltaY: 50, cancelable: true })),
      zoomKey: send(new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true })),
      macZoom: send(new KeyboardEvent('keydown', { key: '-', metaKey: true, cancelable: true })),
      copy: send(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true })),
      altGr: send(
        new KeyboardEvent('keydown', { key: '+', ctrlKey: true, altKey: true, cancelable: true }),
      ),
      gesture: send(new Event('gesturestart', { cancelable: true })),
      move: send(new Event('touchmove', { cancelable: true })),
    };
  });
  expect(prevented).toEqual({
    pinchWheel: true,
    wheel: false,
    zoomKey: true,
    macZoom: true,
    copy: false,
    altGr: false,
    gesture: true,
    move: false,
  });
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill('이름편집');
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).press('Enter');
  await expect(page.locator('.seat .name').first()).toHaveText('이름편집');
});
