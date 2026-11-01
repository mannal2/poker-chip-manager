// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  useOnlineGameSession,
  validateOnlineSettings,
} from '../../src/features/online-game/hooks/useOnlineGameSession';
import type {
  OnlineController,
  OnlineView,
} from '../../src/features/online-game/session/onlineController';
import type { RoomSnapshot } from '../../src/features/online-game/api/types';
import { validateSettings } from '../../src/game/settings';
import playing from '../../../shared/api-contract/snapshot-playing.json';

// 연속 선택 중 오래된 서버 초안은 무시하고 마지막 응답과 관찰자 상태는 반영한다.
it('keeps the latest host pick through delayed echoes and restores server picks for observers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const snapshot = structuredClone(playing.response) as RoomSnapshot;
  snapshot.settlementDraft = { draftVersion: 1, winners: {}, potIndex: 0 };
  snapshot.you.capabilities.canSettle = true;
  let view: OnlineView = {
    phase: 'room',
    snapshot,
    connection: 'online',
    hasControl: true,
    pending: false,
    recovery: null,
    error: null,
  };
  const sendDraft = vi.fn();
  const controller = { getView: () => view, sendDraft } as unknown as OnlineController;
  let result!: ReturnType<typeof useOnlineGameSession>;
  // 실제 훅의 공유 선택을 렌더링한다.
  function Harness() {
    result = useOnlineGameSession(view, controller);
    return null;
  }
  try {
    await act(() => root.render(<Harness />));
    const first = { potIndex: 0, winners: { pot0: ['a'] } };
    const last = { potIndex: 1, winners: { pot0: ['b', 'a'], pot1: ['c'] } };
    await act(() => result.session.onSelectionChange!(first));
    await act(() => result.session.onSelectionChange!(last));
    view = {
      ...view,
      snapshot: { ...snapshot, draftVersion: 2, settlementDraft: { ...first, draftVersion: 2 } },
    };
    await act(() => root.render(<Harness />));
    expect(result.session.sharedSelection).toMatchObject(last);
    expect(sendDraft).toHaveBeenLastCalledWith(1, last.winners);
    view = {
      ...view,
      snapshot: {
        ...snapshot,
        draftVersion: 3,
        settlementDraft: {
          potIndex: 1,
          winners: { pot1: ['c'], pot0: ['a', 'b'] },
          draftVersion: 3,
        },
      },
    };
    await act(() => root.render(<Harness />));
    expect(result.session.sharedSelection).toMatchObject(view.snapshot!.settlementDraft!);
    view = {
      ...view,
      snapshot: { ...snapshot, draftVersion: 4, settlementDraft: { ...first, draftVersion: 4 } },
    };
    await act(() => root.render(<Harness />));
    expect(result.session.sharedSelection).toMatchObject(first);
    view = { ...view, pending: true };
    await act(() => root.render(<Harness />));
    await act(() => result.session.onSelectionChange!(last));
    expect(sendDraft).toHaveBeenCalledTimes(2);
    view = {
      ...view,
      hasControl: false,
      snapshot: { ...snapshot, settlementDraft: { ...first, draftVersion: 4 } },
    };
    await act(() => root.render(<Harness />));
    expect(result.session.sharedSelection).toMatchObject(first);
    await act(() => result.session.onSelectionChange?.(last));
    expect(sendDraft).toHaveBeenCalledTimes(2);
    view = { ...view, hasControl: true, pending: false };
    await act(() => root.render(<Harness />));
    await act(() => result.session.onSelectionChange!(last));
    expect(result.session.sharedSelection).toMatchObject(last);
    view = { ...view, pending: true, error: '연결이 끊겼습니다' };
    await act(() => root.render(<Harness />));
    expect(result.session.sharedSelection).toMatchObject(first);
    view = { ...view, pending: false, error: null };
    await act(() => root.render(<Harness />));
    expect(result.session.sharedSelection).toMatchObject(first);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

// 단독 대기방의 유효한 금액을 허용하고 로컬 인원 검증 및 금액 규칙은 유지한다.
it('validates solo settings numerically while keeping local validation unchanged', () => {
  const settings = { names: ['Alice'], initial: 1000, sb: 5, bb: 10, button: -1 };
  expect(validateOnlineSettings(settings).ok).toBe(true);
  expect(validateSettings(settings)).toEqual({ ok: false, code: 'INVALID_NAMES' });
  for (const change of [
    { initial: 7 },
    { initial: Infinity },
    { sb: 10 },
    { bb: 1005 },
    { button: 1 },
  ])
    expect(validateOnlineSettings({ ...settings, ...change }).ok).toBe(false);
});

// 실제 훅의 서버 권한과 조작 잠금 및 본인 직접 이름 변경을 확인한다.
it('adapts authoritative permissions, live guards and own rename without granting host rights', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const snapshot = structuredClone(playing.response) as RoomSnapshot;
  snapshot.roomPhase = 'WAITING';
  snapshot.game = null;
  snapshot.you.participantId = snapshot.participants[1].participantId;
  snapshot.you.capabilities.canEditSetup = false;
  let view: OnlineView = {
    phase: 'room',
    snapshot,
    connection: 'online',
    hasControl: true,
    pending: false,
    recovery: null,
    error: null,
  };
  const send = vi.fn(async () => true);
  const controller = {
    getView: () => view,
    send,
    loadEvents: vi.fn(),
  } as unknown as OnlineController;
  let result!: ReturnType<typeof useOnlineGameSession>;
  // 훅 결과를 테스트가 접근할 수 있도록 실제 React 렌더링으로 만든다.
  function Harness() {
    result = useOnlineGameSession(view, controller);
    return null;
  }
  try {
    await act(() => root.render(<Harness />));
    expect(result.session.capabilities).toBe(snapshot.you.capabilities);
    expect(result.session.legal).toBe(snapshot.legal);
    expect(result.session.scope).toBe(snapshot.you.controlGeneration);
    expect(result.session.viewSeat).toBe(1);
    expect(result.setup.rotate).toBeUndefined();
    expect(result.setup.changeCount).toBeUndefined();
    expect(result.session.canRename!(snapshot.hostId)).toBe(false);
    expect(await result.setup.rename!(snapshot.hostId, 'Hack')).toBe(false);
    expect(await result.setup.rename!(snapshot.you.participantId, 'NewName')).toBe(true);
    expect(send).toHaveBeenLastCalledWith([
      { type: 'RENAME', payload: { name: 'NewName' }, handScoped: false },
    ]);
    await result.session.dispatch({ type: 'CALL' });
    expect(send).toHaveBeenLastCalledWith([{ type: 'CALL', handScoped: true }]);
    for (const [patch, message] of [
      [{ connection: 'offline' }, '연결이 끊겼습니다'],
      [{ connection: 'online', hasControl: false }, '다른 화면에서 조작 중입니다.'],
      [{ hasControl: true, pending: true }, '서버 응답을 기다려주세요.'],
    ] as const) {
      view = { ...view, ...patch };
      expect(result.session.guard()).toBe(message);
      await act(() => root.render(<Harness />));
      expect(result.session.busy).toBe(true);
    }
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
