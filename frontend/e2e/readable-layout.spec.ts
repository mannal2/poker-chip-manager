import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

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
