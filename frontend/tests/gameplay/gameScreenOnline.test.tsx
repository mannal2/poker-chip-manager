// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameScreen } from '../../src/features/gameplay/GameScreen';
import type {
  GameSession,
  SetupControls,
  GameScreenHandle,
} from '../../src/features/gameplay/session';
import { fullCapabilities } from '../../src/features/gameplay/model/capabilities';
import { createTournament, getLegalActions } from '../../src/game/transition';
import { defaultSettings } from '../../src/game/settings';
import { fixtureState, ctx } from '../game/helpers';

let host: HTMLDivElement;
let root: Root;
// 이 테스트에서 사용하지 않는 드래그 입력을 제공한다
function ignoreDrag() {}
// 실제 React 루트를 준비하고 act 환경을 활성화한다
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
// 루트와 DOM 및 전역 대체값을 정리한다
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
// 외부 명령 채널을 가진 세션을 구성한다
function session(overrides: Partial<GameSession> = {}): GameSession {
  return {
    state: fixtureState(3),
    busy: false,
    capabilities: fullCapabilities,
    legal: null,
    viewSeat: 0,
    scope: 1,
    // 테스트 세션의 조작 차단 사유를 제공한다
    guard: () => null,
    // 테스트 화면의 명령 실행을 연결한다
    run: async (action) => {
      await action();
    },
    dispatch: vi.fn(async () => true),
    notify: vi.fn(),
    // 테스트 화면에 빈 기록을 제공한다
    loadEvents: async () => [],
    ...overrides,
  };
}
// 실제 화면을 같은 루트에 렌더링하여 외부 갱신을 검증한다
async function render(s: GameSession, dialog = '', ref?: React.Ref<GameScreenHandle>, onDialog = vi.fn()) {
  const setup: SetupControls = {
    scope: 'test',
    drag: {
      position: null,
      pressed: null,
      ready: null,
      order: s.state.players.map((p) => p.id),
      // 테스트 칩 효과의 좌표 준비 콜백을 제공한다
      handlers: () => ({
        onPointerDown: ignoreDrag,
        onPointerMove: ignoreDrag,
        onPointerUp: ignoreDrag,
        onClick: ignoreDrag,
        onPointerCancel: ignoreDrag,
        onLostPointerCapture: ignoreDrag,
      }),
    },
    rename: vi.fn(() => true),
    onNameEditing: vi.fn(),
    saveSettings: vi.fn(),
    start: vi.fn(),
    clearEditing: vi.fn(),
  };
  await act(() =>
    root.render(
      <GameScreen
        ref={ref}
        session={s}
        setup={setup}
        dialog={dialog}
        onDialog={onDialog}
        menu={null}
      />,
    ),
  );
  return setup;
}
// 다른 탭이 재준비하거나 새 토너먼트로 넘어가면 블라인드 설정을 닫는다
it('closes an open blinds dialog when the tournament or phase changes', async () => {
  const playing = session();
  const close = vi.fn();
  await render(playing, 'blinds', undefined, close);
  expect(host.querySelector('dialog')).not.toBeNull();
  await render(
    session({ state: { ...playing.state, tournamentId: 'new' } }),
    'blinds',
    undefined,
    close,
  );
  expect(close).toHaveBeenCalledWith('');
  close.mockClear();
  await render(
    session({ state: createTournament(defaultSettings, ctx) }),
    'blinds',
    undefined,
    close,
  );
  expect(host.querySelector('dialog')).toBeNull();
  expect(close).toHaveBeenCalledWith('');
  await render(playing);
  expect(host.querySelector('dialog')).toBeNull();
});

// 방장은 다른 자리의 차례에도 취소할 수 있지만 서버 응답을 기다리는 동안에는 잠긴다
it('separates host undo from unavailable betting actions', async () => {
  const state = fixtureState(3);
  state.undo = structuredClone(state);
  const s = session({ state, capabilities: { ...fullCapabilities, canAct: false } });
  await render(s);
  const buttons = host.querySelectorAll('.bet-top button');
  expect(buttons[0].getAttribute('aria-disabled')).toBe('false');
  expect(buttons[1].getAttribute('aria-disabled')).toBe('true');
  await click('.bet-top button');
  expect(s.dispatch).toHaveBeenCalledWith({ type: 'UNDO' });
  await render({ ...s, busy: true });
  expect(buttons[0].getAttribute('aria-disabled')).toBe('true');
});

