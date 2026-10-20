import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test('이름 편집이 키 전파를 막아도 확대만 차단하고 복사는 유지', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'P1 이름 수정', exact: true });
  const prevented = await input.evaluate((node) =>
    ['+', '-', '0', 'c'].map((key) => {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(prevented).toEqual([true, true, true, false]);
  await input.fill('이름보존');
  await input.press('Enter');
  await expect(page.locator('.seat .name').first()).toHaveText('이름보존');
});
