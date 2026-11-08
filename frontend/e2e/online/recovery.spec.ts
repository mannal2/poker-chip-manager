import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, startRoom } from './managementSupport';

// 새 기기의 신청을 승인하면 자리와 칩을 보존하고 기존 연결 권한을 회수한다
test('approves recovery with seat and chips preserved and revokes the old screen', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const oldContext = await browser.newContext();
  const newContext = await browser.newContext();
  try {
    const old = await oldContext.newPage();
    await joinRoom(old, code);
    await startRoom(page);
    const before = await page.locator('.seat .stack').allTextContents();
    const names = await page.locator('.seat .name').allTextContents();
    const recovery = await newContext.newPage();
    await recovery.goto(`/online/?code=${code}`);
    await recovery.getByLabel('이름', { exact: true }).fill('Bob');
    await recovery.getByRole('button', { name: '기존 플레이어로 복구', exact: true }).click();
    await expect(page.getByRole('region', { name: '방장 알림' })).toContainText('Bob');
    await expect(page.locator('.meta .host-requests')).toContainText('Bob');
    await page.reload();
    await page.getByRole('button', { name: 'Bob 복구 신청 보기', exact: true }).click();
    await expect(page.locator('dialog time')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '복구 신청' })).toContainText(
      '기존 플레이어가 맞는지 확인 후 승인하세요.',
    );
    await page.getByRole('button', { name: '복구 승인', exact: true }).click();
    await expect(recovery.locator('.seat')).toHaveCount(2);
    await expect(recovery.locator('.seat .name')).toHaveText(names);
    await expect(recovery.locator('.seat .stack')).toHaveText(before);
    await expect(old.getByRole('alert')).toHaveText('이 화면에서는 더 이상 참가할 수 없습니다. 방장이 내보냈거나 다른 기기에서 자리를 복구했습니다.');
    await expect(page.getByRole('button', { name: '복구 승인', exact: true })).toHaveCount(0);
  } finally {
    await oldContext.close();
    await newContext.close();
  }
});

// 거절한 복구 신청은 새 기기에 결과를 안내하고 기존 자리를 유지한다
test('rejects a recovery request', async ({ page, browser }) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const recovery = await context.newPage();
    await recovery.goto(`/online/?code=${code}`);
    await recovery.getByLabel('이름', { exact: true }).fill('Alice');
    await recovery.getByRole('button', { name: '기존 플레이어로 복구', exact: true }).click();
    await page.getByRole('button', { name: 'Alice 복구 신청 보기', exact: true }).click();
    await page.getByRole('button', { name: '복구 거절', exact: true }).click();
    await expect(recovery.getByRole('alert')).toHaveText('방장이 복구 신청을 거절했습니다.');
    await expect(page.locator('.seat .name')).toHaveText(['Alice']);
  } finally {
    await context.close();
  }
});
