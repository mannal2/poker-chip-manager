import { expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, menu, startRoom } from './managementSupport';

// 이름으로 좌석 카드를 찾는다
function seat(page: Page, name: string) {
  return page.locator('.seat').filter({ has: page.locator('.name', { hasText: name }) });
}

// 진행 중인 방에 새 화면으로 참가를 시도하고 안내에 따라 바이인을 신청한다
async function requestBuyIn(browser: Browser, code: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/online/?code=${code}`);
  await page.getByLabel('내 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  const ask = page.getByRole('dialog', { name: '바이인 신청' });
  await expect(ask).toContainText('게임이 진행 중입니다. 바이인을 신청할까요?');
  await ask.getByRole('button', { name: '바이인 신청', exact: true }).click();
  await expect(page.getByText('바이인 신청을 보냈습니다.')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('방장의 승인을 기다리고 있습니다.');
  return { context, page };
}

// 방장 알림 줄에서 신청을 열고 승인 화면까지 들어간다
async function openApproval(host: Page, name: string) {
  await host.getByRole('button', { name: `${name} 바이인 신청 보기`, exact: true }).click();
  await host
    .getByRole('dialog', { name: '바이인 신청' })
    .getByRole('button', { name: '승인', exact: true })
    .click();
  const dialog = host.getByRole('dialog', { name: '바이인' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// 세 명을 참가시키고 시작한 뒤 첫 핸드의 올인으로 한 명을 탈락시킨다
async function eliminate(host: Page, guests: Page[], loser: string, winner: string) {
  const pages = [host, ...guests];
  await startRoom(host, 3);
  // 세 명 프리플랍은 딜러 Alice부터 행동하고 SB Bob, BB Carol 순서다
  await host.getByRole('button', { name: '올인', exact: true }).click();
  await host.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(guests[0].locator('.seat.active .name')).toHaveText('Bob');
  await guests[0].getByRole('button', { name: '콜 990', exact: true }).click();
  await expect(guests[1].locator('.seat.active .name')).toHaveText('Carol');
  await guests[1].getByRole('button', { name: '폴드', exact: true }).click();
  await seat(host, winner).click();
  await host.getByRole('button', { name: 'WIN', exact: true }).click();
  for (const current of pages)
    await expect(seat(current, loser)).toHaveAttribute('aria-label', / 탈락/);
}

// 세 명이 참가한 방을 만들고 손님 화면을 돌려준다
async function threeInRoom(page: Page, browser: Browser) {
  const code = await createRoom(page);
  const contexts = [await browser.newContext(), await browser.newContext()];
  const guests: Page[] = [];
  for (const [index, context] of contexts.entries()) {
    const guest = await context.newPage();
    const name = ['Bob', 'Carol'][index];
    await guest.goto(`/online/?code=${code}`);
    await guest.getByLabel('내 이름', { exact: true }).fill(name);
    await guest.getByRole('button', { name: '방 참가', exact: true }).click();
    await expect(
      guest.getByRole('button', { name: `${name} 이름 수정`, exact: true }),
    ).toBeEnabled();
    guests.push(guest);
  }
  return { contexts, guests };
}

// 진행 중인 방에 새 플레이어가 바이인을 신청하고 방장이 고른 자리에서 다음 핸드 카드를 받는다
test('a late arrival buys in to the seat the host picks and plays the next hand', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await joinRoom(bob, code);
  await startRoom(page);
  const carol = await requestBuyIn(browser, code, 'Carol');
  try {
    await expect(page.getByRole('region', { name: '방장 알림' })).toContainText(
      'Carol 바이인 신청',
    );
    const dialog = await openApproval(page, 'Carol');
    await expect(dialog).toContainText('Carol · 새 플레이어');
    await expect(dialog).toContainText('시작 칩 1,000을 받고 다음 핸드부터 참여합니다.');
    await dialog.getByRole('combobox', { name: '자리' }).selectOption({ label: 'Alice·Bob 사이' });
    await dialog.getByRole('button', { name: '바이인 승인', exact: true }).click();

    for (const current of [page, bob, carol.page]) {
      await expect(current.locator('.seat')).toHaveCount(3);
      await expect(seat(current, 'Carol')).toHaveAttribute('aria-label', /다음 핸드부터/);
    }
    // 헤즈업 딜러 Alice가 폴드하면 다음 핸드에 Alice 뒤에 앉은 Carol이 버튼을 받는다
    await expect(page.locator('.seat.active .name')).toHaveText('Alice');
    await page.getByRole('button', { name: '폴드', exact: true }).click();
    for (const current of [page, bob, carol.page]) {
      const carolSeat = seat(current, 'Carol');
      await expect(carolSeat).not.toHaveAttribute('aria-label', /다음 핸드부터|버튼 대기/);
      await expect(carolSeat.locator('.badge')).toHaveText('D');
      await expect(carolSeat.locator('.stack')).toHaveText('1,000');
      await expect(current.locator('.seat.active .name')).toHaveText('Carol');
    }
    await expect(page.locator('.seat .name')).toHaveText(['Alice', 'Carol', 'Bob']);
    await expect(carol.page.getByRole('button', { name: '폴드', exact: true })).toBeEnabled();
  } finally {
    await carol.context.close();
    await bobContext.close();
  }
});

// 탈락한 플레이어는 메뉴에서 재입장을 신청하고 승인되면 원래 자리에 두 번째 참가로 앉는다
test('an eliminated player re-enters in the original seat as a second entry', async ({
  page,
  browser,
}) => {
  const { contexts, guests } = await threeInRoom(page, browser);
  try {
    const [bob] = guests;
    await eliminate(page, guests, 'Bob', 'Alice');
    await menu(bob, '바이인');
    await bob.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await expect(bob.getByRole('dialog').getByRole('status')).toHaveText(
      '방장의 승인을 기다리고 있습니다.',
    );
    await expect(
      bob.getByRole('dialog').getByRole('button', { name: '바이인', exact: true }),
    ).toHaveCount(0);
    await bob.keyboard.press('Escape');

    const dialog = await openApproval(page, 'Bob');
    await expect(dialog).toContainText('Bob · 재입장 ×2');
    await expect(dialog).toContainText('원래 자리로 돌아갑니다.');
    await expect(dialog.getByRole('combobox', { name: '자리' })).toHaveCount(0);
    await dialog.getByRole('button', { name: '바이인 승인', exact: true }).click();

    for (const current of [page, ...guests]) {
      await expect(current.locator('.seat')).toHaveCount(3);
      // 첫 카드 전 바이인은 폴드처럼 흐리게 보이지만 탈락이 아니다
      await expect(seat(current, 'Bob')).toHaveAttribute(
        'aria-label',
        'Bob 다음 핸드부터 2번째 참가',
      );
      await expect(seat(current, 'Bob').locator('.entry-count')).toHaveText('×2');
    }
    await expect(page.locator('.seat .name')).toHaveText([/^Alice/, /^Bob/, /^Carol/]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

// 탈락한 방장도 바이인 대화상자에서 재입장을 신청하고 자기 신청을 승인한다
test('an eliminated host asks to re-enter and approves the own request', async ({
  page,
  browser,
}) => {
  const { contexts, guests } = await threeInRoom(page, browser);
  try {
    await eliminate(page, guests, 'Alice', 'Bob');
    await menu(page, '바이인');
    const buyIns = page.getByRole('dialog', { name: '바이인' });
    await expect(buyIns).toContainText('대기 중인 바이인이 없습니다.');
    await buyIns.getByRole('button', { name: '재입장 신청', exact: true }).click();

    const dialog = await openApproval(page, 'Alice');
    await expect(dialog).toContainText('Alice · 재입장 ×2');
    await expect(dialog).toContainText('원래 자리로 돌아갑니다.');
    await dialog.getByRole('button', { name: '바이인 승인', exact: true }).click();

    for (const current of [page, ...guests]) {
      await expect(seat(current, 'Alice')).toHaveAttribute(
        'aria-label',
        /^Alice 다음 핸드부터 2번째 참가/,
      );
      await expect(seat(current, 'Alice').locator('.entry-count')).toHaveText('×2');
    }
    await expect(page.locator('.seat .name')).toHaveText([/^Alice/, /^Bob/, /^Carol/]);
    await expect(seat(page, 'Alice')).toContainText('방장');
  } finally {
    for (const context of contexts) await context.close();
  }
});

// 방장이 거절하면 신청한 화면에 결과를 안내하고 방에는 아무도 더해지지 않는다
test('the host rejects a buy-in request', async ({ page, browser }) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await joinRoom(bob, code);
  await startRoom(page);
  const carol = await requestBuyIn(browser, code, 'Carol');
  try {
    await page.getByRole('button', { name: 'Carol 바이인 신청 보기', exact: true }).click();
    await page
      .getByRole('dialog', { name: '바이인 신청' })
      .getByRole('button', { name: '거절', exact: true })
      .click();
    await expect(carol.page.getByRole('alert')).toHaveText('방장이 바이인 신청을 거절했습니다.');
    await expect(page.locator('.seat .name')).toHaveText(['Alice', 'Bob']);
    await expect(page.getByRole('button', { name: /바이인 신청 보기/ })).toHaveCount(0);
  } finally {
    await carol.context.close();
    await bobContext.close();
  }
});

// 첫 카드 전의 바이인을 방장이 취소하면 그 플레이어는 안내를 보고 입장 화면으로 돌아간다
test('the host cancels a waiting buy-in before its first cards', async ({ page, browser }) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await joinRoom(bob, code);
  await startRoom(page);
  const carol = await requestBuyIn(browser, code, 'Carol');
  try {
    const dialog = await openApproval(page, 'Carol');
    await dialog.getByRole('button', { name: '바이인 승인', exact: true }).click();
    await expect(seat(carol.page, 'Carol')).toHaveAttribute('aria-label', /다음 핸드부터/);

    await menu(page, '바이인');
    const buyIns = page.getByRole('dialog', { name: '바이인' });
    await expect(buyIns.locator('.waiting li')).toHaveText(['Carol바이인 취소']);
    await buyIns.getByRole('button', { name: '바이인 취소', exact: true }).click();
    await expect(buyIns).toContainText('대기 중인 바이인이 없습니다.');

    await expect(carol.page.getByText('바이인이 취소되었습니다.')).toBeVisible();
    await expect(carol.page.getByRole('button', { name: '방 참가', exact: true })).toBeVisible();
    for (const current of [page, bob]) await expect(current.locator('.seat')).toHaveCount(2);
  } finally {
    await carol.context.close();
    await bobContext.close();
  }
});
