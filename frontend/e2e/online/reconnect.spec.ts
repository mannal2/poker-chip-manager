import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, startRoom } from './managementSupport';
import type { Page } from '@playwright/test';

// 실제로 렌더링된 짧은 알림을 기록하여 뒤따른 화면 갱신과 표시 시간에 의존하지 않는다
async function observeNotices(page: Page) {
  await page.evaluate(() => {
    document.body.dataset.notices = '[]';
    new MutationObserver(() => {
      const text = document.querySelector('.toast')?.textContent;
      if (text)
        document.body.dataset.notices = JSON.stringify([
          ...JSON.parse(document.body.dataset.notices!),
          text,
        ]);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

// 오프라인 행동을 차단하고 상대 화면의 끊김·자동 행동 및 복귀 상태를 확인한다
test('offline locks actions, exposes automatic play and restores fresh state', async ({
  page,
  browser,
}) => {
  let hold = false;
  const delayed: (() => void)[] = [];
  await page.routeWebSocket('**/ws', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (hold) delayed.push(() => socket.send(message));
      else socket.send(message);
    });
  });
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    const observer = await page.context().newPage();
    await observer.goto('/online/');
    await expect(
      observer.getByRole('button', { name: '이 화면에서 이어하기', exact: true }),
    ).toBeVisible();
    await expect(observer.locator('.seat.active .name')).toHaveText('Alice');
    await observeNotices(page);
    await observeNotices(observer);
    await context.setOffline(true);
    await expect(guest.getByRole('status').filter({ hasText: '재연결 중' })).toBeVisible();
    await expect(guest.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(
      page.locator('.seat').filter({ hasText: 'Bob' }).locator('.disconnected'),
    ).toBeVisible();
    await expect(observer.locator('.seat .disconnected')).toHaveCount(1);
    hold = true;
    await page.getByRole('button', { name: '콜 10', exact: true }).click();
    await expect(page.locator('.seat .stack')).toHaveText(['980', '980']);
    await expect.poll(() => delayed.length).toBeGreaterThan(0);
    hold = false;
    delayed.splice(0).forEach((send) => send());
    for (const current of [page, observer])
      await expect(current.locator('body')).toHaveAttribute('data-notices', /Bob - 체크\(자동\)/);
    await context.setOffline(false);
    await expect(guest.getByRole('status').filter({ hasText: '재연결 중' })).toHaveCount(0);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await expect(guest.locator('.seat .stack')).toHaveText(['980', '980']);
    await expect(page.locator('.seat.active .name')).toHaveText('Alice');
    await page.getByRole('button', { name: '체크', exact: true }).click();
    await expect(guest.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await guest.getByRole('button', { name: '체크', exact: true }).click();
    await expect(page.locator('.seat.active .name')).toHaveText('Alice');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    for (const current of [page, observer])
      await expect(current.locator('body')).toHaveAttribute(
        'data-notices',
        /방장이 Bob의 체크를 취소했습니다/,
      );
  } finally {
    await context.close();
  }
});

// 실제 서버의 대기방 유예(e2e 프로필 5초, 운영 5분) 안 복귀는 자리를 유지하고 유예 이후에는 명단에서 제거한다
test('waiting-room reconnection preserves the seat only within the grace', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.locator('.seat .disconnected')).toHaveCount(1);
    await context.setOffline(false);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await expect(page.locator('.seat .name')).toHaveText(['Alice', 'Bob']);
    await context.setOffline(true);
    await expect(page.locator('.seat .disconnected')).toHaveCount(1);
    await expect(page.locator('.seat .name')).toHaveText(['Alice'], { timeout: 10_000 });
    await context.setOffline(false);
    await expect(guest.getByRole('alert')).toHaveText('이 화면에서는 더 이상 참가할 수 없습니다. 방장이 내보냈거나 다른 기기에서 자리를 복구했습니다.');
  } finally {
    await context.close();
  }
});

// 서버가 확정한 뒤 응답만 유실된 명령을 재연결 원장 조회로 한 번만 반영한다
test('a committed request with a lost response deducts chips exactly once after reconnect', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    let requestId = '';
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/commands') && request.method() === 'POST')
        requests.push(request.postData()!);
    });
    await page.route(
      '**/api/rooms/*/commands',
      async (route) => {
        const body = route.request().postDataJSON();
        requestId = body.requestId;
        const committed = await route.fetch();
        expect((await committed.json()).outcome).toBe('APPLIED');
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: '콜 10', exact: true }).click();
    await expect(guest.locator('.seat .stack')).toHaveText(['980', '980']);
    await expect(page.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.context().setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: '재연결 중' })).toBeVisible();
    const lookup = page.waitForResponse((response) =>
      response.url().endsWith(`/requests/${requestId}`),
    );
    await page.context().setOffline(false);
    expect((await (await lookup).json()).outcome).toBe('APPLIED');
    await expect(page.getByRole('status').filter({ hasText: '재연결 중' })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await guest.getByRole('button', { name: '체크', exact: true }).click();
    for (const current of [page, guest]) {
      await expect(current.locator('.seat .stack')).toHaveText(['980', '980']);
      await expect(current.locator('.pot strong')).toHaveText('40');
    }
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]).requestId).toBe(requestId);
  } finally {
    await context.close();
  }
});

