import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function visibleHeight(page: Page, height?: number) {
  await page.evaluate((value) => {
    const viewport = window.visualViewport!;
    if (value === undefined) Reflect.deleteProperty(viewport, 'height');
    else Object.defineProperty(viewport, 'height', { configurable: true, get: () => value });
    viewport.dispatchEvent(new Event('resize'));
  }, height);
}

async function inputVisible(page: Page, label: string) {
  await expect
    .poll(() =>
      page.getByRole('textbox', { name: label, exact: true }).evaluate((node) => {
        const rect = node.getBoundingClientRect(),
          viewport = window.visualViewport!;
        return (
          rect.top >= viewport.offsetTop && rect.bottom <= viewport.offsetTop + viewport.height
        );
      }),
    )
    .toBe(true);
}

test('키보드 영역 축소는 UI 크기를 유지하고 입력 이동·닫기 복귀', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const before = await page.locator('main').boundingBox();
  const font = await page
    .getByRole('textbox', { name: '시작 칩', exact: true })
    .evaluate((n) => getComputedStyle(n).fontSize);
  await page.getByRole('textbox', { name: '시작 칩', exact: true }).focus();
  await visibleHeight(page, 400);
  await inputVisible(page, '시작 칩');
  expect(
    await page
      .getByRole('textbox', { name: '시작 칩', exact: true })
      .evaluate((n) => getComputedStyle(n).fontSize),
  ).toBe(font);
  expect((await page.locator('main').boundingBox())!.width).toBeCloseTo(before!.width, 1);
  await page.getByRole('textbox', { name: 'SB', exact: true }).focus();
  await inputVisible(page, 'SB');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  expect((await page.locator('main').boundingBox())!.width).toBeCloseTo(before!.width, 1);
  await visibleHeight(page);
  await expect
    .poll(() => page.locator('.setup-fields').evaluate((n) => getComputedStyle(n).translate))
    .toBe('none');
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
});

test('키보드 중 회전은 반영하고 일반 창 높이 변경도 맞춘다', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.getByRole('textbox', { name: 'SB', exact: true }).focus();
  await visibleHeight(page, 400);
  await visibleHeight(page, 150);
  await page.setViewportSize({ width: 844, height: 390 });
  // Overriding visualViewport suppresses WebKit's native resize notification in emulation.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await inputVisible(page, 'SB');
  await expect
    .poll(async () => (await page.locator('main').boundingBox())!.width)
    .toBeLessThan(280);
  const width = (await page.locator('main').boundingBox())!.width;
  await visibleHeight(page);
  await expect
    .poll(async () => (await page.locator('main').boundingBox())!.width)
    .toBeCloseTo(width, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await page.locator('main').boundingBox())!.width)
    .toBeGreaterThan(380);
  await page.setViewportSize({ width: 390, height: 400 });
  await expect
    .poll(async () => (await page.locator('main').boundingBox())!.width)
    .toBeLessThan(300);
});

test('이름 입력과 블라인드 창도 키보드 중 크기·편집 유지', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  const nameFont = await page
    .locator('.seat .name')
    .first()
    .evaluate((e) => getComputedStyle(e).fontSize);
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  await visibleHeight(page, 300);
  await inputVisible(page, 'P1 이름 수정');
  await expect(page.getByRole('textbox', { name: 'P1 이름 수정', exact: true })).toHaveCSS(
    'font-size',
    nameFont,
  );
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill('이름유지');
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).press('Enter');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await visibleHeight(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await page.getByRole('button', { name: '다음 핸드 블라인드 설정', exact: true }).click();
  const before = await page.getByRole('dialog').boundingBox();
  await page.getByRole('textbox', { name: '다음 SB', exact: true }).focus();
  await visibleHeight(page, 300);
  await inputVisible(page, '다음 SB');
  expect((await page.getByRole('dialog').boundingBox())!.width).toBeCloseTo(before!.width, 1);
  await page.getByRole('textbox', { name: '다음 SB', exact: true }).fill('10');
  await page.getByRole('textbox', { name: '다음 BB', exact: true }).fill('20');
  await visibleHeight(page);
  await page.getByRole('button', { name: '예약', exact: true }).click();
  await expect(page.locator('.pending-blinds')).toContainText('10 / 20');
});
