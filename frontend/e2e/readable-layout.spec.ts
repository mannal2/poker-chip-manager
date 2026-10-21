import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

for (const [width, height, minimumFont] of [
  [390, 844, 13],
  [320, 568, 11.5],
  [844, 390, 7.9],
  [800, 1280, 24],
])
  test(`10인 실제 글자 확대와 카드 간격 ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/local/');
    await openLocal(page);
    for (let n = 2; n < 10; n++) {
      await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    const setupTable = (await page.locator('.table').boundingBox())!;
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
    await page.locator('.seat').evaluateAll(async (nodes) => {
      await Promise.all(
        nodes.flatMap((node) => node.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
    });
    await expect
      .poll(() =>
        page
          .locator('.seat .name')
          .first()
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      )
      .toBeGreaterThanOrEqual(minimumFont);
    const table = (await page.locator('.table').boundingBox())!;
    expect(table.width).toBeCloseTo(setupTable.width, 0);
    expect(table.height).toBeCloseTo(setupTable.height, 0);
    const cards = await page.locator('.seat').evaluateAll((nodes) =>
      nodes.map((e) => {
        const r = e.getBoundingClientRect();
        const stack = e.querySelector('.stack')!;
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          font: parseFloat(getComputedStyle(stack).fontSize),
        };
      }),
    );
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i];
      expect(a.font).toBeGreaterThanOrEqual(minimumFont);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.bottom).toBeLessThanOrEqual(height);
      for (const b of cards.slice(i + 1))
        expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
    }
    if (width === 390) expect(table.height).toBeGreaterThan(375);
  });

for (const width of [320, 390])
  test(`베팅은 행동·칩·확정 3줄이며 Clear와 BET는 2대3 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/local/');
    await openLocal(page);
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    const top = (await page.getByRole('button', { name: '폴드', exact: true }).boundingBox())!;
    const chips = await Promise.all(
      [5, 10, 50, 100].map((n) =>
        page.getByRole('button', { name: `${n}칩 추가`, exact: true }).boundingBox(),
      ),
    );
    const clear = (await page.getByRole('button', { name: '미확정 입력 초기화' }).boundingBox())!;
    const bet = (await page.getByRole('button', { name: 'BET', exact: true }).boundingBox())!;
    for (const chip of chips) {
      expect(chip!.y).toBeGreaterThan(top.y + top.height);
      expect(chip!.y + chip!.height).toBeLessThan(clear.y);
      expect(chip!.y).toBeCloseTo(chips[0]!.y, 1);
    }
    expect(clear.y).toBeCloseTo(bet.y, 1);
    expect(bet.width / clear.width).toBeCloseTo(1.5, 1);
    expect(bet.x + bet.width).toBeLessThanOrEqual(width);
  });
