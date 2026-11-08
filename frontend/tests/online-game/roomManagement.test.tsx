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
import type { GameEvent } from '../../src/game/types';

// 화면 치수와 애니메이션 대신 관리 조작의 실제 페이지 연결만 검사한다
vi.mock('../../src/shared/hooks/useScreenFit', () => ({
  // 관리 테스트에서 화면 치수 효과를 대신한다
  useScreenFit: () => {},
}));
// 서버 관리 명령과 관계없는 칩 애니메이션 구독을 생략한다
vi.mock('../../src/features/online-game/hooks/useOnlineChipMotion', () => ({
  // 관리 테스트에서 칩 효과 구독을 대신한다
  useOnlineChipMotion: () => {},
}));
// 공통 화면 슬롯의 입출력을 유지하고 복잡한 테이블 렌더링을 생략한다
vi.mock('../../src/features/gameplay/GameScreen', () => ({
  // 실제 페이지가 제공하는 메뉴와 결과 조작을 DOM에 연결한다
  GameScreen: ({
    menu,
    dialog,
    onDialog,
    session,
    headerNotice,
    selection,
  }: {
    menu: ReactNode;
    dialog: string;
    onDialog: (value: string) => void;
    session: {
      resultActions: ReactNode;
      state: { players: { id: string; name: string }[] };
      busy: boolean;
    };
    headerNotice?: ReactNode;
    selection?: {
      eligibleIds: ReadonlySet<string>;
      label: string;
      onSelect: (id: string) => void;
      onCancel: () => void;
    };
  }) => (
    <>
      <header>{headerNotice}</header>
      <button onClick={() => onDialog('menu')}>관리 메뉴</button>
      {dialog === 'menu' && menu}
      {selection ? (
        <div className="participant-selection-controls">
          <p>{selection.label}</p>
          {session.state.players.map((p) => (
            <button
              key={p.id}
              disabled={session.busy || !selection.eligibleIds.has(p.id)}
              onClick={() => selection.onSelect(p.id)}
            >
              {p.name}
            </button>
          ))}
          <button onClick={selection.onCancel}>취소</button>
        </div>
      ) : (
        session.resultActions
      )}
    </>
  ),
}));

// 하나의 서버 발행에서 확인한 모든 행동을 같은 토스트에 순서대로 표시한다
it.each([
  ['CHECK', '체크(자동)'],
  ['UNDO', '방장이 직전 행동을 취소했습니다'],
])('displays %s and the following automatic fold together', async (type, first) => {
  const x = await mountRoom();
  try {
    // 화면에 전달할 확정 행동을 만든다
    const event = (id: string, action: string): GameEvent => ({
      type: action,
      id,
      details: { auto: action !== 'UNDO' },
      at: '',
      tournamentId: 't',
      hand: 1,
    });
    await x.publish([event('1', type), event('2', 'FOLD')]);
    const toast = x.host.querySelector('.toast')?.textContent;
    expect(toast).toContain(first);
    expect(toast).toContain('폴드(자동)');
    expect(toast!.indexOf(first)).toBeLessThan(toast!.indexOf('폴드(자동)'));
  } finally {
    await x.close();
  }
});

// 확정 거절에는 사유만 남기고 원장 확인이 필요한 경우에만 재시도를 표시한다
it.each([false, true])(
  'shows a retry button only for unresolved requests (%s)',
  async (unresolved) => {
    const x = await mountRoom('PLAYING', '요청 오류', unresolved);
    try {
      expect(x.host.querySelector('[role="alert"]')?.textContent).toContain('요청 오류');
      expect(!!x.host.querySelector('[role="alert"] button')).toBe(unresolved);
    } finally {
      await x.close();
    }
  },
);
// 최신 조작 상태가 잠기면 열려 있던 메뉴에서도 요청하지 않고 이유를 안내한다
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

// 확인창이 열린 뒤 대상이 이미 기권했으면 기권 명령을 전송하지 않는다
it('rejects a target who left the play at confirmation time', async () => {
  const x = await mountRoom();
  try {
    await x.click('관리 메뉴');
    await x.click('기권 처리');
    await x.click('Bob');
    expect(x.host.querySelectorAll('dialog')).toHaveLength(1);
    const bob = x.view.snapshot!.participants.find((p) => p.name === 'Bob')!;
    x.view.snapshot!.game!.players.find((p) => p.id === bob.playerId)!.forfeited = true;
    await x.click('확인');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.host.textContent).toContain('상황이 바뀌어 취소했습니다. 다시 선택해 주세요.');
  } finally {
    await x.close();
  }
});

