// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoomPage } from '../../src/features/online-game/RoomPage';
import { isRoomSnapshot } from '../../src/features/online-game/api/types';
import type {
  OnlineController,
  OnlineView,
} from '../../src/features/online-game/session/onlineController';
import playing from '../../../shared/api-contract/snapshot-playing.json';

// 화면 치수와 애니메이션 대신 관리 조작의 실제 페이지 연결만 검사한다.
vi.mock('../../src/shared/hooks/useScreenFit', () => ({
  // 관리 테스트에서 화면 치수 효과를 대신한다.
  useScreenFit: () => {},
}));
// 서버 관리 명령과 관계없는 칩 애니메이션 구독을 생략한다.
vi.mock('../../src/features/online-game/hooks/useOnlineChipMotion', () => ({
  // 관리 테스트에서 칩 효과 구독을 대신한다.
  useOnlineChipMotion: () => {},
}));
// 공통 화면 슬롯의 입출력을 유지하고 복잡한 테이블 렌더링을 생략한다.
vi.mock('../../src/features/gameplay/GameScreen', () => ({
  // 실제 페이지가 제공하는 메뉴와 결과 조작을 DOM에 연결한다.
  GameScreen: ({
    menu,
    dialog,
    onDialog,
    session,
  }: {
    menu: ReactNode;
    dialog: string;
    onDialog: (value: string) => void;
    session: { resultActions: ReactNode };
  }) => (
    <>
      <button onClick={() => onDialog('menu')}>관리 메뉴</button>
      {dialog === 'menu' && menu}
      {session.resultActions}
    </>
  ),
}));

// 최신 조작 상태가 잠기면 열려 있던 메뉴에서도 요청하지 않고 이유를 안내한다.
it.each([
  [{ pending: true }, '서버 응답을 기다려주세요.'],
  [{ connection: 'offline' as const }, '연결이 끊겼습니다'],
  [{ hasControl: false }, '다른 화면에서 조작 중입니다.'],
])('guards an already-open menu with %s', async (patch, message) => {
  const x = await mountRoom();
  try {
    await x.click('관리 메뉴');
    x.update(patch);
    await x.click('토너먼트 중단');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.host.textContent).toContain(message);
  } finally {
    await x.close();
  }
});

// 확인창이 열린 뒤 대상이 재연결되면 기권 명령을 전송하지 않는다.
it('rejects a reconnected target at confirmation time', async () => {
  const x = await mountRoom();
  try {
    await x.click('관리 메뉴');
    await x.click('기권 처리');
    await x.click('Bob');
    expect(x.host.querySelectorAll('dialog')).toHaveLength(1);
    x.view.snapshot!.participants.find((p) => p.name === 'Bob')!.connected = true;
    await x.click('확인');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.host.textContent).toContain('대상 또는 상태가 변경되었습니다. 다시 확인하세요.');
  } finally {
    await x.close();
  }
});

// 비활성 재준비 버튼을 누르면 현재 조작권 부족을 안내한다.
it('explains why a result reset is unavailable', async () => {
  const x = await mountRoom('RESULT');
  try {
    x.update({ hasControl: false });
    await x.click('다시 준비하기');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.host.textContent).toContain('다른 화면에서 조작 중입니다.');
  } finally {
    await x.close();
  }
});

// 실제 세션 훅과 페이지에 필요한 최소 컨트롤러 경계를 제공한다.
async function mountRoom(phase: 'PLAYING' | 'RESULT' = 'PLAYING') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const snapshot = structuredClone(playing.response);
  if (!isRoomSnapshot(snapshot)) throw Error('fixture');
  snapshot.you.participantId = snapshot.hostId;
  snapshot.roomPhase = phase;
  snapshot.participants.find((p) => p.name === 'Bob')!.connected = false;
  const view: OnlineView = {
    phase: 'room',
    snapshot,
    pending: false,
    connection: 'online',
    hasControl: true,
    recovery: null,
    error: null,
  };
  const send = vi.fn(async () => true);
  const controller = {
    // 관리 화면에 최신 테스트 상태를 제공한다.
    getView: () => view,
    send,
    // 관리 테스트에서 확정 이벤트 알림 구독을 대신한다.
    onObserved: () => () => {},
  } as unknown as OnlineController;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(() => root.render(<RoomPage view={view} controller={controller} />));
  return {
    host,
    view,
    send,
    // 컨트롤러가 받은 최신 상태를 페이지의 오래된 이벤트에서도 읽도록 교체한다.
    update: (patch: Partial<OnlineView>) => Object.assign(view, patch),
    // 표시 문구가 일치하는 실제 버튼을 누른다.
    click: async (label: string) => {
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
      if (!button) throw Error(label);
      await act(async () => {
        button.click();
      });
    },
    // 테스트 화면과 브라우저 전역을 정리한다.
    close: async () => {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

// 서버가 명령을 거절하면 메뉴를 닫아 오류 안내를 확인할 수 있게 한다.
it('closes a menu after a server rejection and shows its reason', async () => {
  const x = await mountRoom();
  try {
    await x.click('관리 메뉴');
    await x.click('방장 넘기기');
    x.view.error = '대상 상태가 변경되었습니다.';
    x.send.mockResolvedValueOnce(false);
    await x.click('Bob');
    expect(x.host.querySelector('.menu-actions')).toBeNull();
    expect(x.host.textContent).toContain('대상 상태가 변경되었습니다.');
  } finally {
    await x.close();
  }
});

// 확인창이 열린 사이 방장이 바뀌면 이전 방장의 중단 요청을 막는다.
it('rechecks host authority before confirming abort', async () => {
  const x = await mountRoom();
  try {
    await x.click('관리 메뉴');
    await x.click('토너먼트 중단');
    x.view.snapshot!.hostId = x.view.snapshot!.participants.find(
      (p) => p.name === 'Bob',
    )!.participantId;
    await x.click('확인');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.host.textContent).toContain('대상 또는 상태가 변경되었습니다. 다시 확인하세요.');
  } finally {
    await x.close();
  }
});
