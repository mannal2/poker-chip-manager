import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GameScreen } from '../gameplay/GameScreen';
import type { GameScreenHandle } from '../gameplay/session';
import { useScreenFit } from '../../shared/hooks/useScreenFit';
import { WaitingBar } from './components/WaitingBar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { useOnlineGameSession } from './hooks/useOnlineGameSession';
import type { OnlineController, OnlineView } from './session/onlineController';
import { useOnlineChipMotion } from './hooks/useOnlineChipMotion';
import { noticesFor } from './model/eventNotices';
import { Dialog } from '../../shared/ui/Dialog';
import { OnlineMenu, menuItems, type MenuItem } from './components/OnlineMenu';
import { HostRequests } from './components/HostRequests';
import { ResultActions } from './components/ResultActions';
import type { RoomParticipant, RoomSnapshot, ServerCommand } from './api/types';
import '../gameplay/styles/header.css';
import '../gameplay/styles/table.css';
import '../gameplay/styles/controls.css';

const selectionLabels: Record<string, string> = {
  '방장 넘기기': '방장을 넘길 플레이어를 선택하세요.',
  '기권 처리': '기권 처리할 플레이어를 선택하세요.',
  '참가자 내보내기': '내보낼 플레이어를 선택하세요.',
};

// 다른 방장·핸드·조작 세대에서 이전 대상 선택을 재사용하지 않는다
function selectionScope(snapshot: RoomSnapshot) {
  return [
    snapshot.roomId,
    snapshot.tournamentId,
    snapshot.game?.hand?.id,
    snapshot.game?.hand?.phase,
    snapshot.roomPhase,
    snapshot.hostId,
    snapshot.you.participantId,
    snapshot.you.controlGeneration,
  ].join('/');
}

function cardId(snapshot: RoomSnapshot, participant: RoomParticipant) {
  return snapshot.game
    ? (participant.playerId ?? participant.participantId)
    : participant.participantId;
}