// 전체 복구에서 건너뛴 카드는 즉시 그리고 이후 연속 버전에서 늘어난 카드만 애니메이션한다
it('animates board cards only from the displayed continuous version', async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  try {
    const state = fixtureState(3);
    // 같은 핸드에서 수신한 보드와 연속성 정보를 실제 화면에 렌더링한다
    const board = (street: number, version: number, from: number | null) =>
      render(
        session({
          state: { ...state, hand: { ...state.hand!, street } },
          boardReveal: { version, from },
        }),
      );
    await board(0, 1, null);
    await board(2, 4, null);
    expect(host.querySelectorAll('.board-card')).toHaveLength(4);
    expect(animate).not.toHaveBeenCalled();
    await board(3, 5, 4);
    expect(animate).toHaveBeenCalledTimes(1);
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'animate', original);
    else Reflect.deleteProperty(Element.prototype, 'animate');
  }
});
// 같은 보드의 HTTP 확정과 후속 버전 갱신은 진행 중인 플랍 효과를 취소하지 않는다
it('preserves a continuous reveal when HTTP confirms the unchanged board', async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  const cancel = vi.fn();
  // 각 카드에 시작한 효과와 취소 시점을 기록한다
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  try {
    const state = fixtureState(3);
    // 원래 화면과 같은 핸드에 대해 확정 버전과 카드 수를 바꾼다
    const board = (street: number, version: number, from: number | null) =>
      render(
        session({
          state: { ...state, hand: { ...state.hand!, street } },
          boardReveal: { version, from },
        }),
      );
    await board(0, 1, null);
    await board(1, 2, 1);
    expect(animate).toHaveBeenCalledTimes(3);
    expect(cancel).not.toHaveBeenCalled();
    await board(1, 2, null);
    await board(1, 3, null);
    expect(animate).toHaveBeenCalledTimes(3);
    expect(cancel).not.toHaveBeenCalled();
    await board(2, 4, 3);
    expect(animate).toHaveBeenCalledTimes(4);
    expect(cancel).toHaveBeenCalledTimes(3);
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'animate', original);
    else Reflect.deleteProperty(Element.prototype, 'animate');
  }
});
// 상태 버전이 그대로여도 외부 취소 핸들은 입력한 베팅 초안을 폐기한다
it('discards a betting input through the external undo reset handle', async () => {
  const ref = createRef<GameScreenHandle>();
  const state = fixtureState(3);
  const s = session({ state, legal: getLegalActions(state) });
  await render(s, '', ref);
  await click('[aria-label="50칩 추가"]');
  expect(host.querySelectorAll('.bet.pending')).toHaveLength(1);
  await act(() => ref.current!.resetSelection());
  expect(host.querySelectorAll('.bet.pending')).toHaveLength(0);
});

// 잘못된 공유 팟 인덱스와 참가자 ID는 화면 입력에 전파하지 않는다
it('clamps unknown shared pots, drops ineligible winners and auto-selects sole eligibility', async () => {
  const state = fixtureState(3);
  state.hand!.phase = 'settlement';
  state.hand!.actorId = null;
  state.players.forEach((p, i) => {
    p.H = [10, 20, 20][i];
  });
  state.players[2].folded = true;
  state.pot = 50;
  await render(
    session({ state, sharedSelection: { potIndex: 99, winners: { pot0: ['unknown'], pot1: [] } } }),
  );
  expect(host.querySelector('.pot strong')?.textContent).toBe('20');
  expect(host.querySelector('[data-player="p1"]')?.classList.contains('selected')).toBe(true);
  await render(
    session({ state, sharedSelection: { potIndex: -1, winners: { pot0: ['unknown', 'p2'] } } }),
  );
  expect(host.querySelectorAll('.seat.selected')).toHaveLength(0);
});
// DOM 버튼을 눌러 실제 React 이벤트를 전달한다
async function click(selector: string) {
  const node = host.querySelector<HTMLElement>(selector);
  expect(node, selector).not.toBeNull();
  await act(() => node!.click());
}

// 개별 이름 권한은 자기 카드만 편집하며 전체 설정 권한을 열지 않는다
it('canRename overrides setup permission only for the permitted name', async () => {
  const s = session({
    state: createTournament(defaultSettings, ctx),
    capabilities: { ...fullCapabilities, canEditSetup: false },
    // 본인 카드에만 이름 편집을 허용한다
    canRename: (id) => id === 'p0',
  });
  const setup = await render(s);
  expect(host.querySelector('[data-player="p1"] .inline-name')).toBeNull();
  expect(host.querySelector('[data-player="p0"]')?.getAttribute('style')).not.toContain(
    'touch-action: none',
  );
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  await click('[data-player="p0"] .inline-name button');
  const input = host.querySelector<HTMLInputElement>('[data-player="p0"] input')!;
  expect(input).not.toBeNull();
  await act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  expect(setup.rename).toHaveBeenCalledWith('p0', s.state.players[0].name);
});

