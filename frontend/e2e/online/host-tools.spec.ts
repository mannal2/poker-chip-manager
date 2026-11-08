import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, startRoom, menu, confirm } from './managementSupport';

// 대기방 내보내기와 직접 방장 이전을 실제 두 세션에서 검증한다
test('kicks a waiting participant and transfers the host', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  const diagnostics: { url: string; status: number; body: unknown }[] = [];
  let guest;
  try {
    guest = await context.newPage();
    // 신규 참가 실패 시 자동 복귀와 참가 요청의 실제 응답을 함께 보관한다
    guest.on('response', async (response) => {
      if (response.url().includes('/api/'))
        diagnostics.push({
          url: response.url(),
          status: response.status(),
          body: await response.json().catch(() => null),
        });
    });
    await joinRoom(guest, code);
    await menu(page, '참가자 내보내기', 'Bob');
    await expect(guest.getByRole('alert', { name: '' })).toBeVisible();
    await expect(page.locator('.seat')).toHaveCount(1);
    await guest.goto(`/online/?code=${code}`);
    // 이전 참가 자격의 자동 복귀가 끝난 뒤 신규 참가 정보를 입력한다
    await expect(guest.getByRole('alert')).toHaveText('방을 찾을 수 없습니다.');
    await guest.getByLabel('이름', { exact: true }).fill('Bob');
    await guest.getByRole('button', { name: '방 참가', exact: true }).click();
    await expect(page.locator('.seat')).toHaveCount(2);
    await menu(page, '방장 넘기기', 'Bob');
    for (const current of [page, guest]) {
      await expect(
        current.locator('.seat').filter({ hasText: 'Bob' }).locator('.badge'),
      ).toHaveText('방장');
      await expect(
        current.locator('.seat').filter({ hasText: 'Alice' }).locator('.badge'),
      ).toHaveCount(0);
    }
    await expect(guest.getByRole('button', { name: '게임 시작', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await menu(guest, '방장 넘기기', 'Alice');
    await menu(page, '홈');
    await expect(page).toHaveURL(/\/local\/$/);
    await page.goto('/online/');
    await expect(page.locator('.seat')).toHaveCount(2);
  } finally {
    if (guest)
      await testInfo.attach('kick-rejoin-diagnostics', {
        body: JSON.stringify({
          responses: diagnostics,
          html: await guest.locator('main').innerHTML(),
          storage: await guest.evaluate(() => ({
            local: { ...localStorage },
            tab: { ...sessionStorage },
          })),
        }),
        contentType: 'application/json',
      });
    await context.close();
  }
});

// 본인 기권은 방장 이전 안내를 거치며 마지막 생존자에게 칩이 지급된다
test('forfeits self after host transfer and distributes chips at hand end', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    await menu(page, '기권');
    await expect(page.locator('.toast')).toHaveText('먼저 방장을 넘겨주세요');
    await page.getByRole('dialog').press('Escape');
    await menu(page, '방장 넘기기', 'Bob');
    await menu(page, '기권');
    await confirm(page, '기권');
    for (const current of [page, guest]) {
      await expect(current.locator('.summary')).toHaveText('토너먼트 종료 · Bob 우승');
      await expect(
        current.locator('.seat').filter({ hasText: 'Bob' }).locator('.stack'),
      ).toHaveText('2,000');
      await expect(current.locator('.seat').filter({ hasText: 'Alice' })).toHaveClass(/out/);
    }
    await guest.getByRole('button', { name: '현재 토너먼트 기록' }).click();
    await expect(guest.getByRole('dialog')).toContainText('기권');
    await expect(guest.getByRole('dialog')).toContainText('기권 칩');
  } finally {
    await context.close();
  }
});

// 끊긴 참가자만 방장이 대신 기권 처리할 수 있다
test('forfeits a disconnected participant', async ({ page, browser }) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await joinRoom(guest, code);
  await startRoom(page);
  await context.close();
  await expect(page.locator('.seat .disconnected')).toHaveCount(1);
  await menu(page, '기권 처리', 'Bob');
  await confirm(page, '기권 처리');
  await expect(page.locator('.summary')).toHaveText('토너먼트 종료 · Alice 우승');
  await expect(page.locator('.seat').filter({ hasText: 'Alice' }).locator('.stack')).toHaveText(
    '2,000',
  );
});

