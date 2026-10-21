import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';
async function start(page: Page, count = 2) {
  await page.goto('/local/');
  await openLocal(page);
  if (count === 3) {
    await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
    await idle(page);
  }
  await page.getByRole('group', { name: 'P1', exact: true }).locator('.card-values').click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await idle(page);
}
const idle = (page: Page) => expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
async function act(page: Page) {
  await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
  await idle(page);
}
test('일반 쇼다운 기록은 실제 단계 포함, 역순에서 HAND가 마지막', async ({ page }) => {
  await start(page);
  for (let i = 0; i < 8; i++) await act(page);
  await expect(page.locator('.pot small')).toHaveText('POT');
  await page.locator('.seat').first().click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await idle(page);
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  const list = page.locator('.history-list');
  await expect(list.locator('.history-hand')).toHaveText(['HAND 01', 'HAND 02']);
  await expect(list.locator('.history-stage')).toHaveText([
    '프리플랍',
    '플랍',
    '턴',
    '리버',
    '쇼다운',
    '프리플랍',
  ]);
  const texts = await list.locator('li').allTextContents();
  await page.getByRole('button', { name: '최신순 ↓', exact: true }).click();
  await expect(list.locator('li')).toHaveText([...texts].reverse());
  await expect(list.locator('li').last()).toHaveText('HAND 01');
  await page.getByRole('button', { name: '오래된순 ↑', exact: true }).click();
  await expect(list.locator('li')).toHaveText(texts);
});
test('올인 없는 SB폴드+콜은 25 단일팟, 반환과 폴드 종료 표시', async ({ page }) => {
  await start(page, 3);
  await act(page);
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await idle(page);
  for (let i = 0; i < 7; i++) await act(page);
  await expect(page.getByRole('button', { name: 'WIN', exact: true })).toBeVisible();
  await expect(page.locator('.pot strong')).toHaveText('25');
  await expect(page.locator('.pot small')).toHaveText('POT');
  await expect(page.getByRole('button', { name: '다음 팟', exact: true })).toHaveCount(0);
});
test('단계 강조는 시작·전환에만 실행하고 같은 단계 행동으로 재시작하지 않음', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await page.evaluate(() => {
    const monitor = window as unknown as { stageAnimations: string[] };
    monitor.stageAnimations = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.board-card'))
        monitor.stageAnimations.push(this.parentElement?.getAttribute('data-street') ?? '');
      return original.call(this, frames, options);
    };
  });
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await idle(page);
  const calls = () =>
    page.evaluate(() => (window as unknown as { stageAnimations: string[] }).stageAnimations);
  await expect.poll(calls).toEqual([]);
  await act(page);
  expect(await calls()).toEqual([]);
  await act(page);
  await expect.poll(calls).toEqual(['FLOP', 'FLOP', 'FLOP']);
  await act(page);
  expect(await calls()).toEqual(['FLOP', 'FLOP', 'FLOP']);
  await page.reload();
  await openLocal(page);
  expect(
    await page
      .locator('.board-card')
      .evaluateAll((es) => es.flatMap((e) => e.getAnimations()).length),
  ).toBe(0);
});
test('동작 줄이기에서는 단계 강조 애니메이션 생략', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await act(page);
  await act(page);
  expect(
    await page
      .locator('.board-card')
      .evaluateAll((es) => es.flatMap((e) => e.getAnimations()).length),
  ).toBe(0);
});

test('페이지 드래그 텍스트 선택 차단, 설정·이름 입력 선택 유지', async ({ page }) => {
  await page.goto('/local/');
  const title = page.getByRole('heading').first();
  await title.hover();
  const r = (await title.boundingBox())!;
  await page.mouse.move(r.x + 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width - 2, r.y + r.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await openLocal(page);
  const input = page.getByLabel('시작 칩', { exact: true });
  await input.focus();
  await input.press('ControlOrMeta+A');
  expect(
    await input.evaluate((e) => [
      (e as HTMLInputElement).selectionStart,
      (e as HTMLInputElement).selectionEnd,
    ]),
  ).toEqual([0, 4]);
  await input.fill('1500');
  await input.press('Tab');
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
  await page.getByRole('button', { name: 'P1 이름 수정', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'P1 이름 수정', exact: true });
  await name.fill('선택테스트');
  await name.press('ControlOrMeta+A');
  expect(
    await name.evaluate((e) => [
      (e as HTMLInputElement).selectionStart,
      (e as HTMLInputElement).selectionEnd,
    ]),
  ).toEqual([0, 5]);
  await name.press('Escape');
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  const message = page.getByText('아직 기록이 없습니다.', { exact: true });
  const b = (await message.boundingBox())!;
  await page.mouse.move(b.x + 1, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});
test('새 카드 등장 효과는 잠깐 확대 후 원래 크기로 복귀', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const a = original.call(this, frames, options);
      if (this.matches('.board-card')) {
        a.pause();
        a.currentTime = 208;
      }
      return a;
    };
  });
  await act(page);
  await act(page);
  const card = page.locator('.board-card').first();
  expect(
    await card.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a),
  ).toBeGreaterThan(1.05);
  await page
    .locator('.board-card')
    .evaluateAll((es) => es.forEach((e) => e.getAnimations().forEach((a) => a.finish())));
  expect(await card.evaluate((e) => getComputedStyle(e).transform)).toBe('none');
});