// 차례가 확정된 순간 새로고침하면 같은 차례와 최신 잔액을 복원하고 입력 초안을 버린다
test('refresh on the actor turn clears the betting draft and restores control', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    await page.getByRole('button', { name: '콜 10', exact: true }).click();
    await expect(guest.locator('.seat.active .name')).toHaveText('Bob');
    await guest.getByRole('button', { name: '50칩 추가', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'BET', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await guest.reload();
    await expect(guest.getByRole('status').filter({ hasText: '재연결 중' })).toHaveCount(0);
    const roomId = await guest.evaluate(
      () => JSON.parse(localStorage.getItem('online.lastRoom')!).roomId,
    );
    const state = await (await guest.request.get(`/api/rooms/${roomId}/state`)).json();
    const actor = state.game.players.find(
      (player: { id: string }) => player.id === state.game.hand.actorId,
    ).name;
    await expect(guest.locator('.seat.active .name')).toHaveText(actor);
    await expect(guest.locator('.seat .stack')).toHaveText(['980', '980']);
    await expect(guest.getByRole('button', { name: 'BET', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    if (actor === 'Alice') {
      await page.getByRole('button', { name: '체크', exact: true }).click();
      await expect(guest.locator('.seat.active .name')).toHaveText('Bob');
    }
    await expect(guest.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await guest.getByRole('button', { name: '체크', exact: true }).click();
    await expect(page.locator('.pot strong')).toHaveText('40');
  } finally {
    await context.close();
  }
});

// 콜 차례에 복귀한 참가자는 새 구독이 지연되어도 서버에서 폴드되지 않는다
test('visible actor retains presence while its replacement subscription is delayed', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    const call = page.getByRole('button', { name: '콜 10', exact: true });
    await expect(call).toHaveAttribute('aria-disabled', 'false');
    let subscribe: (() => void) | undefined;
    // 교체 소켓의 구독 메시지만 보관하여 서버의 자리 등록을 늦춘다
    await page.routeWebSocket('**/ws', (socket) => {
      const server = socket.connectToServer();
      // 구독 전송 시점을 테스트가 결정하고 나머지 메시지는 즉시 전달한다
      socket.onMessage((message) => {
        if (JSON.parse(message.toString()).type === 'SUBSCRIBE')
          // 늦춘 구독 메시지를 서버로 전달한다
          subscribe = () => server.send(message);
        else server.send(message);
      });
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => Boolean(subscribe)).toBe(true);
    await expect(call).toHaveAttribute('aria-disabled', 'true');
    await expect(guest.locator('.seat.active .name')).toHaveText('Alice');
    await expect(guest.locator('.seat .stack')).toHaveText(['990', '980']);
    await expect(guest.locator('.pot strong')).toHaveText('30');
    subscribe!();
    await expect(call).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('.seat .stack')).toHaveText(['990', '980']);
    await call.click();
    await expect(guest.locator('.seat.active .name')).toHaveText('Bob');
    await expect(guest.locator('.pot strong')).toHaveText('40');
  } finally {
    await context.close();
  }
});
// 닫힘 이벤트 없이 메시지가 멎은 소켓도 화면 복귀 시 교체하고 세션을 갱신한다
test('visibility return replaces a silently dead socket and resumes server updates', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    await guest.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // 새 소켓의 수신만 차단하여 브라우저에 종료 이벤트가 없는 연결을 만든다
    let silent = true;
    await guest.routeWebSocket('**/ws', (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        if (!silent) socket.send(message);
      });
    });
    await guest.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(guest.getByRole('status').filter({ hasText: '재연결 중' })).toBeVisible();
    silent = false;
    const refresh = guest.waitForResponse('**/api/session/refresh');
    await guest.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect((await refresh).ok()).toBe(true);
    await expect(guest.getByRole('status').filter({ hasText: '재연결 중' })).toHaveCount(0);
    await page.getByRole('button', { name: '콜 10', exact: true }).click();
    await expect(guest.locator('.seat.active .name')).toHaveText('Bob');
    await expect(guest.getByRole('button', { name: '체크', exact: true })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  } finally {
    await context.close();
  }
});
