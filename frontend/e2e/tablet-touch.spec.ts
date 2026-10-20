import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';
test.use({ hasTouch: true });

test('브라우저 터치 강조 없이 탭과 키보드 포커스 유지', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const targets = page.locator('.seat, .seat button, .count-control, #menu, input');
  if (await page.evaluate(() => CSS.supports('-webkit-tap-highlight-color', 'transparent')))
    expect(
      await targets.evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            getComputedStyle(node).getPropertyValue('-webkit-tap-highlight-color') ===
            'rgba(0, 0, 0, 0)',
        ),
      ),
    ).toBe(true);
  await page.getByRole('button', { name: '참가자 추가', exact: true }).tap();
  await expect(page.locator('.seat')).toHaveCount(3);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
});

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

test('Chrome 이름 입력 중 터치를 유지하면 같은 카드 드래그로 전환', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'CDP 실제 touch는 Chromium 전용');
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).tap();
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill('터치이름');
  const card = page.locator('.seat[data-player="p0"]');
  const a = (await card.locator('.card-values').boundingBox())!;
  const b = (await page.locator('.seat').nth(1).boundingBox())!;
  const before = await card.evaluate((e) => (e as HTMLElement).style.top);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }],
  });
  await expect(card).toHaveClass(/drag-ready/);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
  });
  await expect(card).toHaveClass(/dragging/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(card.locator('.name')).toHaveText('터치이름');
  expect(await card.evaluate((e) => (e as HTMLElement).style.top)).not.toBe(before);
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
