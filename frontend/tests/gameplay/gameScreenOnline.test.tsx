// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameScreen } from '../../src/features/gameplay/GameScreen';
import type { GameSession, SetupControls } from '../../src/features/gameplay/session';
import { fullCapabilities } from '../../src/features/gameplay/model/capabilities';
import { createTournament } from '../../src/game/transition';
import { defaultSettings } from '../../src/game/settings';
import { fixtureState, ctx } from '../game/helpers';

let host: HTMLDivElement;
let root: Root;
// 이 테스트에서 사용하지 않는 드래그 입력을 제공한다.
function ignoreDrag() {}
// 실제 React 루트를 준비하고 act 환경을 활성화한다.
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
// 루트와 DOM 및 전역 대체값을 정리한다.
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
// 외부 명령 채널을 가진 세션을 구성한다.
function session(overrides: Partial<GameSession> = {}): GameSession {
  return {
    state: fixtureState(3),
    busy: false,
    capabilities: fullCapabilities,
    legal: null,
    viewSeat: 0,
    scope: 1,
    guard: () => null,
    run: async (action) => {
      await action();
    },
    dispatch: vi.fn(async () => true),
    notify: vi.fn(),
    loadEvents: async () => [],
    ...overrides,
  };
}
// 실제 화면을 같은 루트에 렌더링하여 외부 갱신을 검증한다.
async function render(s: GameSession, dialog = '') {
  const setup: SetupControls = {
    scope: 'test',
    drag: {
      position: null,
      pressed: null,
      ready: null,
      order: s.state.players.map((p) => p.id),
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
      <GameScreen session={s} setup={setup} dialog={dialog} onDialog={() => {}} menu={null} />,
    ),
  );
  return setup;
}
// DOM 버튼을 눌러 실제 React 이벤트를 전달한다.
async function click(selector: string) {
  const node = host.querySelector<HTMLElement>(selector);
  expect(node, selector).not.toBeNull();
  await act(() => node!.click());
}

// 개별 이름 권한은 자기 카드만 편집하며 전체 설정 권한을 열지 않는다.
it('canRename overrides setup permission only for the permitted name', async () => {
  const s = session({
    state: createTournament(defaultSettings, ctx),
    capabilities: { ...fullCapabilities, canEditSetup: false },
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

// 연결 끊김 표시가 지정된 카드에만 나타난다.
it('shows a disconnected marker on the supplied player', async () => {
  await render(session({ disconnectedIds: new Set(['p1']) }));
  expect(host.querySelector('[data-player="p1"]')?.textContent).toContain('연결 끊김');
  expect(host.querySelector('[data-player="p0"]')?.textContent).not.toContain('연결 끊김');
});

// 외부 팟과 승자는 재렌더링을 따르며 편집과 탐색은 콜백만 보낸다.
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

// 권한 거절은 행동 종류에 맞는 문구를 사용하며 기본 문구도 유지한다.
it('uses capability-specific denial and the default fallback', async () => {
  const s = session({
    capabilities: { ...fullCapabilities, canAct: false, canUndo: false },
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

// 결과 슬롯은 종료 화면에만 나타나고 독 안내는 별도 표시된다.
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
