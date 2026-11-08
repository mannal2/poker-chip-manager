import { expect, test, type Page } from '@playwright/test';
import { afterForfeit, confirm, createRoom, menu } from './managementSupport';

// 세 번째 참가자까지 같은 방에 참가시킨다
async function join(page: Page, code: string, name: string, count: number) {
  await page.goto(`/online/?code=${code}`);
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(count);
}

// 세 명이 참가한 방에서 첫 좌석을 딜러로 정하고 시작한다
async function startThree(host: Page) {
  await expect(host.locator('.seat')).toHaveCount(3);
  await expect(host.locator('.seat .disconnected')).toHaveCount(0);
  await host.locator('.seat .card-values').first().click();
  await expect(host.locator('.seat').first().locator('.badge')).toContainText('D');
  await host.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(host.locator('.seat.active')).toHaveCount(1);
}

// 이름으로 좌석 카드를 찾는다
function seat(page: Page, name: string) {
  return page.locator('.seat').filter({ has: page.locator('.name', { hasText: name }) });
}

// 기권 후 나간 참가자는 입장 화면으로 돌아가 다른 방에 참가하고, 남은 게임은 계속된다
test('a player forfeits, leaves, and joins another room', async ({ page, browser }) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();
  try {
    const bob = await bobContext.newPage();
    const carol = await carolContext.newPage();
    await join(bob, code, 'Bob', 2);
    await join(carol, code, 'Carol', 3);
    await startThree(page);

    await menu(carol, '기권');
    await confirm(carol, '기권');
    await afterForfeit(carol, '방 나가기');
    await expect(carol.getByRole('button', { name: '방 참가', exact: true })).toBeVisible();

    for (const current of [page, bob]) {
      await expect(seat(current, 'Carol')).toHaveClass(/out/);
      await expect(current.locator('.seat.active')).toHaveCount(1);
      await expect(current.locator('.summary')).toHaveCount(0);
    }

    const other = await browser.newContext();
    try {
      const owner = await other.newPage();
      const next = await createRoom(owner);
      await join(carol, next, 'Carol', 2);
    } finally {
      await other.close();
    }
  } finally {
    await bobContext.close();
    await carolContext.close();
  }
});

// 방장은 접속 중인 참가자를 기권 처리해 방에 남길 수 있고, 남은 사람은 나중에 스스로 나갈 수 있다
test('the host forfeits a connected player who stays and later leaves', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();
  try {
    const bob = await bobContext.newPage();
    const carol = await carolContext.newPage();
    await join(bob, code, 'Bob', 2);
    await join(carol, code, 'Carol', 3);
    await startThree(page);

    await menu(page, '기권 처리', 'Carol');
    await expect(page.getByRole('dialog')).toContainText('접속 중인 플레이어입니다.');
    await confirm(page, '기권 처리');
    await afterForfeit(page, '방에 남기기');
    await expect(seat(carol, 'Carol')).toHaveClass(/out/);

    await carol.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    const carolMenu = carol.getByRole('dialog');
    await expect(carolMenu.getByRole('button', { name: '기권', exact: true })).toHaveCount(0);
    await carolMenu.getByRole('button', { name: '방 나가기', exact: true }).click();
    await confirm(carol, '방 나가기');
    await expect(carol.getByRole('button', { name: '방 참가', exact: true })).toBeVisible();
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await expect(page.locator('.summary')).toHaveCount(0);
  } finally {
    await bobContext.close();
    await carolContext.close();
  }
});

// 방장은 기권 처리와 동시에 내보낼 수 있고, 탈락자가 생기면 내보내기가 기권 처리 옆에 놓인다
test('the host forfeits and removes a player, then kicks an eliminated one', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();
  const daveContext = await browser.newContext();
  try {
    const bob = await bobContext.newPage();
    const carol = await carolContext.newPage();
    const dave = await daveContext.newPage();
    await join(bob, code, 'Bob', 2);
    await join(carol, code, 'Carol', 3);
    await join(dave, code, 'Dave', 4);
    await expect(page.locator('.seat')).toHaveCount(4);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await page.locator('.seat .card-values').first().click();
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.seat.active')).toHaveCount(1);

    await menu(page, '기권 처리', 'Carol');
    await confirm(page, '기권 처리');
    await afterForfeit(page, '방에서 내보내기');
    await expect(carol.getByRole('alert')).toHaveText('이 화면에서는 더 이상 참가할 수 없습니다. 방장이 내보냈거나 다른 기기에서 자리를 복구했습니다.');
    await expect(seat(page, 'Carol')).toHaveClass(/out/);

    await menu(page, '기권 처리', 'Dave');
    await confirm(page, '기권 처리');
    await afterForfeit(page, '방에 남기기');
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    const row = page.getByRole('dialog').locator('.menu-row');
    await expect(row.getByRole('button')).toHaveText(['기권 처리', '내보내기']);
    const [left, right] = await Promise.all([
      row.getByRole('button', { name: '기권 처리', exact: true }).boundingBox(),
      row.getByRole('button', { name: '내보내기', exact: true }).boundingBox(),
    ]);
    expect(left && right && Math.abs(left.y - right.y) < 1).toBe(true);
    await page.getByRole('dialog').press('Escape');

    await menu(page, '내보내기', 'Dave');
    await expect(dave.getByRole('alert')).toHaveText('이 화면에서는 더 이상 참가할 수 없습니다. 방장이 내보냈거나 다른 기기에서 자리를 복구했습니다.');
    await expect(page.locator('.summary')).toHaveCount(0);
    await expect(bob.locator('.seat.active')).toHaveCount(1);
  } finally {
    await bobContext.close();
    await carolContext.close();
    await daveContext.close();
  }
});
