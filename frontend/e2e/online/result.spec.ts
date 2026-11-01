import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, startRoom, menu, confirm } from './managementSupport';

// 중단 결과를 공통 요약에 표시하고 재준비 때 이름·좌석·시작 설정과 빈 딜러를 확인한다.
test('aborts and resets while keeping names and seats and restoring initial settings', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    await page.getByRole('button', { name: '다음 핸드 블라인드 설정' }).click();
    await page.getByRole('dialog').getByLabel('다음 SB', { exact: true }).fill('20');
    await page.getByRole('dialog').getByLabel('다음 BB', { exact: true }).fill('40');
    await page.getByRole('button', { name: '예약', exact: true }).click();
    await menu(page, '토너먼트 중단');
    await confirm(page, '토너먼트 중단');
    for (const current of [page, guest])
      await expect(current.locator('.summary')).toHaveText('토너먼트 중단 · 미정산 팟 30 보존');
    await expect(guest.locator('.dock-notice')).toHaveText('방장이 다음 게임을 준비하고 있습니다');
    await expect(guest.getByRole('button', { name: '다시 준비하기', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '다시 준비하기', exact: true }).click();
    await confirm(page, '다시 준비하기');
    for (const current of [page, guest]) {
      await expect(current.locator('.seat .name')).toHaveText(['Alice', 'Bob']);
      await expect(current.locator('.seat .stack')).toHaveText(['1,000', '1,000']);
      await expect(current.locator('.seat .badge')).toHaveCount(0);
      await expect(current.getByLabel('SB', { exact: true })).toHaveValue('10');
      await expect(current.getByLabel('BB', { exact: true })).toHaveValue('20');
    }
    await menu(guest, '방 나가기');
    await expect(guest.getByRole('button', { name: '방 참가', exact: true })).toBeVisible();
    expect(
      await guest.evaluate(() => [
        localStorage.getItem('online.lastRoom'),
        sessionStorage.getItem('online.controlRoom'),
      ]),
    ).toEqual([null, null]);
  } finally {
    await context.close();
  }
});

// 정상 종료 직후 방장의 취소가 두 화면을 진행 상태로 되돌린다.
test('shows a normal winner and permits host undo from the result', async ({ page, browser }) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    await page.getByRole('button', { name: '올인', exact: true }).click();
    await page.getByRole('button', { name: 'BET', exact: true }).click();
    await expect(guest.locator('.seat.active .name')).toHaveText('Bob');
    await guest.getByRole('button', { name: /콜 980/ }).click();
    await expect(page.locator('.settlement-controls')).toBeVisible();
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Alice' }) })
      .click();
    await page.getByRole('button', { name: 'WIN', exact: true }).click();
    for (const current of [page, guest])
      await expect(current.locator('.summary')).toHaveText('토너먼트 종료 · Alice 우승');
    await guest.getByRole('button', { name: '취소', exact: true }).dispatchEvent('click');
    await expect(guest.locator('.toast')).toHaveText('방장만 취소할 수 있습니다');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    for (const current of [page, guest]) {
      await expect(current.locator('.summary')).toHaveCount(0);
      await expect(current.locator('.settlement-controls')).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