// 온라인 방의 연결 안내와 공통 게임 화면 및 토스트를 조립한다
export function RoomPage({
  view,
  controller,
  updateNotice,
}: {
  view: OnlineView;
  controller: OnlineController;
  updateNotice?: ReactNode;
}) {
  const screen = useRef<HTMLElement>(null);
  useScreenFit(screen);
  const [dialog, setDialog] = useState('');
  const [targetSelection, setTargetSelection] = useState<{ label: string; scope: string } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<{
    item: MenuItem;
    target?: RoomParticipant;
  } | null>(null);
  const game = useRef<GameScreenHandle>(null);
  const { session, setup, toast, resetSelection } = useOnlineGameSession(view, controller);
  const notify = toast.show;
  const snapshot = view.snapshot!;
  const selectedItem = targetSelection
    ? menuItems(
        snapshot,
        new Set(snapshot.participants.filter((p) => p.connected).map((p) => p.participantId)),
      ).find((item) => item.label === targetSelection.label)
    : undefined;
  const targets = selectedItem?.targets ?? [];
  const validSelection =
    !!targetSelection &&
    targetSelection.scope === selectionScope(snapshot) &&
    targets.length > 0 &&
    view.connection === 'online' &&
    view.hasControl;
  const validConfirmation =
    !confirmation?.target ||
    targets.some((p) => p.participantId === confirmation.target!.participantId);
  useEffect(() => {
    if (!targetSelection || view.pending) return;
    if (!validSelection) {
      setTargetSelection(null);
      setConfirmation(null);
      notify('대상 또는 상태가 변경되었습니다. 다시 확인하세요.');
    } else if (!validConfirmation) {
      setConfirmation(null);
      notify('대상 또는 상태가 변경되었습니다. 다시 확인하세요.');
    }
  }, [targetSelection, view.pending, validSelection, validConfirmation, notify]);
  // 최신 연결 상태와 조작권을 확인하고 서버 관리 명령을 보낸다
  async function send(command: ServerCommand) {
    const blocked = session.guard();
    if (blocked) {
      notify(blocked);
      return false;
    }
    const current = controller.getView().snapshot!;
    if (command.type === 'TAKE_HOST' && (!current.hostTakeoverOpen || !current.you.canTakeHost)) {
      notify('방장 인수 요청이 종료되었습니다.');
      return false;
    }
    if (command.type.startsWith('RECOVERY_')) {
      const id = (command.payload as { recoveryRequestId: string }).recoveryRequestId;
      if (
        current.hostId !== current.you.participantId ||
        !current.recoveryRequests.some((r) => r.recoveryRequestId === id)
      ) {
        notify('복구 신청이 더 이상 유효하지 않습니다.');
        return false;
      }
    }
    const ok = await controller.send([command]);
    if (!ok)
      notify(controller.getView().error ?? '명령을 처리하지 못했습니다. 최신 상태를 확인하세요.');
    return ok;
  }
  // 메뉴와 카드 선택에서 최신 서버 스냅샷으로 대상과 권한을 확인한다
  async function choose(item: MenuItem, target?: RoomParticipant, confirmed = false) {
    const blocked = session.guard();
    if (blocked) return notify(blocked);
    const current = controller.getView().snapshot!;
    const valid = menuItems(
      current,
      new Set(current.participants.filter((p) => p.connected).map((p) => p.participantId)),
    ).find((i) => i.label === item.label);
    if (
      !valid ||
      (targetSelection && targetSelection.scope !== selectionScope(current)) ||
      (target && !valid.targets?.some((p) => p.participantId === target.participantId))
    ) {
      setConfirmation(null);
      setTargetSelection(null);
      setDialog('');
      return notify('대상 또는 상태가 변경되었습니다. 다시 확인하세요.');
    }
    if (item.command?.type === 'FORFEIT' && current.hostId === current.you.participantId)
      return notify('먼저 방장을 넘겨주세요');
    if (valid.targets && !target) {
      if (!valid.targets.length) return notify('대상 참가자가 없습니다.');
      setup.clearEditing();
      setTargetSelection({ label: valid.label, scope: selectionScope(current) });
      setDialog('');
      return;
    }
    const latestTarget =
      target && valid.targets?.find((p) => p.participantId === target.participantId);
    const warning =
      latestTarget && valid.label === '방장 넘기기'
        ? `${latestTarget.name}님에게 방장을 넘기시겠습니까?`
        : latestTarget && valid.label === '참가자 내보내기'
          ? `${latestTarget.name}님을 방에서 내보내시겠습니까?`
          : valid.confirm;
    if (warning && !confirmed) {
      setDialog('');
      setConfirmation({ item: { ...valid, confirm: warning }, target: latestTarget || undefined });
      return;
    }
    const command = {
      ...valid.command!,
      ...(target ? { payload: { participantId: target.participantId } } : {}),
    };
    setConfirmation(null);
    if (await send(command)) setTargetSelection(null);
    setDialog('');
  }
  // 참가 자격은 보존하고 화면 자원을 해제한 뒤 앱 홈으로 문서 이동한다
  function home() {
    controller.leaveRoomScreen();
    window.location.assign('/local/');
  }
  session.resultActions = (
    <ResultActions
      host={view.snapshot!.hostId === view.snapshot!.you.participantId}
      busy={session.busy}
      onReset={() => {
        const item = menuItems(view.snapshot!, new Set()).find((i) => i.label === '다시 준비하기');
        if (item) void choose(item);
      }}
    />
  );
  useOnlineChipMotion(screen, controller, view.snapshot!);
  useEffect(
    () =>
      controller.onObserved((events) => {
        if (events.some((event) => event.type === 'UNDO')) {
          resetSelection();
          game.current?.resetSelection();
        }
        const notices = noticesFor(events, controller.getKnownEvents());
        if (notices.length) notify(notices.join(' · '));
      }),
    [controller, resetSelection, notify],
  );
  return (
    <main ref={screen} className="phone online-room" aria-busy={view.pending}>
      {updateNotice}
      <ConnectionBanner view={view} controller={controller} />
      {view.snapshot!.roomPhase === 'WAITING' && (
        <WaitingBar code={view.snapshot!.code} notify={session.notify} />
      )}
      {view.snapshot!.deployPending && view.snapshot!.roomPhase !== 'PLAYING' && (
        <div className="notice deploy-notice" role="status">
          서버 업데이트 중입니다. 방이 사라질 수 있습니다
        </div>
      )}
      {view.error && (
        <div className="notice" role="alert">
          {view.error}
          {controller.canRetry() && <button onClick={() => void controller.retry()}>재시도</button>}
        </div>
      )}
      <GameScreen
        selection={
          validSelection
            ? {
                eligibleIds: new Set(targets.map((p) => cardId(snapshot, p))),
                selectedId: confirmation?.target
                  ? cardId(snapshot, confirmation.target)
                  : undefined,
                label: selectionLabels[targetSelection!.label],
                onCancel: () => {
                  if (!session.busy) setTargetSelection(null);
                },
                onSelect: (id) => {
                  const target = targets.find((p) => cardId(snapshot, p) === id);
                  if (target && selectedItem) void choose(selectedItem, target);
                },
              }
            : undefined
        }
        headerNotice={
          !targetSelection && (
            <HostRequests
              snapshot={view.snapshot!}
              busy={session.busy}
              send={(command) => {
                void send(command);
              }}
            />
          )
        }
        ref={game}
        session={session}
        setup={setup}
        dialog={dialog}
        onDialog={(next) => {
          if (targetSelection && session.busy) return;
          if (next) {
            setTargetSelection(null);
            setConfirmation(null);
          }
          setDialog(next);
        }}
        menu={
          <OnlineMenu
            notify={(message) => {
              setDialog('');
              notify(message);
            }}
            snapshot={view.snapshot!}
            choose={(item) => {
              void choose(item);
            }}
            home={home}
          />
        }
      />
      {confirmation && (
        <Dialog
          title={confirmation.item.label}
          closeDisabled={session.busy}
          onClose={() => setConfirmation(null)}
          actions={
            <button
              className="primary"
              aria-disabled={session.busy}
              onClick={() => void choose(confirmation.item, confirmation.target, true)}
            >
              확인
            </button>
          }
        >
          {confirmation.target && <p>{confirmation.target.name}</p>}
          <p>{confirmation.item.confirm}</p>
        </Dialog>
      )}
      {toast.message && (
        <div className="toast" role="status">
          {toast.message}
        </div>
      )}
    </main>
  );
}
