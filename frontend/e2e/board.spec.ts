import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';
test('보드 0/3/4/5장과 현재 카드 강조, 팟 위치·CLEAR·무르기', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
  await expect(page.locator('.board-card')).toHaveCount(0);
  await expect(page.getByLabel('미확정 입력 초기화')).toHaveText('CLEAR');
  for (const [street, count, active] of [
    ['FLOP', 3, 3],
    ['TURN', 4, 1],
    ['RIVER', 5, 1],
  ] as const) {
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    await expect(page.locator('.board')).toHaveAttribute('data-street', street);
    await expect(page.locator('.board-card')).toHaveCount(count);
    await expect(page.locator('.board-card.current')).toHaveCount(active);
  }
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.board-card')).toHaveCount(4);
  const table = (await page.locator('.table').boundingBox())!,
    pot = (await page.locator('.pot-strip').boundingBox())!,
    controls = (await page.locator('.bet-top').boundingBox())!;
  expect(pot.y).toBeGreaterThan(table.y);
  expect(pot.y + pot.height).toBeLessThan((await page.locator('.board').boundingBox())!.y);
  expect(pot.y + pot.height).toBeLessThanOrEqual(controls.y + 1);
  await expect(page.locator('.table-center')).not.toContainText(/FLOP|TURN|RIVER/);
});

for (const [width, height] of [
  [320, 568],
  [844, 390],
  [800, 1280],
])
  test(`10인 리버 보드와 카드가 겹치지 않고 화면 안에 배치 ${width}x${height}`, async ({
    page,
  }) => {
    // Plays 30 saved actions through the UI; WebKit takes ~25s under parallel load.
    test.slow();
    await page.setViewportSize({ width, height });
    await page.goto('/local/');
    await openLocal(page);
    for (let n = 2; n < 10; n++) {
      await page.getByLabel('참가자 추가', { exact: true }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
    for (let i = 0; i < 30; i++) {
      await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    await expect(page.locator('.board-card')).toHaveCount(5);
    await page.locator('.board-card').evaluateAll(async (es) => {
      await Promise.all(
        es.flatMap((e) => e.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
    });
    const board = (await page.locator('.board').boundingBox())!;
    for (const seat of await page.locator('.seat').all()) {
      const r = (await seat.boundingBox())!;
      expect(
        r.x + r.width <= board.x ||
          board.x + board.width <= r.x ||
          r.y + r.height <= board.y ||
          board.y + board.height <= r.y,
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
