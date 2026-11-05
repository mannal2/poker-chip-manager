import { expect, test } from '@playwright/test';

for (const width of [320, 390, 430])
  for (const phase of ['setup', 'betting', 'result'])
    for (const request of ['single', 'multiple', 'takeover'])
      test(`상단 알림 정렬 ${width}px ${phase} ${request}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(
          `/e2e/design.html?phase=${phase}&request=${request}${phase === 'betting' ? '&pending=1' : ''}`,
        );
        const notice = page.locator('.host-requests');
        await expect(notice).toBeVisible();
        const bounds = await notice.boundingBox();
        const button = await notice.getByRole('button').boundingBox();
        const menu = await page
          .getByRole('button', { name: '관리 메뉴', exact: true })
          .boundingBox();
        const info = await page.locator('.meta-info').boundingBox();
        expect(bounds!.x + bounds!.width / 2).toBeCloseTo(width / 2, 0);
        expect(button!.y + button!.height / 2).toBeCloseTo(menu!.y + menu!.height / 2, 0);
        expect(button!.x).toBeGreaterThanOrEqual(info!.x + info!.width);
        expect(button!.x + button!.width).toBeLessThanOrEqual(menu!.x);
      });
