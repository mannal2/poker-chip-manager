import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';

async function expectFitSettled(page: Page) {
  const writes = await page.evaluate(async () => {
    const frames = async () => {
      for (let i = 0; i < 15; i++) await new Promise(requestAnimationFrame);
    };
    await frames();
    let changes = 0;
    const observer = new MutationObserver((records) => (changes += records.length));
    for (const node of [
      document.documentElement,
      ...document.querySelectorAll('main,dialog[open]'),
    ])
      observer.observe(node, { attributes: true, attributeFilter: ['style'] });
    await frames();
    observer.disconnect();
    return changes;
  });
  expect(writes, '화면이 안정된 후에는 크기 스타일을 반복 변경하지 않는다').toBe(0);
}

test('화면 맞춤은 유휴·클릭·회전·창 열기 후 안정된다', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/local/');
  await openLocal(page);
  await expectFitSettled(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expectFitSettled(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectFitSettled(page);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectFitSettled(page);
});

async function contained(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewport = window.visualViewport,
          w = viewport?.width ?? innerWidth,
          h = viewport?.height ?? innerHeight;
        const root = document.documentElement;
        const nodes = [
          ...document.querySelectorAll(
            'main,main button,main input,main .seat,main .dock,dialog[open],dialog[open]:not(.scrollable) button',
          ),
        ];
        return (
          root.scrollWidth <= innerWidth + 1 &&
          root.scrollHeight <= innerHeight + 1 &&
          scrollX === 0 &&
          scrollY === 0 &&
          nodes.every((e) => {
            const r = e.getBoundingClientRect();
            return r.left >= -1 && r.top >= -1 && r.right <= w + 1 && r.bottom <= h + 1;
          }) &&
          [...document.querySelectorAll('dialog[open]:not(.scrollable)')].every(
            (e) => e.scrollHeight <= e.clientHeight + 1,
          )
        );
      }),
    )
    .toBe(true);
}
for (const [width, height] of [
  [320, 568],
  [390, 844],
  [800, 1280],
  [1280, 800],
  [844, 390],
  [667, 375],
  [320, 240],
]) {
  test(`스크롤 없는 화면 맞춤 ${width}x${height} 2~10인·창`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height });
    await page.goto('/local/');
    await contained(page);
    await openLocal(page);
    for (let count = 2; count <= 10; count++) {
      await expect(page.locator('.seat')).toHaveCount(count);
      await contained(page);
      const font = await page
        .locator('.seat')
        .first()
        .evaluate((e) => ({
          name: parseFloat(getComputedStyle(e.querySelector('.name')!).fontSize),
          stack: parseFloat(getComputedStyle(e.querySelector('.stack')!).fontSize),
        }));
      expect(font.stack).toBeCloseTo(font.name, 1);
      if (count < 10) await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
    }
    const box = (await page.locator('main').boundingBox())!;
    if (width > height) expect(box.width).toBeLessThanOrEqual((height * 390) / 560 + 2);
    if (width === 800) expect(box.width).toBeGreaterThan(600);
    await page.mouse.wheel(0, 500);
    await contained(page);
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await contained(page);
    await page.keyboard.press('Escape');
    await page.locator('.seat .card-values').first().click();
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: '다음 핸드 블라인드 설정', exact: true }).click();
    await contained(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
    await contained(page);
    await page.screenshot({ path: `test-results/fit-${width}-${height}.png` });
  });
}
for (const [width, height] of [
  [800, 1280],
  [1280, 800],
  [390, 260],
]) {
  test(`베팅·승자·이름입력 맞춤 ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/local/');
    await openLocal(page);
    await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
    await contained(page);
    await page
      .getByRole('textbox', { name: 'P1 이름 수정', exact: true })
      .fill('가나다라마바사아자차');
    await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).press('Enter');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await contained(page);
    for (let i = 0; i < 8; i++) {
      await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
      await contained(page);
    }
    await expect(page.getByRole('button', { name: 'WIN', exact: true })).toBeVisible();
    await contained(page);
    await page.locator('.seat').first().click();
    await page.getByRole('button', { name: 'WIN', exact: true }).click();
    await expect(page.locator('.meta')).toContainText('02');
    await contained(page);
  });
}
