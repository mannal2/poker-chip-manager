import { expect, test } from '@playwright/test';
import { createRoom } from './managementSupport';

test('validates recovery inputs before contacting the server', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
  });
  await page.goto('/online/');
  const recover = page.getByRole('button', { name: '기존 플레이어로 복구', exact: true });
  await recover.click();
  await expect(page.getByRole('alert')).toHaveText('이름을 정확히 입력해 주세요.');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await recover.click();
  await expect(page.getByRole('alert')).toHaveText('방 코드를 정확히 입력해 주세요.');
  await page.getByLabel('방 코드', { exact: true }).fill('ABC123');
  await recover.click();
  await expect(page.getByRole('alert')).toHaveText('방 코드를 정확히 입력해 주세요.');
  expect(requests).toEqual([]);
});

test('names the missing player in an existing room', async ({ page, browser }) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const recovery = await context.newPage();
    await recovery.goto(`/online/?code=${code}`);
    await recovery.getByLabel('이름', { exact: true }).fill('Nobody');
    await recovery.getByRole('button', { name: '기존 플레이어로 복구', exact: true }).click();
    await expect(recovery.getByRole('alert')).toHaveText(
      "이 방에 'Nobody' 플레이어가 없습니다.",
    );
    await expect(page.getByRole('button', { name: /복구 신청.*확인/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
