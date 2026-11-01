import { test, expect } from '@playwright/test';

// 독 안내가 로컬 테이블과 버튼 배치의 높이나 위치를 바꾸지 않는지 확인한다
test('독 안내는 테이블과 베팅 독 배치를 유지한다', async ({ page }) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/e2e/design.html?n=6&phase=betting');
    const table = await page.locator('.table').boundingBox();
    const dock = await page.locator('.dock').boundingBox();
    const buttons = await page.locator('.bet-top').boundingBox();
    await page.locator('.dock').evaluate((node) => {
      const notice = document.createElement('div');
      notice.className = 'dock-notice';
      notice.textContent = '지우 차례입니다';
      node.append(notice);
    });
    expect(await page.locator('.table').boundingBox()).toEqual(table);
    expect(await page.locator('.dock').boundingBox()).toEqual(dock);
    expect(await page.locator('.bet-top').boundingBox()).toEqual(buttons);
    const notice = await page.locator('.dock-notice').boundingBox();
    expect(notice!.y + notice!.height).toBeLessThanOrEqual(buttons!.y);
  }
});