// 연결 끊김 표시가 지정된 카드에만 나타난다
it('shows a disconnected marker on the supplied player', async () => {
  await render(session({ disconnectedIds: new Set(['p1']) }));
  expect(host.querySelector('[data-player="p1"]')?.textContent).toContain('연결 끊김');
  expect(host.querySelector('[data-player="p0"]')?.textContent).not.toContain('연결 끊김');
});

// 외부 팟과 승자는 재렌더링을 따르며 편집과 탐색은 콜백만 보낸다
it('uses controlled winners and pot index without optimistic edits', async () => {
  const state = fixtureState(3);
  state.hand!.phase = 'settlement';
  state.hand!.actorId = null;
  state.players.forEach((p, i) => {
    p.H = [10, 20, 20][i];
  });
  state.pot = 50;
  const onSelectionChange = vi.fn();
  const s = session({
    state,
    sharedSelection: { winners: { pot0: ['p0'], pot1: ['p1'] }, potIndex: 1 },
    onSelectionChange,
  });
  await render(s);
  expect(host.querySelector('[data-player="p1"]')?.classList.contains('selected')).toBe(true);
  expect(host.querySelector('.pot strong')?.textContent).toBe('20');
  await click('[data-player="p2"]');
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    winners: { pot0: ['p0'], pot1: ['p1', 'p2'] },
    potIndex: 1,
  });
  expect(host.querySelector('[data-player="p2"]')?.classList.contains('selected')).toBe(false);
  await click('[aria-label="이전 팟"]');
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    winners: s.sharedSelection!.winners,
    potIndex: 0,
  });
  await render({ ...s, sharedSelection: { winners: { pot0: ['p2'], pot1: [] }, potIndex: 0 } });
  expect(host.querySelector('[data-player="p2"]')?.classList.contains('selected')).toBe(true);
  expect(host.querySelector('.pot strong')?.textContent).toBe('30');
  onSelectionChange.mockClear();
  await render({ ...s, capabilities: { ...fullCapabilities, canSettle: false } });
  await click('[data-player="p2"]');
  await click('[aria-label="다음 팟"]');
  expect(onSelectionChange).not.toHaveBeenCalled();
  await render({ ...s, onSelectionChange: undefined });
  await click('[data-player="p2"]');
  await click('[aria-label="다음 팟"]');
  expect(host.querySelector('.pot strong')?.textContent).toBe('20');
});

// 권한 거절은 행동 종류에 맞는 문구를 사용하며 기본 문구도 유지한다
it('uses capability-specific denial and the default fallback', async () => {
  const s = session({
    capabilities: { ...fullCapabilities, canAct: false, canUndo: false },
    // 권한 거절 안내를 테스트 화면에 제공한다
    denied: (need) => `denied:${need}`,
  });
  await render(s);
  await click('.bet-top button:nth-child(2)');
  expect(s.notify).toHaveBeenLastCalledWith('denied:canAct');
  await click('.bet-top button:first-child');
  expect(s.notify).toHaveBeenLastCalledWith('denied:canUndo');
  await render({ ...s, denied: undefined });
  await click('.bet-top button:first-child');
  expect(s.notify).toHaveBeenLastCalledWith('조작 권한이 없습니다.');
  const setup = {
    ...s,
    state: createTournament(defaultSettings, ctx),
    capabilities: { ...fullCapabilities, canEditSetup: false },
  };
  await render(setup);
  await click('.dock > button');
  expect(s.notify).toHaveBeenLastCalledWith('denied:canEditSetup');
  const settlement = structuredClone(s.state);
  settlement.hand!.phase = 'settlement';
  await render({
    ...s,
    state: settlement,
    capabilities: { ...fullCapabilities, canSettle: false },
  });
  await click('.settlement-controls .primary');
  expect(s.notify).toHaveBeenLastCalledWith('denied:canSettle');
  await render({ ...s, capabilities: { ...fullCapabilities, canEditBlinds: false } }, 'blinds');
  await click('.blind-reserve');
  expect(s.notify).toHaveBeenLastCalledWith('denied:canEditBlinds');
  expect(s.dispatch).not.toHaveBeenCalled();
});

// 결과 슬롯은 종료 화면에만 나타나고 독 안내는 별도 표시된다
it('shows result actions only at results and renders an optional dock notice', async () => {
  const s = session({
    resultActions: <button data-result>다시 준비하기</button>,
    dockNotice: 'A 차례입니다',
  });
  await render(s);
  expect(host.querySelector('[data-result]')).toBeNull();
  expect(host.querySelector('.dock-notice')?.textContent).toBe('A 차례입니다');
  await render({ ...s, state: { ...s.state, status: 'ended' } });
  expect(host.querySelector('.dock [data-result]')).not.toBeNull();
  await render({ ...s, state: { ...s.state, status: 'aborted' } });
  expect(host.querySelector('.dock [data-result]')).not.toBeNull();
});
