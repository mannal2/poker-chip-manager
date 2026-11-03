import { expect, test } from '@playwright/test';

// 실제 서버에서 행동 권한과 잔액 동기화 및 무료 체크 상태를 확인한다
test('only the actor bets and every participant receives confirmed balances', async ({
  page,
  browser,
}) => {
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  const code = await page.getByTestId('room-code').textContent();
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(`/online/?code=${code}`);
    await guest.getByLabel('이름', { exact: true }).fill('Bob');
    await guest.getByRole('button', { name: '방 참가', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Bob 이름 수정', exact: true })).toBeEnabled();
    await expect(page.locator('.seat')).toHaveCount(2);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('.seat').first().locator('.badge')).toHaveText('D · SB');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.seat.active .name')).toHaveText('Alice');
    await expect(page.getByRole('button', { name: '콜 10', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await expect(guest.locator('.dock-notice')).toHaveText('Alice 차례입니다');
    const inactive = guest.getByRole('button', { name: '체크', exact: true });
    await expect(inactive).toHaveAttribute('aria-disabled', 'true');
    await inactive.dispatchEvent('click');
    await expect(guest.locator('.toast')).toHaveText('내 차례가 아닙니다');
    await page.getByRole('button', { name: '콜 10', exact: true }).click();
    for (const current of [page, guest]) {
      await expect(current.locator('.seat .stack')).toHaveText(['980', '980']);
      await expect(current.locator('.pot strong')).toHaveText('40');
    }
    await expect(guest.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await expect(guest.getByRole('button', { name: '폴드', exact: true })).toHaveAttribute(
      'data-unavailable',
      'true',
    );
    await guest.getByRole('button', { name: '50칩 추가', exact: true }).click();
    await expect(page.locator('.seat').last().locator('.stack')).toHaveText('980');
    await guest.getByRole('button', { name: 'BET', exact: true }).click();
    for (const current of [page, guest])
      await expect(current.locator('.seat .stack')).toHaveText(['980', '930']);
  } finally {
    await context.close();
  }
});
