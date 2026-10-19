import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';
test.use({ hasTouch: true });

test('카드 기본 메뉴 차단, 이름 입력의 편집 메뉴는 유지', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const card = page.locator('.seat').first();
  expect(
    await card.evaluate(
      (e) => !e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    ),
  ).toBe(true);
  await card.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  const input = card.getByRole('textbox');
  expect(
    await input.evaluate(
      (e) => !e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    ),
  ).toBe(false);
  await input.fill('테스트');
  await input.press('Enter');
  await expect(card.locator('.name')).toHaveText('테스트');
});

test('Chrome 실제 터치 조기 이동·길게 누르기·취소 후 탭과 순서 저장', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'CDP 실제 touch는 Chromium 전용');
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(3);
  await page.locator('.seat').evaluateAll(async (nodes) => {
    await Promise.all(
      nodes.flatMap((n) => n.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
  });
  const first = page.getByRole('group', { name: 'P1', exact: true }),
    values = first.locator('.card-values');
  const a = (await values.boundingBox())!,
    target = (await page.getByRole('group', { name: 'P2', exact: true }).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 12, y: start.y }],
  });
  await expect(first).toHaveClass(/dragging/);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: target.x + target.width / 2, y: target.y + target.height / 2 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.seat .name')).not.toHaveText(['P1', 'P2', 'P3']);
  const order = await page.locator('.seat .name').allTextContents();
  const b = (await first.locator('.card-values').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
  });
  await page.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: b.x + b.width / 2 + 5, y: b.y + b.height / 2 }],
  });
  await expect(first).toHaveClass(/dragging/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('.seat.dragging')).toHaveCount(0);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(first.locator('.badge')).toContainText('D');
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.seat .name')).toHaveText(order);
});
