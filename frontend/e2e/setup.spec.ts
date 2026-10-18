import { openLocal } from './helpers';
import { test, expect, type Page } from '@playwright/test';
async function ready(page: Page) {
  await page.goto('/local/');
  await openLocal(page);
}
async function add(page: Page) {
  await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
async function drag(page: Page, from: number, to: number) {
  await page.locator('.seat').nth(from).locator('.card-values').hover();
  const a = (await page.locator('.seat').nth(from).locator('.card-values').boundingBox())!;
  const b = (await page.locator('.seat').nth(to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
test('준비: 2인·인원 버튼·최근 추가 삭제·P3 재사용·복원', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.seat .name')).toHaveText(['P1', 'P2']);
  await expect(page.getByRole('button', { name: '참가자 삭제', exact: true })).toBeDisabled();
  await add(page);
  await expect(page.locator('.pot strong')).toHaveText('3명');
  await drag(page, 2, 0);
  await page.reload();
  await openLocal(page);
  await page.getByRole('button', { name: '참가자 삭제', exact: true }).click();
  await expect(page.locator('.seat .name')).toHaveText(['P2', 'P1']);
  await add(page);
  await expect(page.locator('.seat .name')).toHaveText(['P2', 'P1', 'P3']);
  for (let i = 3; i < 9; i++) await add(page);
  await expect(page.getByRole('button', { name: '참가자 추가', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await expect(page.getByRole('button', { name: '참가자·좌석 설정' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '화면 기준 좌석', exact: true })).toHaveCount(0);
});
test('준비: 단일 탭 D·이름 직접 편집·드래그는 D 변경 없음', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('딜러');
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toHaveText('D · SB');
  await page.locator('.seat .name').nth(1).click();
  await page.getByRole('textbox', { name: 'P2 이름 수정', exact: true }).fill('새이름');
  await page.getByRole('textbox', { name: 'P2 이름 수정', exact: true }).press('Enter');
  await expect(page.locator('.seat').nth(1).locator('.name')).toHaveText('새이름');
  await expect(page.locator('.seat').first().locator('.badge')).toHaveText('D · SB');
  await drag(page, 1, 0);
  await expect(page.locator('.seat').nth(1).locator('.badge')).toHaveText('D · SB');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
});
test('준비: 아래로 드래그해도 화면 기준 고정·회전 버튼은 명수 아래', async ({ page }) => {
  await ready(page);
  for (let i = 2; i < 6; i++) await add(page);
  await drag(page, 2, 0);
  await expect(page.locator('.seat').first().locator('.name')).toHaveText('P3');
  await expect(page.locator('.seat').first()).toHaveCSS('left', /.+/);
  expect(
    await page
      .locator('.seat')
      .first()
      .evaluate((e) => e.style.left),
  ).toBe('50%');
  expect(
    await page
      .locator('.seat')
      .first()
      .evaluate((e) => e.style.top),
  ).toBe('87%');
  const rotate = page.getByRole('button', { name: '화면 기준 한 자리 회전', exact: true });
  const r = (await rotate.boundingBox())!,
    n = (await page.locator('.pot strong').boundingBox())!;
  expect(r.y).toBeGreaterThanOrEqual(n.y + n.height);
  await rotate.click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  expect(
    await page
      .locator('.seat')
      .nth(5)
      .evaluate((e) => e.style.left),
  ).toBe('50%');
  expect(
    await page
      .locator('.seat')
      .nth(5)
      .evaluate((e) => e.style.top),
  ).toBe('87%');
});

for (const width of [320, 390])
  test(`준비: ${width}px 전 인원에서 중앙 조작과 카드 겹침 없음`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await ready(page);
    for (let n = 2; n <= 9; n++) {
      await page.waitForTimeout(220);
      const overlap = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.seat')].map((e) => e.getBoundingClientRect());
        return [...document.querySelectorAll('.count-control,.view-rotate')].some((e) => {
          const a = e.getBoundingClientRect();
          return cards.some(
            (b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
          );
        });
      });
      expect(overlap, `${n}명`).toBe(false);
      if (n < 9) await add(page);
    }
  });

test('준비: 이름 편집·취소된 짧은 이동은 D를 바꾸지 않음', async ({ page }) => {
  await ready(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.locator('.seat .name').nth(1).click();
  await expect(page.getByRole('textbox', { name: 'P2 이름 수정', exact: true })).toBeVisible();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('textbox', { name: 'P2 이름 수정', exact: true }).press('Escape');
  const b = (await page.locator('.seat').nth(1).locator('.card-values').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 15, b.y + b.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
});
test.describe('터치 준비 조작', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('단일 탭 딜러·이름 직접 편집·삭제한 D 미선택·회전 순환', async ({ page }) => {
    await ready(page);
    await add(page);
    await page.locator('.seat .card-values').last().tap();
    await expect(page.locator('.seat').last().locator('.badge')).toContainText('D');
    await page.locator('.seat .name').first().tap();
    await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).fill('터치이름');
    await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).press('Enter');
    await expect(page.locator('.seat .name').first()).toHaveText('터치이름');
    await page.getByRole('button', { name: '참가자 삭제', exact: true }).tap();
    await expect(page.locator('.seat .badge')).toHaveCount(0);
    const before = await page.locator('.seat').first().getAttribute('style');
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '화면 기준 한 자리 회전', exact: true }).tap();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    expect(await page.locator('.seat').first().getAttribute('style')).toBe(before);
  });
});

test('준비: 두 번째 누름 취소 후 다음 탭은 이름 변경 대신 D 선택', async ({ page }) => {
  await ready(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  const card = page.locator('.seat').nth(1);
  await card.locator('.card-values').click();
  const b = (await card.locator('.card-values').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await card.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await card.locator('.card-values').click();
  await expect(card.locator('.badge')).toContainText('D');
  await expect(page.getByRole('dialog', { name: '이름 변경' })).toHaveCount(0);
});
