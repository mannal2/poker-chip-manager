import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createRoom, startRoom, confirm } from './managementSupport';

// 각 화면의 서버 상태에서 잔액과 납부액의 총합을 확인한다
async function conserved(pages: Page[]) {
  for (const page of pages) {
    await expect
      .poll(async () => {
        const saved = await page.evaluate(
          () => JSON.parse(localStorage.getItem('online.lastRoom')!).roomId,
        );
        const response = await page.request.get(`/api/rooms/${saved}/state`);
        const state = await response.json();
        return state.game.players.reduce(
          (sum: number, player: { stack: number; H: number }) => sum + player.stack + player.H,
          0,
        );
      })
      .toBe(3000);
  }
}

// 세 명이 전액 베팅으로 정상 종료한 뒤 같은 방에서 재준비하고 두 번째 게임을 시작한다
test('three participants complete a tournament and start another with conserved chips', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const guests: Page[] = [];
    for (const [index, context] of contexts.entries()) {
      const guest = await context.newPage();
      await guest.goto(`/online/?code=${code}`);
      await guest.getByLabel('이름', { exact: true }).fill(['Bob', 'Carol'][index]);
      await guest.getByRole('button', { name: '방 참가', exact: true }).click();
      await expect(
        guest.getByRole('button', { name: `${['Bob', 'Carol'][index]} 이름 수정`, exact: true }),
      ).toBeEnabled();
      guests.push(guest);
    }
    const pages = [page, ...guests];
    await startRoom(page, 3);
    await conserved(pages);
    await page.getByRole('button', { name: '올인', exact: true }).click();
    await page.getByRole('button', { name: 'BET', exact: true }).click();
    await expect(guests[0].locator('.seat.active .name')).toHaveText('Bob');
    await guests[0].getByRole('button', { name: '콜 990', exact: true }).click();
    await expect(guests[1].locator('.seat.active .name')).toHaveText('Carol');
    await guests[1].getByRole('button', { name: '콜 980', exact: true }).click();
    await conserved(pages);
    for (const current of pages) {
      await expect(current.locator('.seat .stack')).toHaveText(['0', '0', '0']);
      await expect(current.locator('.pot strong')).toHaveText('3,000');
    }
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Alice' }) })
      .click();
    await page.getByRole('button', { name: 'WIN', exact: true }).click();
    for (const current of pages) {
      await expect(current.locator('.summary')).toHaveText('토너먼트 종료 · Alice 우승');
      await expect(current.locator('.seat .stack')).toHaveText(['3,000', '0', '0']);
    }
    await conserved(pages);
    await page.getByRole('button', { name: '다시 준비하기', exact: true }).click();
    await confirm(page, '다시 준비하기');
    for (const current of pages) {
      await expect(current.locator('.seat .stack')).toHaveText(['1,000', '1,000', '1,000']);
      await expect(current.locator('.seat .badge')).toHaveText(['방장']);
      await expect(
        current
          .locator('.seat')
          .filter({ has: current.locator('.name', { hasText: 'Alice' }) })
          .locator('.badge'),
      ).toHaveText('방장');
    }
    await startRoom(page, 3);
    for (const current of pages) {
      await expect(current.locator('.seat.active .name')).toHaveText('Alice');
      await expect(current.locator('.seat .stack')).toHaveText(['1,000', '990', '980']);
      await expect(current.locator('.pot strong')).toHaveText('30');
    }
    await conserved(pages);
  } finally {
    for (const context of contexts) await context.close();
  }
});
