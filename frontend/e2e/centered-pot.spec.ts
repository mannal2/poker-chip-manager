import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';
test('보드는 세번째 자리를 중심으로 고정, 팟은 위, 정산 취소와 WIN은 행동줄 위치 유지', async ({
  page,
}) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
  const undo = page.getByRole('button', { name: '취소', exact: true });
  const before = (await undo.boundingBox())!;
  let positions: number[] = [];
  for (let street = 1; street <= 3; street++) {
    for (let n = 0; n < 2; n++) {
      await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    await page.locator('.board-card').evaluateAll(async (es) => {
      await Promise.all(
        es.flatMap((e) => e.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
    });
    const cards = await page
      .locator('.board-card')
      .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().x));
    if (positions.length) expect(cards.slice(0, 3)).toEqual(positions);
    positions = cards.slice(0, 3);
    const third = (await page.locator('.board-card').nth(2).boundingBox())!,
      table = (await page.locator('.table').boundingBox())!;
    expect(third.x + third.width / 2).toBeCloseTo(table.x + table.width / 2, 0);
  }
  const pot = (await page.locator('.pot-strip').boundingBox())!,
    board = (await page.locator('.board').boundingBox())!;
  expect(pot.y + pot.height).toBeLessThan(board.y);
  for (let n = 0; n < 2; n++) {
    await page.getByRole('button', { name: '체크', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  }
  const after = (await undo.boundingBox())!,
    win = (await page.getByRole('button', { name: 'WIN', exact: true }).boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(after[key]).toBeCloseTo(before[key], 0);
  expect(win.y).toBeCloseTo(after.y, 0);
  expect(win.height).toBeCloseTo(after.height, 0);
  expect(win.width).toBeGreaterThan(after.width * 3);
});