// 서버 업데이트 안내는 대기방과 결과 화면에만 보이고 진행 화면에는 보이지 않는다
it.each([
  ['WAITING', true],
  ['RESULT', true],
  ['PLAYING', false],
] as const)('shows the server update notice in %s only when pending: %s', async (phase, shown) => {
  const notice = '서버 업데이트 중입니다. 방이 사라질 수 있습니다';
  const x = await mountRoom(phase);
  try {
    expect(x.host.textContent).not.toContain(notice);
    x.view.snapshot!.deployPending = true;
    await x.rerender();
    expect(x.host.textContent?.includes(notice)).toBe(shown);
  } finally {
    await x.close();
  }
});

// 비활성 재준비 버튼을 누르면 현재 조작권 부족을 안내한다
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

it.each(['host', 'hand phase'])(
  'returns to card selection after dismissing confirmation and exits when %s changes',
  async (changed) => {
    const x = await mountRoom();
    try {
      await x.click('관리 메뉴');
      await x.click('방장 넘기기');
      expect(x.host.querySelector('.menu-actions')).toBeNull();
      await x.click('Bob');
      await x.click('닫기');
      expect(x.host.querySelector('.participant-selection-controls')).not.toBeNull();
      expect(x.send).not.toHaveBeenCalled();
      if (changed === 'host')
        x.view.snapshot!.hostId = x.view.snapshot!.participants.find(
          (p) => p.name === 'Bob',
        )!.participantId;
      else x.view.snapshot!.game!.hand!.phase = 'settlement';
      await x.rerender();
      expect(x.host.querySelector('.participant-selection-controls')).toBeNull();
      expect(x.send).not.toHaveBeenCalled();
    } finally {
      await x.close();
    }
  },
);

it('does not enter an empty card selection', async () => {
  const x = await mountRoom();
  try {
    const bob = x.view.snapshot!.participants.find((p) => p.name === 'Bob')!;
    x.view.snapshot!.game!.players.find((p) => p.id === bob.playerId)!.eliminated = true;
    await x.rerender();
    await x.click('관리 메뉴');
    await x.click('방장 넘기기');
    expect(x.host.querySelector('.participant-selection-controls')).toBeNull();
    expect(x.host.textContent).toContain('대상 참가자가 없습니다.');
    expect(x.send).not.toHaveBeenCalled();
  } finally {
    await x.close();
  }
});

// 실제 세션 훅과 페이지에 필요한 최소 컨트롤러 경계를 제공한다
// 방장의 기권 처리는 확인 뒤 남기기·내보내기를 답할 때까지 명령을 보내지 않는다
it.each([
  ['닫기', []],
  ['방에 남기기', ['FORFEIT_DISCONNECTED']],
  ['방에서 내보내기', ['FORFEIT_DISCONNECTED', 'KICK']],
] as const)('host forfeit then %s sends %j', async (choice, types) => {
  const x = await mountRoom();
  try {
    const bob = x.view.snapshot!.participants.find((p) => p.name === 'Bob')!;
    await x.click('관리 메뉴');
    await x.click('기권 처리');
    await x.click('Bob');
    await x.click('확인');
    expect(x.send).not.toHaveBeenCalled();
    expect(x.host.querySelector('dialog')?.getAttribute('aria-label')).toBe('기권 후 방 선택');
    await x.click(choice);
    if (!types.length) {
      expect(x.send).not.toHaveBeenCalled();
      expect(x.host.querySelector('dialog')).toBeNull();
      expect(x.host.textContent).toContain('기권 처리할 플레이어를 선택하세요.');
      return;
    }
    const sent = (x.send.mock.calls[0] as unknown as [{ type: string; payload?: unknown }[]])[0];
    expect(sent.map((c) => c.type)).toEqual(types);
    for (const command of sent)
      expect(command.payload).toEqual({ participantId: bob.participantId });
  } finally {
    await x.close();
  }
});

// 본인 기권은 확인 뒤 남기를 고르면 기권만, 나가기를 고르면 기권과 나가기를 보낸다
it.each([
  ['방에 남기', ['FORFEIT']],
  ['방 나가기', ['FORFEIT', 'LEAVE']],
] as const)('self forfeit then %s sends %j', async (choice, types) => {
  const x = await mountRoom();
  try {
    x.view.snapshot!.you.participantId = x.view.snapshot!.participants.find(
      (p) => p.name === 'Bob',
    )!.participantId;
    await x.rerender();
    await x.click('관리 메뉴');
    await x.click('기권');
    await x.click('확인');
    expect(x.send).not.toHaveBeenCalled();
    await x.click(choice);
    const sent = (x.send.mock.calls[0] as unknown as [{ type: string }[]])[0];
    expect(sent.map((c) => c.type)).toEqual(types);
  } finally {
    await x.close();
  }
});

