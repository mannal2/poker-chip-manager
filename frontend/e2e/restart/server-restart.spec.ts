import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { createRoom, joinRoom, startRoom } from '../online/managementSupport';
import { startBackend, type BackendProcess } from './backendProcess';

const BACKEND = 'http://127.0.0.1:8080';
const ORIGIN = 'http://127.0.0.1:4175';
const LOST =
  "방에 다시 들어갈 수 없습니다. 방이 남아 있다면 '기존 플레이어로 복구'를 누르세요.";

// 내부 배포 상태에서 방 수와 진행 중 토너먼트 수와 게이트를 읽는다
async function serverStatus(request: APIRequestContext) {
  const response = await request.get(`${BACKEND}/internal/deploy/status`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    rooms: number;
    activeTournaments: number;
    startsClosed: boolean;
  };
}

// 화면의 현재 세션으로 방 상태를 조회한다
async function roomState(page: Page, roomId: string) {
  // 브라우저의 쿠키로 상태 경로를 읽는다
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/rooms/${id}/state`);
    return { status: response.status, body: await response.json() };
  }, roomId);
}

// 재시작 전 세션의 쿠키와 CSRF 토큰으로 이전 요청 본문을 다시 보낸다
async function replayWithOldSession(
  request: APIRequestContext,
  path: string,
  body: unknown,
  old: { cookie: string; csrf: string },
) {
  const response = await request.post(path, {
    headers: { Cookie: old.cookie, Origin: ORIGIN, 'X-CSRF-TOKEN': old.csrf },
    data: body,
  });
  return { status: response.status(), body: await response.json() };
}

// 화면의 새 세션과 CSRF 토큰으로 이전 요청 본문을 그대로 보낸다
async function replayWithNewSession(page: Page, path: string, body: unknown) {
  // 페이지 안에서 세션 토큰을 받아 같은 Origin으로 전송한다
  return page.evaluate(
    async ({ target, sent }) => {
      const session = await (await fetch('/api/session')).json();
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': session.csrfToken },
        body: JSON.stringify(sent),
      });
      return { status: response.status, code: (await response.json()).code };
    },
    { target: path, sent: body },
  );
}

// 게임 중 서버가 재시작되면 방 소실을 안내하고 이전 인증·명령이 새 서버에서 아무것도 만들지 않는다(M16)
test('a server restart during a game reports the lost room and ignores old requests', async ({
  page,
  browser,
  request,
}) => {
  let backend: BackendProcess | undefined = await startBackend();
  const guestContext = await browser.newContext();
  try {
    const before: { path: string; body: Record<string, unknown> }[] = [];
    // 재시작 전 방장 화면이 보낸 생성·명령 요청 본문을 기록한다
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && /\/api\/(rooms|room-joins)/.test(sent.url()))
        before.push({ path: new URL(sent.url()).pathname, body: sent.postDataJSON() });
    });
    const code = await createRoom(page);
    const guest = await guestContext.newPage();
    await joinRoom(guest, code);
    await startRoom(page);
    expect(await serverStatus(request)).toMatchObject({ rooms: 1, activeTournaments: 1 });

    const oldRoomId = await page.evaluate(
      () => JSON.parse(localStorage.getItem('online.lastRoom')!).roomId as string,
    );
    const cookie = (await page.context().cookies()).find((c) => c.name === 'PCM_SESSION')!;
    const old = {
      cookie: `${cookie.name}=${cookie.value}`,
      // 같은 세션의 GET은 기존 CSRF 토큰을 그대로 돌려준다
      csrf: await page.evaluate(
        async () => (await (await fetch('/api/session')).json()).csrfToken as string,
      ),
    };
    // 재시작 전에는 같은 쿠키·토큰·Origin의 변경 요청이 통과한다
    expect((await replayWithOldSession(request, '/api/session/refresh', {}, old)).status).toBe(200);
    const created = before.find((sent) => sent.path === '/api/rooms')!;
    const started = before.find((sent) => sent.body.type === 'START')!;
    expect(created).toBeDefined();
    expect(started).toBeDefined();
    const oldRequestIds = new Set(before.map((sent) => sent.body.requestId));
    expect(oldRequestIds.has(undefined)).toBe(false);

    const after: Record<string, unknown>[] = [];
    // 재시작을 시작한 순간부터 45초 안에 두 화면이 소실을 안내해야 한다
    const deadline = Date.now() + 45_000;
    await backend.stop();
    backend = undefined;
    // 재시작 뒤 방장 화면이 보내는 모든 변경 요청을 기록한다
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && sent.url().includes('/api/')) after.push(sent.postDataJSON());
    });
    backend = await startBackend();
    expect(await serverStatus(request)).toMatchObject({ rooms: 0, startsClosed: false });

    for (const current of [page, guest]) {
      await expect(current.getByRole('alert')).toHaveText(LOST, {
        timeout: Math.max(1, deadline - Date.now()),
      });
      await expect(
        current.getByRole('link', { name: '입장 화면으로', exact: true }),
      ).toHaveAttribute('href', `/online/?code=${code}`);
    }
    expect(Date.now()).toBeLessThanOrEqual(deadline);

    await page.getByRole('link', { name: '입장 화면으로', exact: true }).click();
    await expect(page).toHaveURL(`/online/?code=${code}`);
    const newCode = await createRoom(page);
    await joinRoom(guest, newCode);
    const newRoomId = await page.evaluate(
      () => JSON.parse(localStorage.getItem('online.lastRoom')!).roomId as string,
    );
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    const waiting = (await roomState(page, newRoomId)).body;
    expect(waiting).toMatchObject({ roomPhase: 'WAITING', tournamentId: null });
    // 재시작 뒤 화면은 이전 요청 식별자를 다시 쓰지 않는다
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((body) => oldRequestIds.has(body?.requestId))).toEqual([]);

    // 이전 세션 쿠키로 보낸 방 생성과 시작은 세션이 없어 거절된다
    for (const [path, body] of [
      ['/api/rooms', created.body],
      [`/api/rooms/${oldRoomId}/commands`, started.body],
      [`/api/rooms/${newRoomId}/commands`, started.body],
    ] as const)
      expect(await replayWithOldSession(request, path, body, old)).toEqual({
        status: 401,
        body: { code: 'NO_SESSION' },
      });
    // 새 세션으로 보낸 이전 명령은 사라진 방을 찾지 못한다
    expect(
      await replayWithNewSession(page, `/api/rooms/${oldRoomId}/commands`, started.body),
    ).toEqual({ status: 404, code: 'ROOM_NOT_FOUND' });
    // 새 방에 보낸 이전 시작은 새 세대 원장의 다음 순번이 아니므로 거절된다
    expect(started.body.sequence).toBeGreaterThan(1);
    expect(
      await replayWithNewSession(page, `/api/rooms/${newRoomId}/commands`, started.body),
    ).toEqual({ status: 409, code: 'SEQUENCE_GAP' });
    // 이전 방 생성 본문의 화면 스트림은 새 세션에 없다
    expect(await replayWithNewSession(page, '/api/rooms', created.body)).toEqual({
      status: 409,
      code: 'UNKNOWN_STREAM',
    });

    expect(await serverStatus(request)).toMatchObject({ rooms: 1, activeTournaments: 0 });
    const unchanged = (await roomState(page, newRoomId)).body;
    expect(unchanged).toMatchObject({
      roomPhase: 'WAITING',
      tournamentId: null,
      stateVersion: waiting.stateVersion,
    });

    await startRoom(page);
    await expect(guest.locator('.seat.active')).toHaveCount(1);
    expect(await serverStatus(request)).toMatchObject({ rooms: 1, activeTournaments: 1 });
  } finally {
    await guestContext.close();
    await backend?.stop();
  }
});
