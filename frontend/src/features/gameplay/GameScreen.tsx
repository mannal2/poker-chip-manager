import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { Dialog } from '../../shared/ui/Dialog';
import { BetControls, type BetAction } from './components/BetControls';
import { BlindSettings } from './components/BlindSettings';
import { GameHeader } from './components/GameHeader';
import { GameHistoryPanel } from './components/GameHistoryPanel';
import { PayoutPreview } from './components/PayoutPreview';
import { SettlementPanel } from './components/SettlementPanel';
import { SetupPanel } from './components/SetupPanel';
import { Table } from './components/Table';
import { useBettingDraft } from './hooks/useBettingDraft';
import { useSettlementSelection } from './hooks/useSettlementSelection';
import { permits, type GameCapabilities } from './model/capabilities';
import { messageFor } from './model/errorMessages';
import { buildTableView } from './model/tableView';
import type { GameCommand } from '../../game/types';
import type { GameDialog, GameScreenHandle, GameSession, SetupControls } from './session';

// 모드와 무관한 게임 화면으로, 헤더/테이블/하단 조작부/대화상자를 구성한다
/** Mode-independent game screen: header, table, dock and game dialogs. */
export function GameScreen({
  session,
  setup,
  dialog,
  onDialog,
  menu,
  onUndoApplied,
  ref,
}: {
  session: GameSession;
  setup: SetupControls;
  dialog: string;
  onDialog: (dialog: GameDialog | '') => void;
  menu: ReactNode;
  onUndoApplied?: () => void;
  ref?: Ref<GameScreenHandle>;
}) {
  const { state: s, busy, scope, notify, run, capabilities: can } = session;
  // 필요한 권한에 맞는 모드별 거절 문구를 알린다.
  function deny(need: keyof GameCapabilities) {
    notify(session.denied?.(need) ?? '조작 권한이 없습니다.');
  }
  // 권한을 확인한 뒤 세션으로 명령을 전달한다
  /** Capability check shared by every command the screen issues itself. */
  async function dispatch(command: GameCommand) {
    if (!permits(can, command.type)) {
      deny(
        command.type === 'UNDO'
          ? 'canUndo'
          : command.type === 'SETTLE_HAND'
            ? 'canSettle'
            : command.type === 'SCHEDULE_BLINDS'
              ? 'canEditBlinds'
              : command.type === 'SETUP_UPDATE' || command.type === 'START_TOURNAMENT'
                ? 'canEditSetup'
                : 'canAct',
      );
      return false;
    }
    return session.dispatch(command);
  }
  const bettingScope = scope === undefined ? undefined : s.tournamentId + ':' + scope;
  const settlementScope = s.tournamentId + '/' + s.hand?.id + '/' + scope;
  const initialBlinds = s.pendingBlinds ?? s.hand;
  const blindScope = s.tournamentId + '/' + s.status + '/' + s.hand?.id + '/' + s.hand?.phase;
  const previousBlindScope = useRef(blindScope);
  // 열린 블라인드 폼을 다른 핸드나 단계에 재사용하지 않도록 화면 전환 전에 닫는다.
  useLayoutEffect(() => {
    if (
      dialog === 'blinds' &&
      (s.status !== 'playing' || previousBlindScope.current !== blindScope)
    )
      onDialog('');
    previousBlindScope.current = blindScope;
  }, [blindScope, dialog, onDialog, s.status]);
  const { changeCount } = setup;
  const legal = session.legal;
  const { draftAmount, submitAllowed, prepareAction, resetDraft } = useBettingDraft(
    s,
    legal,
    bettingScope,
    notify,
  );
  const { pots, winners, potIndex, currentPot, preview, navigation, selectWinner, resetWinners } =
    useSettlementSelection(
      s,
      settlementScope,
      busy,
      notify,
      session.sharedSelection,
      can.canSettle ? session.onSelectionChange : undefined,
    );
  useImperativeHandle(ref, () => ({
    // 외부 취소가 확정되면 정산 선택과 베팅 초안을 함께 폐기한다.
    resetSelection: () => {
      resetWinners();
      resetDraft();
    },
  }));
  const close = () => onDialog('');
  // 직전 행동 취소를 권한/상태 확인 후 실행한다
  function undo() {
    const blocked = session.guard();
    if (blocked) return notify(blocked);
    if (!can.canUndo) return deny('canUndo');
    if (!s.undo) return notify('취소할 직전 행동이 없습니다.');
    void run(async () => {
      if (await dispatch({ type: 'UNDO' })) {
        resetWinners();
        onUndoApplied?.();
      }
    });
  }
  // 베팅 버튼 입력을 명령으로 만들어 실행한다
  function bettingAction(action: BetAction, amount = 0) {
    const blocked = session.guard();
    if (blocked) return notify(blocked);
    if (!can.canAct) return deny('canAct');
    const command = prepareAction(action, amount);
    if (!command) return;
    void run(async () => {
      await dispatch(command);
    });
  }
  return (
    <>
      <GameHeader
        handNumber={s.hand?.number ?? 1}
        sb={s.hand?.sb ?? s.settings.sb}
        bb={s.hand?.bb ?? s.settings.bb}
        pendingBlinds={s.status === 'playing' ? s.pendingBlinds : null}
        canEditBlinds={s.status === 'playing' && !busy && can.canEditBlinds}
        onHistory={() => onDialog('history')}
        onBlinds={() => onDialog('blinds')}
        onMenu={() => onDialog('menu')}
      />
      <Table
        {...buildTableView(s, {
          draftAmount,
          pots,
          potIndex,
          winners,
          disconnectedIds: session.disconnectedIds,
        })}
        viewSeat={session.viewSeat}
        boardReveal={session.boardReveal}
        onSelect={currentPot && can.canSettle ? selectWinner : undefined}
        onPot={() => {
          if (currentPot) onDialog('payout');
        }}
        navigation={navigation}
        busy={busy}
        setup={
          s.status === 'setup'
            ? {
                drag: can.canEditSetup ? setup.drag : undefined,
                editScope: setup.scope,
                onNameEditing: setup.onNameEditing,
                onRename: session.canRename || can.canEditSetup ? setup.rename : undefined,
                canRename: session.canRename,
                onAdd: can.canEditSetup && changeCount ? () => changeCount(true) : undefined,
                onRemove: can.canEditSetup && changeCount ? () => changeCount(false) : undefined,
                onRotate: setup.rotate,
              }
            : undefined
        }
      />
      <section
        className="dock"
        // 전체 설정 권한이 없는 시작 버튼 입력을 차단하고 이유를 알린다.
        onClickCapture={(event) => {
          if (
            s.status === 'setup' &&
            !can.canEditSetup &&
            (event.target as HTMLElement).closest('button')
          ) {
            event.stopPropagation();
            event.preventDefault();
            deny('canEditSetup');
          }
        }}
      >
        {session.dockNotice && (
          <div className="dock-notice" role="status">
            {session.dockNotice}
          </div>
        )}
        {s.status === 'ended' && (
          <button
            aria-disabled={busy || !s.undo || !can.canUndo}
            data-unavailable={!s.undo || !can.canUndo}
            onClick={undo}
          >
            취소
          </button>
        )}
        {currentPot && (
          <SettlementPanel
            count={winners[currentPot.id].length}
            canUndo={!!s.undo && can.canUndo}
            onUndo={undo}
            busy={busy || !can.canSettle}
            onWin={() => {
              if (busy) return notify('저장 완료 또는 재시도를 기다려주세요.');
              if (!can.canSettle) return deny('canSettle');
              if (!preview?.ok)
                return notify(preview?.error ? messageFor(preview.error) : '승자를 선택하세요.');
              void run(async () => {
                await dispatch({ type: 'SETTLE_HAND', winners });
              });
            }}
          />
        )}
        {s.status === 'ended' && (
          <div className="summary">
            토너먼트 종료 · {s.players.find((p) => !p.eliminated)?.name} 우승
          </div>
        )}
        {s.status === 'aborted' && (
          <div className="summary">
            토너먼트 중단 · 미정산 팟 {s.pot.toLocaleString('ko-KR')} 보존
          </div>
        )}
        {(s.status === 'ended' || s.status === 'aborted') && session.resultActions}
        {s.status === 'playing' && s.hand?.phase === 'betting' && (
          <BetControls
            call={legal?.callAdditional}
            canUndo={!!s.undo && can.canUndo}
            busy={busy}
            canBet={can.canAct}
            draftAmount={draftAmount}
            maxAdditional={legal?.maxAdditional}
            submitAllowed={submitAllowed}
            onAction={bettingAction}
            onUndo={undo}
          />
        )}{' '}
        {s.status === 'setup' && (
          <SetupPanel
            key={
              s.tournamentId +
              ':' +
              scope +
              ':' +
              s.settings.initial +
              ':' +
              s.settings.sb +
              ':' +
              s.settings.bb
            }
            settings={s.settings}
            validate={setup.validateSettings}
            busy={busy || !can.canEditSetup}
            onSave={setup.saveSettings}
            onStart={setup.start}
          />
        )}
      </section>
      {dialog === 'payout' && (
        <Dialog title="지급 미리보기" onClose={close}>
          <PayoutPreview state={s} pots={pots} winners={winners} preview={preview} />
        </Dialog>
      )}
      {dialog === 'menu' && (
        <Dialog dismissOutside title="관리 메뉴" onClose={close}>
          {menu}
        </Dialog>
      )}
      {dialog === 'history' && (
        <Dialog
          dismissOutside
          showTitle={false}
          scrollable
          title="현재 토너먼트 기록"
          onClose={close}
        >
          <GameHistoryPanel loadEvents={session.loadEvents} state={s} />
        </Dialog>
      )}
      {dialog === 'blinds' && s.status === 'playing' && initialBlinds && (
        <Dialog dismissOutside title="다음 핸드 블라인드" onClose={close}>
          <div
            // 예약 폼의 자체 잠금 처리 전에 권한 거절 이유를 알린다.
            onSubmitCapture={(event) => {
              if (!can.canEditBlinds) {
                event.preventDefault();
                event.stopPropagation();
                deny('canEditBlinds');
              }
            }}
          >
            <BlindSettings
              key={s.tournamentId + ':' + scope}
              initialSB={initialBlinds.sb}
              initialBB={initialBlinds.bb}
              busy={busy || !can.canEditBlinds}
              onSave={(sb, bb) => {
                if (busy) return notify('저장 완료를 기다려주세요.');
                void run(async () => {
                  if (await dispatch({ type: 'SCHEDULE_BLINDS', sb, bb })) close();
                });
              }}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