// 명시적으로 끊긴 방장의 실제 60초 경과 뒤 인수 요청이 새로고침에도 유지된다
test('takes host after a real 60 second disconnection', { tag: '@slow' }, async ({ browser }) => {
  test.slow();
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const code = await createRoom(host);
    const guest = await guestContext.newPage();
    await joinRoom(guest, code);
    await startRoom(host);
    await hostContext.close();
    await expect(guest.getByRole('button', { name: '방장 맡기', exact: true })).toBeVisible({
      timeout: 75_000,
    });
    await guest.reload();
    await guest.getByRole('button', { name: '방장 맡기', exact: true }).click();
    await menu(guest, '토너먼트 중단');
    await confirm(guest, '토너먼트 중단');
    await expect(guest.getByTestId('room-code')).toBeVisible();
    await expect(guest.locator('.summary')).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

// 핸드 도중 기권자의 스택을 유지하고 핸드 종료 뒤에만 생존자에게 분배한다
test('defers forfeited stack distribution until the current hand ends', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const bobContext = await browser.newContext();
  const carolContext = await browser.newContext();
  try {
    const bob = await bobContext.newPage();
    await joinRoom(bob, code);
    const carol = await carolContext.newPage();
    await carol.goto(`/online/?code=${code}`);
    await carol.getByLabel('이름', { exact: true }).fill('Carol');
    await carol.getByRole('button', { name: '방 참가', exact: true }).click();
    await startRoom(page, 3);
    await menu(bob, '기권');
    await confirm(bob, '기권');
    for (const current of [page, bob, carol]) {
      await expect(
        current.locator('.seat').filter({ hasText: 'Bob' }).locator('.stack'),
      ).toHaveText('990');
      await expect(current.locator('.seat').filter({ hasText: 'Bob' })).toHaveClass(/out/);
      await expect(
        current.locator('.seat').filter({ hasText: 'Alice' }).locator('.stack'),
      ).toHaveText('1,000');
    }
    await page.getByRole('button', { name: '폴드', exact: true }).click();
    for (const current of [page, bob, carol]) {
      await expect(current.locator('.seat .stack')).toHaveText(['1,475', '0', '1,495']);
      await expect(current.locator('.pot strong')).toHaveText('30');
    }
    await page.getByRole('button', { name: '현재 토너먼트 기록' }).click();
    await expect(page.getByRole('dialog')).toContainText('기권 칩 495칩 획득');
  } finally {
    await bobContext.close();
    await carolContext.close();
  }
});

// 내보내진 동일 브라우저에서 자동 복귀가 끝난 뒤 신규 참가가 가능한지 확인한다
test('rejoins from the same kicked browser screen', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await menu(page, '참가자 내보내기', 'Bob');
    await expect(guest.getByRole('alert')).toHaveText('이 화면의 참가 권한이 회수되었습니다.');
    const responses: { url: string; status: number; body: unknown }[] = [];
    guest.on('response', async (response) => {
      if (response.url().includes('/api/'))
        responses.push({
          url: response.url(),
          status: response.status(),
          body: await response.json().catch(() => null),
        });
    });
    await guest.goto(`/online/?code=${code}`);
    await expect(guest.getByRole('alert')).toHaveText('방을 찾을 수 없습니다.');
    await guest.getByLabel('이름', { exact: true }).fill('Bob');
    await guest.getByRole('button', { name: '방 참가', exact: true }).click();
    try {
      await expect(page.locator('.seat')).toHaveCount(2);
    } finally {
      await testInfo.attach('rejoin-diagnostics', {
        body: JSON.stringify({
          responses,
          html: await guest.locator('main').innerHTML(),
          storage: await guest.evaluate(() => ({
            local: { ...localStorage },
            tab: { ...sessionStorage },
          })),
        }),
        contentType: 'application/json',
      });
    }
  } finally {
    await context.close();
  }
});
