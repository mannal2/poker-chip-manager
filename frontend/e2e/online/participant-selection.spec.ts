import { expect, test } from '@playwright/test';
import { afterForfeit, createRoom, joinRoom, startRoom, confirm, menu } from './managementSupport';

test('selects a waiting card for kick, cancels confirmation and restores setup controls', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '참가자 내보내기', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('내보낼 플레이어를 선택하세요.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toHaveCount(0);
    await expect(page.locator('.inline-name')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('card-selection.png') });
    const bob = page.locator('.seat').filter({ has: page.locator('.name', { hasText: 'Bob' }) });
    await expect(bob).toBeEnabled();
    await expect(
      page.locator('.seat').filter({ has: page.locator('.name', { hasText: 'Alice' }) }),
    ).toBeDisabled();
    await bob.click();
    await expect(page.getByRole('dialog')).toContainText('Bob님을 방에서 내보내시겠습니까?');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(page.locator('.participant-selection-controls')).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alice 이름 수정', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '참가자 내보내기', exact: true }).click();
    await bob.click();
    await confirm(page, '참가자 내보내기');
    await expect(page.locator('.seat')).toHaveCount(1);
    await expect(guest.getByRole('alert')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('confirms a host transfer by selecting a player card', async ({ page, browser }) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '방장 넘기기', exact: true }).click();
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Bob' }) })
      .click();
    await expect(page.getByRole('dialog')).toContainText('Bob님에게 방장을 넘기시겠습니까?');
    await confirm(page, '방장 넘기기');
    for (const current of [page, guest])
      await expect(
        current
          .locator('.seat')
          .filter({ has: current.locator('.name', { hasText: 'Bob' }) })
          .locator('.badge'),
      ).toHaveText('방장');
    await expect(page.locator('.participant-selection-controls')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('offers a connected forfeit target and exits when that target forfeits meanwhile', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '기권 처리', exact: true }).click();
    await expect(
      page.getByText('기권 처리할 플레이어를 선택하세요.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.bet-top')).toHaveCount(0);
    const bob = page.locator('.seat').filter({ has: page.locator('.name', { hasText: 'Bob' }) });
    await bob.click();
    await expect(page.getByRole('dialog')).toContainText('접속 중인 참가자입니다.');
    await menu(guest, '기권');
    await confirm(guest, '기권');
    await afterForfeit(guest, '방에 남기');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.participant-selection-controls')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveText(
      '대상 또는 상태가 변경되었습니다. 다시 확인하세요.',
    );
  } finally {
    await context.close();
  }
});
