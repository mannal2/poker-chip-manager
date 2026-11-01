import { expect, test } from '@playwright/test';
import { newParticipant } from './support';

// 실제 서버의 상태 응답을 브라우저의 프록시 경로로 확인한다.
test('health responds through the browser proxy', async ({ browser }) => {
  const page = await newParticipant(browser);
  try {
    // 페이지에서 실제 상태 API의 응답과 본문을 읽는다.
    const health = await page.evaluate(async () => {
      const response = await fetch('/api/health');
      return { status: response.status, body: await response.json() };
    });
    expect(health.status).toBe(200);
    expect(health.body.protocolVersion).toBe(1);
  } finally {
    await page.context().close();
  }
});

// 세션 없는 브라우저의 웹소켓 연결을 실제 서버가 거절하는지 확인한다.
test('websocket rejects a participant without a session', async ({ browser }) => {
  const page = await newParticipant(browser);
  try {
    // 실제 업그레이드를 시도하여 연결이 열리지 않는지 확인한다.
    const opened = await page.evaluate(
      () =>
        // 웹소켓 업그레이드 결과를 이벤트로 확인한다.
        new Promise<boolean>((resolve) => {
          const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
          // 잘못 열린 연결을 닫고 실패 결과를 전달한다.
          socket.onopen = () => {
            socket.close();
            resolve(true);
          };
          // 서버가 거절한 연결의 결과를 전달한다.
          socket.onerror = () => resolve(false);
        }),
    );
    expect(opened).toBe(false);
    // 세션을 만든 같은 브라우저는 웹소켓 연결을 열 수 있는지 확인한다.
    const authenticated = await page.evaluate(async () => {
      const session = await fetch('/api/session');
      if (!session.ok) throw new Error(`Session failed: ${session.status}`);
      // 실제 업그레이드 결과를 확인하고 열린 연결은 바로 닫는다.
      return new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
        // 열린 연결을 닫고 허용 결과를 전달한다.
        socket.onopen = () => {
          socket.close();
          resolve(true);
        };
        // 연결 실패 결과를 전달한다.
        socket.onerror = () => resolve(false);
      });
    });
    expect(authenticated).toBe(true);
  } finally {
    await page.context().close();
  }
});
