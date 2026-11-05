import { test, expect } from '@playwright/test';

for (const width of [320, 390, 430]) {
  test(`승자 선택 안내가 버튼과 겹치지 않는다 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/e2e/design.html?phase=settlement&guest=1');
    const label = page.locator('.settlement-count');
    await expect(label).toHaveText('방장이 승자를 선택하고 있습니다. 0명 선택');
    const bounds = await label.boundingBox();
    const button = await page.getByRole('button', { name: 'WIN', exact: true }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(button!.y);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  });
  for (const count of [2, 6, 10]) {
    test(`연결 끊김과 역할 배지가 겹치지 않는다 ${width}px ${count}명`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/e2e/design.html?n=${count}&disconnected=1`);
      const seat = page.locator('[data-player="p0"]');
      const badge = await seat.locator('.badge').boundingBox();
      const status = await seat.locator('.disconnected').boundingBox();
      expect(badge).not.toBeNull();
      expect(status).not.toBeNull();
      expect(status!.y + status!.height).toBeLessThan(badge!.y);
      expect(status!.y).toBeGreaterThanOrEqual(0);
      expect(badge!.x).toBeGreaterThanOrEqual(0);
      expect(badge!.x + badge!.width).toBeLessThanOrEqual(width);
    });
  }
}
