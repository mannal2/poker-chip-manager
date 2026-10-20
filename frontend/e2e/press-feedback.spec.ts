import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test('누름 즉시 강조·350ms 준비·놓기 복귀, 크기와 딜러 탭 유지', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const card = page.getByRole('group', { name: 'P1', exact: true });
  const values = (await card.locator('.card-values').boundingBox())!;
  const before = (await card.boundingBox())!;
  const background = await card.evaluate((n) => getComputedStyle(n).backgroundColor);
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.mouse.move(values.x + values.width / 2, values.y + values.height / 2);
  await page.mouse.down();
  await expect(card).toHaveClass(/pressing/);
  expect(await card.evaluate((n) => getComputedStyle(n).backgroundColor)).not.toBe(background);
  await page.clock.runFor(349);
  await expect(card).not.toHaveClass(/drag-ready/);
  await page.clock.runFor(1);
  await expect(card).toHaveClass(/drag-ready/);
  expect(await card.boundingBox()).toEqual(before);
  await page.mouse.up();
  await expect(card).not.toHaveClass(/pressing|drag-ready|dragging/);
  await page.clock.resume();
  await card.locator('.card-values').click();
  await expect(card.locator('.badge')).toContainText('D');
});

test('취소·추가 포인터·이름 편집에는 누름 상태가 남지 않는다', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const card = page.getByRole('group', { name: 'P1', exact: true });
  const values = (await card.locator('.card-values').boundingBox())!;
  await page.mouse.move(values.x + values.width / 2, values.y + values.height / 2);
  await page.mouse.down();
  await expect(card).toHaveClass(/pressing/);
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: false,
        bubbles: true,
      }),
    ),
  );
  await expect(card).not.toHaveClass(/pressing|drag-ready/);
  await page.mouse.up();
  await page.mouse.down();
  await expect(card).toHaveClass(/pressing/);
  await card.dispatchEvent('pointercancel');
  await expect(card).not.toHaveClass(/pressing|drag-ready/);
  await page.mouse.up();
  await card.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  await expect(card.getByRole('textbox')).toBeFocused();
  await expect(card).not.toHaveClass(/pressing|drag-ready/);
});
