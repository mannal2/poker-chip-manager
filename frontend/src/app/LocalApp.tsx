import { useChipMotion } from '../ui/useChipMotion';
import { useScreenFit } from '../ui/useScreenFit';
import { useLocalPWA } from '../pwa/register';
import { UpdateNotice } from '../pwa/UpdateNotice';
import { useInstallPrompt } from '../pwa/useInstallPrompt';
import { InstallNotice } from '../pwa/InstallNotice';
import { HistoryPanel } from '../ui/HistoryPanel';
import { BlindSettings } from '../ui/BlindSettings';
import { ManagerMenu } from '../ui/ManagerMenu';
import { SettlementPanel } from '../ui/SettlementPanel';
import { PayoutPreview } from '../ui/PayoutPreview';
import { BetControls } from '../ui/BetControls';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { LocalRepository, type Request, type ControlLease } from '../local/repository';
import { LocalController } from '../local/controller';
import { defaultSettings, validateSettings, type GameSettings } from '../game/settings';
import { nextSeat } from '../game/positions';
import { Table } from '../ui/Table';
import { SetupPanel } from '../ui/SetupPanel';
import { LocalHome } from '../ui/LocalHome';
import { Dialog } from '../ui/Dialog';
import { useSeatDrag } from '../ui/useSeatDrag';
import { appReducer, initialAppState } from './appReducer';
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
  const [app, setApp] = useReducer(appReducer, {
      ...initialAppState,
      home: !recoveryContext.inGame,
    }),
    [dialog, setDialog] = useState(''),
    [toast, setToast] = useState(''),
    [renameId, setRenameId] = useState('');
  const inGame = useRef(recoveryContext.inGame);
  const resumeRequested = useRef(false);
  const lock = useRef(false),
    finishName = useRef<{ key: string; finish: () => Promise<boolean> } | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runtime] = useState(() => {
    const repo = new LocalRepository(
      'poker-chip-manager',
      () =>
        setApp({
          status: 'restoreError',
          error: '다른 창을 닫으면 저장소 업그레이드를 계속합니다.',
        }),
      () =>
        setApp({ status: 'restoreError', error: '저장소 연결이 변경되었습니다. 다시 열어주세요.' }),
    );
    const controller = new LocalController(
      repo,
      recoveryContext.lease?.screenId ?? crypto.randomUUID(),
    );
    controller.lease = recoveryContext.lease ? { ...recoveryContext.lease } : null;
    return {
      repo,
      controller,
      channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('poker-local'),
    };
  });
  const c = runtime.controller,
    s = app.game,
    busy = app.status !== 'ready';
  const motion = useChipMotion(
    screen,
    `${app.home}/${s?.tournamentId}/${c.lease?.generation}/${app.status === 'controlLost'}`,
  );
  const pendingMotion = useRef<{
    requestId: string;
    prepared: ReturnType<typeof motion.prepare>;
  } | null>(null);
  const install = useInstallPrompt(app.home && !busy && !dialog);
  const automaticUpdate =
    dialog === 'startupUpdate' ||
    (app.home && !busy && !dialog && pwa.hasUpdate && !updateDeferred && !install.visible);
  const closeUpdate = () => {
    if (pwa.hasUpdate) onDeferUpdate();
    pwa.cancelCheck();
    setDialog('');
  };
  const draftScope = s?.tournamentId + ':' + c.lease?.generation;
  const { legal, draftAmount, submitAllowed, prepareAction } = useBettingDraft(
    s,
    c.lease?.generation,
    notify,
  );
  const { pots, winners, potIndex, currentPot, preview, navigation, selectWinner, resetWinners } =
    useSettlementSelection(s, c.lease?.generation, busy, notify);
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }
  const restoreVersion = useRef(0);
  const restore = useCallback(
    async (reconnect = false) => {
      const version = ++restoreVersion.current;
      if (reconnect) runtime.repo.reconnect();
      setApp({ status: 'loading', error: '' });
      try {
        await c.refresh();
        if (version !== restoreVersion.current) return;
        setApp({
          game: c.state,
          status: c.pending ? 'storageError' : !inGame.current || c.lease ? 'ready' : 'controlLost',
          error: c.pending
            ? '저장 결과를 확인한 뒤 같은 요청으로 재시도해주세요.'
            : !inGame.current || c.lease
              ? ''
              : '다른 화면이 조작 권한을 인수했습니다.',
        });
      } catch (error) {
        if (version === restoreVersion.current)
          setApp({ status: 'restoreError', error: String(error) });
      }
    },
    [c, runtime],
  );
  const cancelRestore = useCallback(() => {
    restoreVersion.current++;
    c.cancelRefresh();
  }, [c]);
  const finish = useCallback(() => {
    lock.current = false;
    if (resumeRequested.current) {
      resumeRequested.current = false;
      void restore(true);
    }
  }, [restore]);
  useEffect(() => {
    if (restartOnMount) {
      lock.current = true;
      void c
        .restart(defaultSettings)
        .then(
          () => {
            inGame.current = true;
            setApp({ game: c.state, status: 'ready', home: false, error: '' });
            runtime.channel?.postMessage('changed');
          },
          (error) => setApp({ status: 'restoreError', error: String(error) }),
        )
        .finally(finish);
    } else void restore();
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      if (lock.current) {
        resumeRequested.current = true;
        return;
      }
      resumeRequested.current = false;
      void restore(true);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('resume', resume);
    if (runtime.channel)
      runtime.channel.onmessage = (message) => {
        if (message.data?.type === 'probe') {
          if (c.lease && inGame.current)
            runtime.channel?.postMessage({ type: 'owner', requestId: message.data.requestId });
          return;
        }
        if (message.data?.type === 'owner' || lock.current || c.pending) return;
        void restore();
      };
    return () => {
      resumeRequested.current = false;
      cancelRestore();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('resume', resume);
      runtime.channel?.close();
      runtime.repo.dispose();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [c, runtime, restore, cancelRestore, restartOnMount, finish]);
  function restartAfterFailure() {
    if (confirm('현재 토너먼트와 전체 기록을 삭제하고 새 토너먼트를 시작할까요?'))
      onRecover(inGame.current, c.lease);
  }
  async function dispatch(command: Request['command']) {
    const prepared = c.state ? motion.prepare(c.state, command) : null;
    const result = await c.dispatch(command);
    pendingMotion.current =
      result.status === 'UNKNOWN' ? { requestId: result.requestId, prepared } : null;
    if (!c.lease) {
      setApp({
        game: c.state,
        status: 'controlLost',
        error: '다른 화면이 조작 권한을 인수했습니다.',
      });
      return false;
    }
    if (result.status === 'UNKNOWN') {
      setApp({
        status: 'storageError',
        error: `저장 결과를 확인할 수 없습니다: ${result.reason}. 같은 요청으로 재시도하세요.`,
      });
      return false;
    }
    setApp({
      game: c.state,
      status: c.lease ? 'ready' : 'controlLost',
      error: result.reason === 'CONTROL_LOST' ? '다른 화면에서 조작 중입니다.' : '',
    });
    if (result.status === 'REJECTED') {
      notify(result.reason ?? '처리할 수 없습니다.');
      return false;
    }
    if (result.resultVersion === result.state?.version) motion.play(prepared);
    runtime.channel?.postMessage('changed');
    return true;
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) {
      notify('저장 완료를 기다려주세요.');
      return;
    }
    lock.current = true;
    setApp({ status: 'saving' });
    try {
      await action();
    } catch (e) {
      setApp({ status: 'storageError', error: String(e) });
    } finally {
      finish();
    }
  }
  function saveSettings(settings: GameSettings, order?: string[]) {
    if (busy) return notify('저장 완료를 기다려주세요.');
    void run(async () => {
      await dispatch({ type: 'SETUP_UPDATE', settings, order });
    });
  }
  async function activateLocal() {
    await c.takeControl();
    if (!c.state) {
      await runtime.repo.initialize(defaultSettings, c.lease!);
      await c.refresh();
    }
    if (
      c.state?.status === 'playing' &&
      ['revealPending', 'revealed'].includes(c.state.hand?.phase ?? '')
    ) {
      if (!(await dispatch({ type: 'RESUME_FLOW' }))) return;
    }
    inGame.current = true;
    setApp({ game: c.state, status: 'ready', home: false, error: '' });
    runtime.channel?.postMessage('control');
  }
  async function continueGame() {
    if (!lock.current) await run(activateLocal);
  }
  async function otherWindowOwnsGame() {
    const channel = runtime.channel;
    if (!channel || c.lease) return false;
    return new Promise<boolean>((resolve) => {
      const requestId = crypto.randomUUID();
      const finish = (owner: boolean) => {
        clearTimeout(timer);
        channel.removeEventListener('message', listener);
        resolve(owner);
      };
      const listener = (e: MessageEvent) => {
        if (e.data?.type === 'owner' && e.data.requestId === requestId) finish(true);
      };
      const timer = setTimeout(() => finish(false), 180);
      channel.addEventListener('message', listener);
      channel.postMessage({ type: 'probe', requestId });
    });
  }
  async function enterLocalGame() {
    await run(async () => {
      await c.refresh();
      if (await otherWindowOwnsGame()) {
        inGame.current = true;
        setApp({
          game: c.state,
          status: 'controlLost',
          home: false,
          error: '다른 창에서 조작 중입니다.',
        });
        return;
      }
      await activateLocal();
    });
  }
  async function newGame() {
    if (lock.current || c.pending) {
      restartAfterFailure();
      return;
    }
    if (s && !confirm('현재 토너먼트와 전체 기록을 삭제하고 새 토너먼트를 준비할까요?')) return;
    await run(async () => {
      await c.takeControl();
      if (
        c.state &&
        c.state.tournamentId !== s?.tournamentId &&
        !confirm(
          '다른 화면에서 새 토너먼트가 저장되었습니다. 현재 게임과 기록을 삭제하고 교체할까요?',
        )
      ) {
        setApp({
          game: c.state,
          status: c.lease ? 'ready' : 'controlLost',
          error: c.lease ? '' : '다른 화면이 조작 권한을 인수했습니다.',
        });
        runtime.channel?.postMessage('control');
        return;
      }
      if (!c.state) {
        await runtime.repo.initialize(defaultSettings, c.lease!);
        await c.refresh();
        setApp({ game: c.state, status: 'ready', home: false, error: '' });
      } else if (
        await dispatch({
          type: 'NEW_TOURNAMENT',
          settings: {
            ...c.state.settings,
            names: [...defaultSettings.names],
            button: -1,
            viewSeat: 0,
          },
        })
      )
        setApp({ home: false });
      setDialog('');
      runtime.channel?.postMessage('changed');
    });
  }
  const drag = useSeatDrag(
    s?.players.map((p) => p.id) ?? [],
    !busy && s?.status === 'setup' && !renameId.startsWith(draftScope + ':'),
    s?.settings.viewSeat ?? 0,
    (order) => {
      if (!s) return;
      const players = order.map((id) => s.players.find((p) => p.id === id)!);
      const buttonId = s.players[s.settings.button]?.id;
      saveSettings(
        {
          ...s.settings,
          names: players.map((p) => p.name),
          button: buttonId ? order.indexOf(buttonId) : -1,
        },
        order,
      );
    },
    (id) => {
      if (s) saveSettings({ ...s.settings, button: s.players.findIndex((p) => p.id === id) });
    },
    () => {
      const editor = finishName.current;
      return editor?.key.startsWith(draftScope + ':')
        ? editor.finish()
        : Promise.resolve(!busy && !lock.current);
    },
  );
  function changeCount(add: boolean) {
    if (!s || busy || s.status !== 'setup') return;
    const n = s.players.length;
    if (add) {
      if (n >= 10) return;
      const settings = { ...s.settings, names: [...s.settings.names, `P${n + 1}`] };
      const v = validateSettings(settings);
      if (!v.ok)
        return notify(`P${n + 1} 이름이 이미 사용 중입니다. 해당 이름을 변경한 뒤 추가하세요.`);
      saveSettings(v.settings);
    } else {
      if (n <= 2) return;
      const latest = (s.setupOrder ?? s.players.map((p) => p.id)).at(-1)!;
      const players = s.players.filter((p) => p.id !== latest);
      const dealer = s.players[s.settings.button]?.id;
      saveSettings(
        {
          ...s.settings,
          names: players.map((p) => p.name),
          button: players.findIndex((p) => p.id === dealer),
          viewSeat: Math.min(s.settings.viewSeat, players.length - 1),
        },
        players.map((p) => p.id),
      );
    }
  }
  function bettingAction(action: string, amount = 0) {
    if (busy || lock.current)
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
  const button = s?.hand?.buttonSeat ?? s?.settings.button ?? 0;
  let sb = button,
    bb = button;
  if (s) {
    if (s.hand) {
      sb = s.hand.sbSeat;
      bb = s.hand.bbSeat;
    } else if (button >= 0) {
      sb =
        s.players.length === 2
          ? button
          : nextSeat(
              button,
              s.players.map(() => true),
            );
      bb = nextSeat(
        sb,
        s.players.map(() => true),
      );
    }
  }
  return (
    <main ref={screen} className="phone" aria-busy={app.status === 'saving'}>
      {app.error && (
        <div className="notice" role="alert">
          {app.error}
          {app.status === 'storageError' && (
            <button
              onClick={() =>
                void run(async () => {
                  runtime.repo.reconnect();
                  if (c.pending) {
                    const command = c.pending.command;
                    const r = await c.retry();
                    if (
                      pendingMotion.current?.requestId === r.requestId &&
                      r.status === 'APPLIED' &&
                      r.resultVersion === r.state?.version
                    )
                      motion.play(pendingMotion.current.prepared);
                    if (r.status !== 'UNKNOWN') pendingMotion.current = null;
                    if (r.status === 'APPLIED' && command.type === 'UNDO') {
                      resetWinners();
                      setToast('');
                    }
                    setApp({
                      game: c.state,
                      status: !c.lease
                        ? 'controlLost'
                        : r.status === 'UNKNOWN'
                          ? 'storageError'
                          : 'ready',
                      error: !c.lease
                        ? '다른 화면이 조작 권한을 인수했습니다.'
                        : r.status === 'UNKNOWN'
                          ? (r.reason ?? '저장 실패')
                          : '',
                    });
                    runtime.channel?.postMessage('changed');
                  } else {
                    await c.refresh();
                    setApp({
                      game: c.state,
                      status: c.lease ? 'ready' : 'controlLost',
                      error: c.lease ? '' : '다른 화면이 조작 권한을 인수했습니다.',
                    });
                  }
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
          busy={(busy && app.status !== 'controlLost') || pwa.updateStatus === 'applying'}
          onLocal={() => void enterLocalGame()}
          onUpdate={() => {
            setDialog('update');
            void pwa.check();
          }}
          hasUpdate={pwa.hasUpdate}
          onInstall={install.available ? install.open : undefined}
        />
      ) : (
        s && (
          <>
            <header className="meta">
              <div className="meta-info">
                <button
                  className="meta-link"
                  aria-label="현재 토너먼트 기록"
                  onClick={() => setDialog('history')}
                >
                  HAND <strong>{String(s.hand?.number ?? 1).padStart(2, '0')}</strong>
                </button>
                <button
                  id="blinds"
                  className="meta-link"
                  aria-label="다음 핸드 블라인드 설정"
                  disabled={s.status !== 'playing' || busy}
                  onClick={() => setDialog('blinds')}
                >
                  <strong>
                    {(s.hand?.sb ?? s.settings.sb).toLocaleString('ko-KR')} /{' '}
                    {(s.hand?.bb ?? s.settings.bb).toLocaleString('ko-KR')}
                  </strong>
                  {s.status === 'playing' && s.pendingBlinds && (
                    <span className="pending-blinds">
                      {' '}
                      → {s.pendingBlinds.sb.toLocaleString('ko-KR')} /{' '}
                      {s.pendingBlinds.bb.toLocaleString('ko-KR')}
                    </span>
                  )}
                </button>
              </div>
              <button id="menu" aria-label="관리 메뉴" onClick={() => setDialog('menu')}>
                ☰
              </button>
            </header>
            <Table
              players={s.players.map((p, i) => ({
                ...p,
                contribution: p.H + (s.hand?.actorId === p.id ? draftAmount : 0),
                pending: s.hand?.actorId === p.id && draftAmount > 0,
                roles: [
                  i === button ? 'D' : '',
                  button >= 0 && i === sb && !p.eliminated ? 'SB' : '',
                  button >= 0 && i === bb ? 'BB' : '',
                  p.eliminated ? '탈락' : p.folded ? '폴드' : p.stack === 0 ? '올인' : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
                active: s.status === 'playing' && s.hand?.actorId === p.id,
                out: p.eliminated,
                selected: currentPot ? winners[currentPot.id].includes(p.id) : false,
                eligible: currentPot?.eligible.includes(p.id),
              }))}
              pot={currentPot?.amount ?? s.pot}
              notice={s.hand && s.players[s.hand.sbSeat].eliminated ? 'SB 없음' : undefined}
              potLabel={
                currentPot && pots.length > 1
                  ? potIndex === 0
                    ? 'MAIN POT'
                    : 'SIDE POT ' + potIndex
                  : undefined
              }
              onSelect={currentPot ? selectWinner : undefined}
              onPot={() => {
                if (currentPot) setDialog('payout');
              }}
              navigation={navigation}
              phase={s.status === 'setup' ? 'setup' : (s.hand?.phase ?? '')}
              street={['PREFLOP', 'FLOP', 'TURN', 'RIVER'][s.hand?.street ?? 0]}
              handKey={s.hand?.id}
              viewSeat={s.settings.viewSeat}
              drag={s.status === 'setup' ? drag : undefined}
              busy={busy}
              editScope={draftScope}
              onNameEditing={(id, editing, finish) => {
                const key = draftScope + ':' + id;
                if (editing) {
                  finishName.current = { key, finish: finish! };
                  setRenameId(key);
                } else if (finishName.current?.key === key) {
                  finishName.current = null;
                  setRenameId('');
                }
              }}
              onRename={
                s.status === 'setup'
                  ? (id, name) => {
                      if (busy || lock.current) return false;
                      const v = validateSettings({
                        ...s.settings,
                        names: s.players.map((p) => (p.id === id ? name : p.name)),
                      });
                      if (!v.ok) {
                        notify(v.error);
                        return false;
                      }
                      if (JSON.stringify(v.settings) === JSON.stringify(s.settings)) return true;
                      return (async () => {
                        let saved = false;
                        await run(async () => {
                          saved = await dispatch({ type: 'SETUP_UPDATE', settings: v.settings });
                        });
                        return saved;
                      })();
                    }
                  : undefined
              }
              onAdd={() => changeCount(true)}
              onRemove={() => changeCount(false)}
              onRotate={
                s.status === 'setup'
                  ? () => {
                      if (busy) return;
                      void run(async () => {
                        await dispatch({
                          type: 'SET_VIEW',
                          viewSeat: (s.settings.viewSeat + s.players.length - 1) % s.players.length,
                        });
                      });
                    }
                  : undefined
              }
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
                    c.lease?.generation +
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
                  onStart={(settings) => {
                    if (renameId.startsWith(draftScope + ':'))
                      return notify('이름 입력을 Enter로 저장하거나 다른 곳을 눌러 완료하세요.');
                    if (busy) return notify('저장 완료를 기다려주세요.');
                    const v = validateSettings(settings);
                    if (!v.ok) return notify(v.error);
                    if (settings.button < 0)
                      return notify('첫 딜러로 시작할 플레이어 카드를 선택하세요.');
                    void run(async () => {
                      if (
                        JSON.stringify(settings) !== JSON.stringify(c.state!.settings) &&
                        !(await dispatch({ type: 'SETUP_UPDATE', settings }))
                      )
                        return;
                      await dispatch({ type: 'START_TOURNAMENT' });
                    });
                  }}
                />
              )}
            </section>
          </>
        )
      )}
      {(dialog === 'update' || automaticUpdate) && (
        <Dialog
          dismissOutside
          closeDisabled={pwa.updateStatus === 'applying'}
          title="앱 업데이트"
          onClose={closeUpdate}
        >
          <UpdateNotice
            {...pwa}
            automatic={automaticUpdate}
            onLater={closeUpdate}
            canApply={app.home && !busy && !c.pending && !lock.current}
            onCheck={() => void pwa.check()}
            onApply={() => {
              if (!app.home || busy || lock.current || c.pending)
                return notify('저장 완료 후 홈에서 업데이트하세요.');
              if (automaticUpdate) setDialog('startupUpdate');
              void pwa.apply(() => runtime.repo.load());
            }}
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
              if (['ready', 'controlLost'].includes(app.status) && !lock.current && !c.pending) {
                inGame.current = false;
                setRenameId('');
                setDialog('');
                setApp({ home: true, status: 'ready', error: '' });
              } else notify('저장 완료를 기다려주세요.');
            }}
            onNew={() => void newGame()}
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
          <HistoryPanel repository={runtime.repo} state={s} />
        </Dialog>
      )}
      {dialog === 'blinds' && s && (
        <Dialog dismissOutside title="다음 핸드 블라인드" onClose={() => setDialog('')}>
          <BlindSettings
            key={s.tournamentId + ':' + c.lease?.generation}
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
