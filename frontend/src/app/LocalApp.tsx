import { useChipMotion } from '../ui/useChipMotion';
import { useScreenFit } from '../ui/useScreenFit';
import { useLocalPWA } from '../pwa/register';
import { UpdateNotice } from '../pwa/UpdateNotice';
import { usePwaPresentation } from './usePwaPresentation';
import { InstallNotice } from '../pwa/InstallNotice';
import { HistoryPanel } from '../ui/HistoryPanel';
import { BlindSettings } from '../ui/BlindSettings';
import { ManagerMenu } from '../ui/ManagerMenu';
import { SettlementPanel } from '../ui/SettlementPanel';
import { PayoutPreview } from '../ui/PayoutPreview';
import { BetControls } from '../ui/BetControls';
import { useEffect, useRef, useState } from 'react';
import type { ControlLease } from '../local/repository';
import { buildTableView } from './tableView';
import { Table } from '../ui/Table';
import { GameHeader } from '../ui/GameHeader';
import { SetupPanel } from '../ui/SetupPanel';
import { LocalHome } from '../ui/LocalHome';
import { Dialog } from '../ui/Dialog';
import { useSetupEditing } from './useSetupEditing';
import { useLocalSession } from './useLocalSession';
import { useBettingDraft } from './useBettingDraft';
import { useSettlementSelection } from './useSettlementSelection';
import '../ui/tokens.css';
import '../ui/table.css';
import '../ui/controls.css';
export function LocalApp() {
  if (location.pathname.startsWith('/online/'))
    return (
      <main className="phone home">
        <h1>멀티플레이 모드 · 준비 중</h1>
        <a href="/local/">앱 홈으로</a>
      </main>
    );
  if (!location.pathname.startsWith('/local/')) return <AppRedirect />;
  return <LocalWorkspace />;
}
function LocalWorkspace() {
  const [updateDeferred, setUpdateDeferred] = useState(false);
  const [recovery, setRecovery] = useState({
    version: 0,
    inGame: false,
    lease: null as ControlLease | null,
  });
  return (
    <LocalGame
      key={recovery.version}
      restartOnMount={recovery.version > 0}
      updateDeferred={updateDeferred}
      onDeferUpdate={() => setUpdateDeferred(true)}
      recoveryContext={recovery}
      onRecover={(inGame, lease) =>
        setRecovery((previous) => ({ version: previous.version + 1, inGame, lease }))
      }
    />
  );
}
function AppRedirect() {
  useEffect(() => {
    location.replace('/local/');
  }, []);
  return <main className="phone home">앱 홈을 여는 중…</main>;
}
function LocalGame({
  updateDeferred,
  onDeferUpdate,
  restartOnMount,
  recoveryContext,
  onRecover,
}: {
  updateDeferred: boolean;
  onDeferUpdate: () => void;
  restartOnMount: boolean;
  recoveryContext: { inGame: boolean; lease: ControlLease | null };
  onRecover: (inGame: boolean, lease: ControlLease | null) => void;
}) {
  const screen = useRef<HTMLElement>(null);
  useScreenFit(screen);
  const pwa = useLocalPWA();
  const [dialog, setDialog] = useState(''),
    [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const {
    app,
    generation,
    repository,
    isLocked,
    hasPending,
    getSettings,
    restore,
    restartAfterFailure,
    dispatch,
    run,
    continueGame,
    enterLocalGame,
    newGame,
    retryStorage,
    goHome,
  } = useLocalSession({
    restartOnMount,
    recoveryContext,
    onRecover,
    notify,
    prepareCommand: (state, command) => {
      const prepared = motion.prepare(state, command);
      return () => motion.play(prepared);
    },
  });
  const s = app.game,
    busy = app.status !== 'ready';
  const motion = useChipMotion(
    screen,
    `${app.home}/${s?.tournamentId}/${generation}/${app.status === 'controlLost'}`,
  );
  const { install, update } = usePwaPresentation({
    pwa,
    home: app.home,
    busy,
    dialog,
    updateDeferred,
    setDialog,
    onDeferUpdate,
    isLocked,
    hasPending,
    readSavedState: () => repository.load(),
    notify,
  });
  const { scope, drag, saveSettings, changeCount, onNameEditing, rename, rotate, start, clearEditing } =
    useSetupEditing({ state: s, generation, busy, notify, isLocked, getSettings, run, dispatch });
  const { legal, draftAmount, submitAllowed, prepareAction } = useBettingDraft(s, generation, notify);
  const { pots, winners, potIndex, currentPot, preview, navigation, selectWinner, resetWinners } =
    useSettlementSelection(s, generation, busy, notify);
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }
  function bettingAction(action: string, amount = 0) {
    if (busy || isLocked())
      return notify(
        app.status === 'controlLost'
          ? '다른 화면에서 조작 중입니다.'
          : '저장 완료 또는 재시도를 기다려주세요.',
      );
    if (action === 'UNDO') {
      if (!s?.undo) return notify('취소할 직전 행동이 없습니다.');
      void run(async () => {
        if (await dispatch({ type: 'UNDO' })) {
          resetWinners();
          setToast('');
        }
      });
      return;
    }
    const command = prepareAction(action, amount);
    if (!command) return;
    void run(async () => {
      await dispatch(command);
    });
  }
  if (app.status === 'loading')
    return (
      <main ref={screen} className="phone home" role="status">
        저장 상태 확인 중…
      </main>
    );
  if (app.status === 'restoreError')
    return (
      <main ref={screen} className="phone home">
        <p role="alert">저장 정보를 불러오지 못했습니다.</p>
        <p>{app.error}</p>
        <button onClick={() => void restore(true)}>다시 시도</button>
        <button onClick={() => void restartAfterFailure()}>새 토너먼트 시작</button>
      </main>
    );
  return (
    <main ref={screen} className="phone" aria-busy={app.status === 'saving'}>
      {app.error && (
        <div className="notice" role="alert">
          {app.error}
          {app.status === 'storageError' && (
            <button
              onClick={() =>
                void retryStorage(() => {
                  resetWinners();
                  setToast('');
                })
              }
            >
              재시도
            </button>
          )}
          {app.status === 'controlLost' && (
            <button onClick={() => void continueGame()}>이 창에서 조작하기</button>
          )}
        </div>
      )}
      {app.home && pwa.offlineError && (
        <p className="notice" role="alert">
          {pwa.offlineError}
        </p>
      )}
      {app.home ? (
        <LocalHome
          busy={(busy && app.status !== 'controlLost') || update.closeDisabled}
          onLocal={() => void enterLocalGame()}
          onUpdate={update.open}
          hasUpdate={pwa.hasUpdate}
          onInstall={install.available ? install.open : undefined}
        />
      ) : (
        s && (
          <>
            <GameHeader
              handNumber={s.hand?.number ?? 1}
              sb={s.hand?.sb ?? s.settings.sb}
              bb={s.hand?.bb ?? s.settings.bb}
              pendingBlinds={s.status === 'playing' ? s.pendingBlinds : null}
              canEditBlinds={s.status === 'playing' && !busy}
              onHistory={() => setDialog('history')}
              onBlinds={() => setDialog('blinds')}
              onMenu={() => setDialog('menu')}
            />
            <Table
              {...buildTableView(s, { draftAmount, pots, potIndex, winners })}
              onSelect={currentPot ? selectWinner : undefined}
              onPot={() => {
                if (currentPot) setDialog('payout');
              }}
              navigation={navigation}
              drag={s.status === 'setup' ? drag : undefined}
              busy={busy}
              editScope={scope}
              onNameEditing={onNameEditing}
              onRename={rename}
              onAdd={() => changeCount(true)}
              onRemove={() => changeCount(false)}
              onRotate={rotate}
            />
            <section className="dock">
              {s.status === 'ended' && (
                <button
                  aria-disabled={busy || !s.undo}
                  data-unavailable={!s.undo}
                  onClick={() => bettingAction('UNDO')}
                >
                  취소
                </button>
              )}
              {currentPot && (
                <SettlementPanel
                  count={winners[currentPot.id].length}
                  canUndo={!!s.undo}
                  onUndo={() => bettingAction('UNDO')}
                  busy={busy}
                  onWin={() => {
                    if (busy) return notify('저장 완료 또는 재시도를 기다려주세요.');
                    if (!preview?.ok) return notify(preview?.error ?? '승자를 선택하세요.');
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
                  canUndo={!!s.undo}
                  busy={busy}
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
                    generation +
                    ':' +
                    s.settings.initial +
                    ':' +
                    s.settings.sb +
                    ':' +
                    s.settings.bb
                  }
                  settings={s.settings}
                  busy={busy}
                  onSave={saveSettings}
                  onStart={start}
                />
              )}
            </section>
          </>
        )
      )}
      {update.visible && (
        <Dialog
          dismissOutside
          closeDisabled={update.closeDisabled}
          title="앱 업데이트"
          onClose={update.close}
        >
          <UpdateNotice
            {...pwa}
            automatic={update.automatic}
            onLater={update.close}
            canApply={update.canApply}
            onCheck={update.check}
            onApply={update.apply}
          />
        </Dialog>
      )}
      {dialog === 'payout' && s && (
        <Dialog title="지급 미리보기" onClose={() => setDialog('')}>
          <PayoutPreview state={s} pots={pots} winners={winners} preview={preview} />
        </Dialog>
      )}
      {dialog === 'menu' && s && (
        <Dialog dismissOutside title="관리 메뉴" onClose={() => setDialog('')}>
          <ManagerMenu
            onHome={() => {
              goHome(() => {
                clearEditing();
                setDialog('');
              });
            }}
            onNew={() => void newGame(() => setDialog(''))}
          />
        </Dialog>
      )}
      {dialog === 'history' && s && (
        <Dialog
          dismissOutside
          showTitle={false}
          scrollable
          title="현재 토너먼트 기록"
          onClose={() => setDialog('')}
        >
          <HistoryPanel repository={repository} state={s} />
        </Dialog>
      )}
      {dialog === 'blinds' && s && (
        <Dialog dismissOutside title="다음 핸드 블라인드" onClose={() => setDialog('')}>
          <BlindSettings
            key={s.tournamentId + ':' + generation}
            state={s}
            busy={busy}
            onSave={(sb, bb) => {
              if (busy) return notify('저장 완료를 기다려주세요.');
              void run(async () => {
                if (await dispatch({ type: 'SCHEDULE_BLINDS', sb, bb })) setDialog('');
              });
            }}
          />
        </Dialog>
      )}
      <InstallNotice install={install} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