// 접속 중인 대상을 기권 처리할 때는 첫 확인창에 접속 중임을 알린다
it('warns when forfeiting a connected participant', async () => {
  const x = await mountRoom();
  try {
    x.view.snapshot!.participants.find((p) => p.name === 'Bob')!.connected = true;
    await x.rerender();
    await x.click('관리 메뉴');
    await x.click('기권 처리');
    await x.click('Bob');
    expect(x.host.querySelector('dialog')?.textContent).toContain('접속 중인 참가자입니다.');
  } finally {
    await x.close();
  }
});

// 두 번째 명령만 실패하면 기권은 됐다고 알리고 다시 시도할 메뉴를 안내한다
it('explains a forfeit whose leave failed', async () => {
  const x = await mountRoom();
  try {
    const bob = x.view.snapshot!.participants.find((p) => p.name === 'Bob')!;
    x.send.mockImplementation(async () => {
      x.view.snapshot!.game!.players.find((p) => p.id === bob.playerId)!.forfeited = true;
      return false;
    });
    await x.click('관리 메뉴');
    await x.click('기권 처리');
    await x.click('Bob');
    await x.click('확인');
    await x.click('방에서 내보내기');
    expect(x.host.textContent).toContain('기권은 됐지만 내보내지 못했습니다.');
  } finally {
    await x.close();
  }
});

async function mountRoom(
  phase: 'WAITING' | 'PLAYING' | 'RESULT' = 'PLAYING',
  error: string | null = null,
  unresolved = false,
) {
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
    error,
  };
  const send = vi.fn(async () => true);
  let observe!: (events: GameEvent[]) => void;
  const controller = {
    // 처리 결과를 아직 확인할 수 없는 요청만 재시도를 제공한다
    canRetry: () => unresolved,
    // 관리 화면에 최신 테스트 상태를 제공한다
    getView: () => view,
    send,
    // 관리 테스트에서 확정 이벤트 알림 구독을 대신한다
    onObserved: (listener: (events: GameEvent[]) => void) => {
      observe = listener;
      return () => {};
    },
    // 기록이 없는 관찰자에게 기본 알림 문구를 적용한다
    getKnownEvents: () => new Map(),
  } as unknown as OnlineController;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(() => root.render(<RoomPage view={view} controller={controller} />));
  return {
    host,
    view,
    send,
    // 관찰한 한 묶음의 이벤트를 같은 렌더 주기에 전달한다
    publish: async (events: GameEvent[]) => act(() => observe(events)),
    // 컨트롤러가 받은 최신 상태를 페이지의 오래된 이벤트에서도 읽도록 교체한다
    update: (patch: Partial<OnlineView>) => Object.assign(view, patch),
    // 바뀐 뷰로 페이지를 다시 그린다
    rerender: async () =>
      act(() => root.render(<RoomPage view={{ ...view }} controller={controller} />)),
    // 표시 문구가 일치하는 실제 버튼을 누른다
    click: async (label: string) => {
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
      if (!button) throw Error(label);
      await act(async () => {
        button.click();
      });
    },
    // 테스트 화면과 브라우저 전역을 정리한다
    close: async () => {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

it.each([false, true])('copies only the room code and announces failure=%s', async (failure) => {
  const x = await mountRoom();
  const writeText = failure
    ? vi.fn().mockRejectedValue(new Error('denied'))
    : vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  try {
    await x.click('관리 메뉴');
    const label = `방코드:[${x.view.snapshot!.code}]`;
    expect(x.host.querySelector('.menu-actions button')?.textContent).toBe(label);
    await x.click(label);
    expect(writeText).toHaveBeenCalledWith(x.view.snapshot!.code);
    expect(x.host.querySelector('.menu-actions')).toBeNull();
    expect(x.host.querySelector('.toast')?.textContent).toBe(
      failure ? '방 코드를 복사하지 못했습니다.' : '방 코드를 복사했습니다.',
    );
    expect(x.send).not.toHaveBeenCalled();
  } finally {
    await x.close();
  }
});

// 서버가 명령을 거절하면 메뉴를 닫아 오류 안내를 확인할 수 있게 한다
it('closes a menu after a server rejection and shows its reason', async () => {
  const x = await mountRoom();
  try {
    await x.click('관리 메뉴');
    await x.click('방장 넘기기');
    x.view.error = '대상 상태가 변경되었습니다.';
    x.send.mockResolvedValueOnce(false);
    await x.click('Bob');
    await x.click('확인');
    expect(x.host.querySelector('.menu-actions')).toBeNull();
    expect(x.host.textContent).toContain('대상 상태가 변경되었습니다.');
  } finally {
    await x.close();
  }
});

// 확인창이 열린 사이 방장이 바뀌면 이전 방장의 중단 요청을 막는다
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
    expect(x.host.textContent).toContain('상황이 바뀌어 취소했습니다. 다시 선택해 주세요.');
  } finally {
    await x.close();
  }
});
