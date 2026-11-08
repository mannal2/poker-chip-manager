import { expect, test } from '@playwright/test';
import { createRoom, joinRoom } from './managementSupport';

const BACKEND = 'http://127.0.0.1:8080';

// 배포 준비가 서버 전체 게이트를 닫으므로 다른 스펙이 끝난 뒤 한 번만 실행해 안내와 시작 거절을 확인한다
test('explains a pending server update and refuses to start until it is released', async ({
  page,
  browser,
  request,
}) => {
  const deploymentId = `e2e-${Date.now()}`;
  const code = await createRoom(page);
  const context = await browser.newContext();
  let processId: string | null = null;
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await expect(page.locator('.seat')).toHaveCount(2);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
    // 앞선 스펙이 남긴 진행 방이 사라질 때까지 기다린 뒤 준비한다
    await expect
      .poll(
        async () => {
          const status = await request.get(`${BACKEND}/internal/deploy/status`);
          return (await status.json()).activeTournaments;
        },
        { timeout: 90_000, intervals: [1_000] },
      )
      .toBe(0);
    const prepared = await request.post(`${BACKEND}/internal/deploy/prepare`, {
      data: { deploymentId },
    });
    expect(prepared.ok()).toBe(true);
    const body = await prepared.json();
    expect(body.result).toBe('READY');
    processId = body.processId;

    const notice = '서버 업데이트 중입니다. 방이 사라질 수 있습니다.';
    for (const current of [page, guest]) await expect(current.getByText(notice)).toBeVisible();
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('서버 업데이트가 끝나면 시작할 수 있습니다.');
    await expect(page.locator('.seat.active')).toHaveCount(0);

    const released = await request.post(`${BACKEND}/internal/deploy/release`, {
      data: { deploymentId, processId },
    });
    expect(released.ok()).toBe(true);
    processId = null;
    for (const current of [page, guest]) await expect(current.getByText(notice)).toHaveCount(0);
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.seat.active')).toHaveCount(1);
    await expect(page.getByText(notice)).toHaveCount(0);
  } finally {
    if (processId)
      await request.post(`${BACKEND}/internal/deploy/release`, {
        data: { deploymentId, processId },
      });
    await context.close();
  }
});
