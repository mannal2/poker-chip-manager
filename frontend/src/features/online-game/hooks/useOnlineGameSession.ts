import { useMemo, useState } from 'react';
import { useToast } from '../../../shared/hooks/useToast';
import { validChips, type GameSettings, type SettingsValidation } from '../../../game/settings';
import type { GameCommand } from '../../../game/types';
import { useSetupEditing } from '../../gameplay/hooks/useSetupEditing';
import type { GameSession, SetupControls } from '../../gameplay/session';
import { toGameState, viewSeatOf } from '../model/toGameState';
import { toServerCommands } from '../model/toServerCommands';
import { dockNoticeFor } from '../model/onlineNotices';
import type { OnlineController, OnlineView } from '../session/onlineController';

// 서버가 관리하는 명단을 유지하면서 대기방 금액과 딜러 좌석만 검증한다
export function validateOnlineSettings(settings: GameSettings): SettingsValidation {
  if (
    ![settings.initial, settings.sb, settings.bb].every(validChips) ||
    settings.sb >= settings.bb ||
    settings.bb > settings.initial
  )
    return { ok: false, code: 'INVALID_CHIP_SETTINGS' };
  if (
    !Number.isInteger(settings.button) ||
    settings.button < -1 ||
    settings.button >= settings.names.length
  )
    return { ok: false, code: 'INVALID_SEATS' };
  return { ok: true, settings };
}

// 서버 스냅샷을 공통 화면의 세션과 준비 편집 조작으로 연결한다
export function useOnlineGameSession(view: OnlineView, controller: OnlineController) {
  const snapshot = view.snapshot!;
  const state = useMemo(() => toGameState(snapshot), [snapshot]);
  const toast = useToast();
  const notify = toast.show;
  const busy = view.pending || view.connection !== 'online' || !view.hasControl;
  const selectionScope = `${state.tournamentId}:${state.hand?.id}:${state.hand?.phase}:${snapshot.hostId}:${snapshot.you.controlGeneration}`;
  const [selection, setSelection] = useState<{
    scope: string;
    draftVersion: number;
    value: NonNullable<GameSession['sharedSelection']>;
  } | null>(null);
  const authoritative: NonNullable<GameSession['sharedSelection']> = snapshot.settlementDraft ?? {
    winners: {},
    potIndex: 0,
  };
  // 제출 전 초안과 값이 같아도 새 버전이 확인되기 전에는 마지막 선택을 유지한다
  if (
    selection &&
    (selection.scope !== selectionScope ||
      !snapshot.you.capabilities.canSettle ||
      !view.hasControl ||
      view.connection !== 'online' ||
      view.error ||
      (snapshot.draftVersion > selection.draftVersion &&
        selection.value.potIndex === authoritative.potIndex &&
        Object.keys({ ...selection.value.winners, ...authoritative.winners }).every(
          (id) =>
            [...(selection.value.winners[id] ?? [])].sort().join('\0') ===
            [...(authoritative.winners[id] ?? [])].sort().join('\0'),
        )))
  )
    setSelection(null);
  const sharedSelection =
    selection?.scope === selectionScope &&
    snapshot.you.capabilities.canSettle &&
    view.hasControl &&
    !view.error
      ? selection.value
      : authoritative;
  // 칩 상태는 유지하고 방장의 최신 정산 선택만 즉시 표시하여 서버에 보낸다
  function onSelectionChange(value: NonNullable<GameSession['sharedSelection']>) {
    if (guard() || !controller.getView().snapshot!.you.capabilities.canSettle) return;
    setSelection({
      scope: selectionScope,
      draftVersion: controller.getView().snapshot!.draftVersion,
      value,
    });
    controller.sendDraft(value.potIndex, value.winners);
  }
  // 외부 취소가 확정되면 호스트가 보관한 정산 선택을 폐기한다
  function resetSelection() {
    setSelection(null);
  }
  // 현재 컨트롤러 값을 읽어 오래된 이벤트에서도 중복 명령을 막는다
  function guard() {
    const current = controller.getView();
    return current.connection !== 'online'
      ? '연결이 끊겼습니다.'
      : !current.hasControl
        ? '다른 화면에서 조작 중입니다.'
        : current.pending
          ? '처리 중입니다. 잠시만 기다려 주세요.'
          : null;
  }
  // 명령 실행 전에 최신 연결 상태를 확인한다
  async function run(action: () => Promise<void>) {
    const blocked = guard();
    if (blocked) return notify(blocked);
    await action();
  }
  // 공통 명령을 서버 요청 목록으로 변환하여 순차 전송한다
  async function dispatch(command: GameCommand) {
    const blocked = guard();
    if (blocked) {
      notify(blocked);
      return false;
    }
    return controller.send(toServerCommands(command, controller.getView().snapshot!));
  }
  const editing = useSetupEditing({
    state,
    scope: `${state.tournamentId}:${snapshot.you.controlGeneration}`,
    viewSeat: viewSeatOf(snapshot),
    busy,
    notify,
    // 현재 연결과 조작권으로 준비 입력의 잠금 여부를 확인한다
    isLocked: () => guard() !== null,
    // 서버에서 확정한 현재 준비 설정을 제공한다
    getSettings: () => state.settings,
    run,
    dispatch,
  });
  // 이름 변경은 본인 카드만 서버에 직접 보내어 단독 대기방에서도 저장한다
  async function rename(id: string, name: string) {
    const current = controller.getView().snapshot!;
    if (guard() || current.roomPhase !== 'WAITING' || id !== current.you.participantId)
      return false;
    return controller.send([{ type: 'RENAME', payload: { name }, handScoped: false }]);
  }
  const session: GameSession = {
    boardReveal: { version: snapshot.stateVersion, from: view.effectsFromVersion ?? null },
    state,
    sharedSelection,
    onSelectionChange,
    busy,
    capabilities: snapshot.you.capabilities,
    legal: snapshot.legal,
    scope: snapshot.you.controlGeneration,
    viewSeat: viewSeatOf(snapshot),
    guard,
    run,
    dispatch,
    notify,
    // 대기방의 본인 이름만 편집하도록 허용한다
    canRename: (id) => snapshot.roomPhase === 'WAITING' && id === snapshot.you.participantId,
    disconnectedIds: new Set(
      snapshot.participants.filter((p) => !p.connected).map((p) => p.playerId ?? p.participantId),
    ),
    dockNotice: dockNoticeFor(snapshot, snapshot.you.participantId),
    hostPlayerId: snapshot.game
      ? snapshot.participants.find((p) => p.participantId === snapshot.hostId)?.playerId ?? undefined
      : snapshot.hostId,
    // 부족한 권한에 맞는 화면 안내를 반환한다
    denied: (need) =>
      need === 'canAct'
        ? '내 차례가 아닙니다.'
        : need === 'canUndo'
          ? '방장만 취소할 수 있습니다.'
          : '방장만 조작할 수 있습니다.',
    // 현재 방의 서버 기록을 공통 기록 화면에 제공한다
    loadEvents: (tournamentId, after, limit) => controller.loadEvents(tournamentId, after, limit),
  };
  const setup: SetupControls = { ...editing, rename, validateSettings: validateOnlineSettings };
  return { session, setup, toast, resetSelection };
}
