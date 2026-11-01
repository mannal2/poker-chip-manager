import { useEffect, useRef, useState } from 'react';
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
import type { RoomParticipant, ServerCommand } from './api/types';
import '../gameplay/styles/header.css';
import '../gameplay/styles/table.css';
import '../gameplay/styles/controls.css';

// 온라인 방의 연결 안내와 공통 게임 화면 및 토스트를 조립한다.
export function RoomPage({ view, controller }: { view: OnlineView; controller: OnlineController }) {
  const screen = useRef<HTMLElement>(null);
  useScreenFit(screen);
  const [dialog, setDialog] = useState('');
  const [confirmation, setConfirmation] = useState<{
    item: MenuItem;
    target?: RoomParticipant;
  } | null>(null);
  const game = useRef<GameScreenHandle>(null);
  const { session, setup, toast, resetSelection } = useOnlineGameSession(view, controller);
  const notify = toast.show;
  // 최신 연결 상태와 조작권을 확인하고 서버 관리 명령을 보낸다.
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
  // 메뉴를 연 뒤 대상 상태가 바뀌어도 최신 서버 스냅샷으로 확인한다.
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
      (target && !valid.targets?.some((p) => p.participantId === target.participantId))
    ) {
      setConfirmation(null);
      setDialog('');
      return notify('대상 또는 상태가 변경되었습니다. 다시 확인하세요.');
    }
    if (item.command?.type === 'FORFEIT' && current.hostId === current.you.participantId)
      return notify('먼저 방장을 넘겨주세요');
    if (item.confirm && !confirmed) {
      setDialog('');
      setConfirmation({ item, target });
      return;
    }
    const command = {
      ...valid.command!,
      ...(target ? { payload: { participantId: target.participantId } } : {}),
    };
    setConfirmation(null);
    await send(command);
    setDialog('');
  }
  // 참가 자격은 보존하고 화면 자원을 해제한 뒤 앱 홈으로 문서 이동한다.
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
      controller.onConfirmed(({ events }) => {
        if (events.some((event) => event.type === 'UNDO')) {
          resetSelection();
          game.current?.resetSelection();
        }
        for (const message of noticesFor(events, controller.getKnownEvents())) notify(message);
      }),
    [controller, resetSelection, notify],
  );
  return (
    <main ref={screen} className="phone online-room" aria-busy={view.pending}>
      <ConnectionBanner view={view} controller={controller} />
      <HostRequests
        snapshot={view.snapshot!}
        busy={session.busy}
        send={(command) => {
          void send(command);
        }}
      />
      {view.snapshot!.roomPhase === 'WAITING' && (
        <WaitingBar code={view.snapshot!.code} notify={session.notify} />
      )}
      {view.error && (
        <div className="notice" role="alert">
          {view.error}
          <button onClick={() => void controller.retry()}>재시도</button>
        </div>
      )}
      <GameScreen
        ref={game}
        session={session}
        setup={setup}
        dialog={dialog}
        onDialog={setDialog}
        menu={
          <OnlineMenu
            snapshot={view.snapshot!}
            choose={(item, target) => {
              void choose(item, target);
            }}
            home={home}
          />
        }
      />
      {confirmation && (
        <Dialog title={confirmation.item.label} onClose={() => setConfirmation(null)}>
          {confirmation.target && <p>{confirmation.target.name}</p>}
          <p>{confirmation.item.confirm}</p>
          <button
            aria-disabled={session.busy}
            onClick={() => void choose(confirmation.item, confirmation.target, true)}
          >
            확인
          </button>
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
