import { expect, test } from '@playwright/test';

// 혼자 설정한 방에 세 명이 모여 본인 이름과 방장 좌석 변경을 공유한다
test('shares waiting settings, own names, seats and dealer across three participants', async ({
  page,
  browser,
}) => {
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  const code = await page.getByTestId('room-code').textContent();
  await page.getByRole('button', { name: 'Alice 이름 수정', exact: true }).click();
  await page.getByRole('textbox', { name: 'Alice 이름 수정' }).fill('Anna');
  await page.getByRole('textbox', { name: 'Alice 이름 수정' }).press('Enter');
  await expect(page.locator('.seat .name')).toHaveText('Anna');
  await page.getByLabel('시작 칩', { exact: true }).fill('1500');
  await page.getByLabel('SB', { exact: true }).focus();
  await expect(page.locator('.seat .stack')).toHaveText('1,500');
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const guests = [];
    for (const [i, context] of contexts.entries()) {
      const guest = await context.newPage();
      await guest.goto(`/online/?code=${code}`);
      await guest.getByLabel('이름', { exact: true }).fill(['Bob', 'Carol'][i]);
      await guest.getByRole('button', { name: '방 참가', exact: true }).click();
      await expect(
        guest.getByRole('button', { name: ['Bob', 'Carol'][i] + ' 이름 수정', exact: true }),
      ).toBeEnabled();
      await expect(guest.locator('.seat')).toHaveCount(i + 2);
      guests.push(guest);
    }
    const pages = [page, ...guests];
    for (const [i, current] of pages.entries()) {
      await expect(current.locator('.seat')).toHaveCount(3);
      const own = current.locator('.seat').filter({ hasText: ['Anna', 'Bob', 'Carol'][i] });
      expect(await own.evaluate((el) => (el as HTMLElement).style.top)).toBe('87%');
      await expect(current.locator('.seat .name button')).toHaveCount(1);
      await expect(current.getByRole('button', { name: '참가자 추가' })).toHaveCount(0);
    }
    await expect(guests[0].getByLabel('시작 칩', { exact: true })).toBeDisabled();
    await guests[0].locator('.seat .name button').click();
    await guests[0].getByRole('textbox', { name: 'Bob 이름 수정' }).fill('Bobby');
    await guests[0].getByRole('textbox', { name: 'Bob 이름 수정' }).press('Enter');
    for (const current of pages)
      await expect(current.locator('.seat .name').filter({ hasText: 'Bobby' })).toHaveCount(1);
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.toast')).toHaveText('첫 딜러로 시작할 플레이어 카드를 선택하세요.');
    const from = (await page.locator('.seat .card-values').first().boundingBox())!;
    const to = (await page.locator('.seat').nth(2).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    for (const current of pages)
      await expect(current.locator('.seat .name')).toHaveText(['Carol', 'Bobby', 'Anna']);
    await page.locator('.seat .card-values').last().click();
    for (const current of pages)
      await expect(current.locator('.seat').last().locator('.badge')).toHaveText('방장 · D');
    await page.getByRole('button', { name: '초대 링크 복사' }).click();
    await expect(page.locator('.toast')).toHaveText(/복사/);
  } finally {
    for (const context of contexts) await context.close();
  }
});
