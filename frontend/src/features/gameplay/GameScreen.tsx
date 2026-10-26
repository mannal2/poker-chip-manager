import { useImperativeHandle, type ReactNode, type Ref } from 'react';
import { Dialog } from '../../shared/ui/Dialog';
import { BetControls } from './components/BetControls';
import { BlindSettings } from './components/BlindSettings';
import { GameHeader } from './components/GameHeader';
import { PayoutPreview } from './components/PayoutPreview';
import { SettlementPanel } from './components/SettlementPanel';
import { SetupPanel } from './components/SetupPanel';
import { Table } from './components/Table';
import { useBettingDraft } from './hooks/useBettingDraft';
import { useSettlementSelection } from './hooks/useSettlementSelection';
import { permits } from './model/capabilities';
import { messageFor } from './model/errorMessages';
import { buildTableView } from './model/tableView';
import type { GameCommand } from '../../game/types';
import type { GameDialog, GameScreenHandle, GameSession, SetupControls } from './session';

/** Mode-independent game screen: header, table, dock and game dialogs. */
export function GameScreen({
  session,
  setup,
  dialog,
  onDialog,
  menu,
  history,
  onUndoApplied,
  ref,
}: {
  session: GameSession;
  setup: SetupControls;
  dialog: string;
  onDialog: (dialog: GameDialog | '') => void;
  menu: ReactNode;
  history: ReactNode;
  onUndoApplied?: () => void;
  ref?: Ref<GameScreenHandle>;
}) {
  const { state: s, busy, scope, notify, run, capabilities: can } = session;
  /** Capability check shared by every command the screen issues itself. */
  async function dispatch(command: GameCommand) {
    if (!permits(can, command.type)) {
      notify('조작 권한이 없습니다.');
      return false;
    }
    return session.dispatch(command);
  }
  const bettingScope = scope === undefined ? undefined : s.tournamentId + ':' + scope;
  const settlementScope = s.tournamentId + '/' + s.hand?.id + '/' + scope;
  const initialBlinds = s.pendingBlinds ?? s.hand;
  const { changeCount } = setup;
  const legal = session.legal;
  const { draftAmount, submitAllowed, prepareAction } = useBettingDraft(
    s,
    legal,
    bettingScope,
    notify,
  );
  const { pots, winners, potIndex, currentPot, preview, navigation, selectWinner, resetWinners } =
    useSettlementSelection(s, settlementScope, busy, notify);
  useImperativeHandle(ref, () => ({ resetSelection: resetWinners }));
  const close = () => onDialog('');
  function bettingAction(action: string, amount = 0) {
    const blocked = session.guard();
    if (blocked) return notify(blocked);
    if (action === 'UNDO') {
      if (!can.canUndo) return notify('조작 권한이 없습니다.');
      if (!s.undo) return notify('취소할 직전 행동이 없습니다.');
      void run(async () => {
        if (await dispatch({ type: 'UNDO' })) {
          resetWinners();
          onUndoApplied?.();
        }
      });
      return;
    }
    if (!can.canAct) return notify('조작 권한이 없습니다.');
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
        {...buildTableView(s, { draftAmount, pots, potIndex, winners })}
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
                onRename: can.canEditSetup ? setup.rename : undefined,
                onAdd: can.canEditSetup && changeCount ? () => changeCount(true) : undefined,
                onRemove: can.canEditSetup && changeCount ? () => changeCount(false) : undefined,
                onRotate: setup.rotate,
              }
            : undefined
        }
      />
      <section className="dock">
        {s.status === 'ended' && (
          <button
            aria-disabled={busy || !s.undo || !can.canUndo}
            data-unavailable={!s.undo || !can.canUndo}
            onClick={() => bettingAction('UNDO')}
          >
            취소
          </button>
        )}
        {currentPot && (
          <SettlementPanel
            count={winners[currentPot.id].length}
            canUndo={!!s.undo && can.canUndo}
            onUndo={() => bettingAction('UNDO')}
            busy={busy || !can.canSettle}
            onWin={() => {
              if (busy) return notify('저장 완료 또는 재시도를 기다려주세요.');
              if (!can.canSettle) return notify('조작 권한이 없습니다.');
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
        {s.status === 'playing' && s.hand?.phase === 'betting' && (
          <BetControls
            call={legal?.callAdditional}
            canUndo={!!s.undo && can.canUndo}
            busy={busy || !can.canAct}
            draftAmount={draftAmount}
            maxAdditional={legal?.maxAdditional}
            submitAllowed={submitAllowed}
            onAction={bettingAction}
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
          {history}
        </Dialog>
      )}
      {dialog === 'blinds' && (
        <Dialog dismissOutside title="다음 핸드 블라인드" onClose={close}>
          <BlindSettings
            key={s.tournamentId + ':' + scope}
            initialSB={initialBlinds!.sb}
            initialBB={initialBlinds!.bb}
            busy={busy || !can.canEditBlinds}
            onSave={(sb, bb) => {
              if (busy) return notify('저장 완료를 기다려주세요.');
              void run(async () => {
                if (await dispatch({ type: 'SCHEDULE_BLINDS', sb, bb })) close();
              });
            }}
          />
        </Dialog>
      )}
    </>
  );
}
