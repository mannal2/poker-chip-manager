import { useScreenFit } from '../ui/useScreenFit';
import { useLocalPWA } from '../pwa/register';
import { UpdateNotice } from '../pwa/UpdateNotice';
import { useInstallPrompt } from '../pwa/useInstallPrompt';
import { InstallNotice } from '../pwa/InstallNotice';
import { HistoryPanel } from '../ui/HistoryPanel';
import { BlindSettings } from '../ui/BlindSettings';
import { ManagerMenu } from '../ui/ManagerMenu';
import { buildPots, previewSettlement } from '../game/settlement';
import { SettlementPanel } from '../ui/SettlementPanel';
import type { WinnerSelection } from '../game/types';
import { getLegalActions } from '../game/transition';
import { BetControls } from '../ui/BetControls';
import type { GameCommand } from '../game/types';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { LocalRepository, type Request } from '../local/repository';
import { LocalController } from '../local/controller';
import { defaultSettings, validateSettings, type GameSettings } from '../game/settings';
import { nextSeat } from '../game/positions';
import { Table } from '../ui/Table';
import { SetupPanel } from '../ui/SetupPanel';
import { LocalHome } from '../ui/LocalHome';
import { Dialog } from '../ui/Dialog';
import { useSeatDrag } from '../ui/useSeatDrag';
import { appReducer, initialAppState } from './appReducer';
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
  return <LocalGame />;
}
function AppRedirect() {
  useEffect(() => {
    location.replace('/local/');
  }, []);
  return <main className="phone home">앱 홈을 여는 중…</main>;
}
function LocalGame() {
  const screen = useRef<HTMLElement>(null);
  useScreenFit(screen);
  const pwa = useLocalPWA();
  const [app, setApp] = useReducer(appReducer, initialAppState),
    [dialog, setDialog] = useState(''),
    [toast, setToast] = useState(''),
    [renameId, setRenameId] = useState(''),
    [draft, setDraft] = useState({ scope: '', version: -1, amount: 0 }),
    [winnerDraft, setWinnerDraft] = useState<{
      key: string;
      winners: WinnerSelection;
      index: number;
    }>({ key: '', winners: {}, index: 0 });
  const inGame = useRef(false);
  const lock = useRef(false),
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
    return {
      repo,
      controller: new LocalController(repo, crypto.randomUUID()),
      channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('poker-local'),
    };
  });
  const c = runtime.controller,
    s = app.game,
    busy = app.status !== 'ready';
  const install = useInstallPrompt(app.home && !busy && !dialog);
  const draftScope = s?.tournamentId + ':' + c.lease?.generation;
  const legal = s ? getLegalActions(s) : null,
    draftAmount =
      s && c.lease && draft.scope === draftScope && draft.version === s.version ? draft.amount : 0;
  const settlementKey = s?.tournamentId + '/' + s?.hand?.id + '/' + c.lease?.generation;
  const pots = s?.status === 'playing' && s.hand?.phase === 'settlement' ? buildPots(s) : [];
  const winners: WinnerSelection = Object.fromEntries(
    pots.map((p) => [
      p.id,
      p.eligible.length === 1
        ? p.eligible
        : winnerDraft.key === settlementKey
          ? (winnerDraft.winners[p.id] ?? [])
          : [],
    ]),
  );
  const potIndex =
      winnerDraft.key === settlementKey ? Math.min(winnerDraft.index, pots.length - 1) : 0,
    currentPot = pots[potIndex];
  const preview = s && pots.length ? previewSettlement(s, winners) : null;
  function selectWinner(id: string) {
    if (busy || !currentPot) return notify('저장 완료를 기다려주세요.');
    if (!currentPot.eligible.includes(id)) return notify('이 팟의 승자 자격이 없습니다.');
    if (currentPot.eligible.length === 1) return notify('단독 자격자는 자동 선택됩니다.');
    const selected = winners[currentPot.id];
    setWinnerDraft({
      key: settlementKey,
      index: potIndex,
      winners: {
        ...winners,
        [currentPot.id]: selected.includes(id)
          ? selected.filter((p) => p !== id)
          : [...selected, id],
      },
    });
  }
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
  useEffect(() => {
    void restore();
    const resume = () => {
      if (document.visibilityState === 'hidden' || lock.current || c.pending) return;
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
      cancelRestore();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('resume', resume);
      runtime.channel?.close();
      runtime.repo.close();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [c, runtime, restore, cancelRestore]);
  async function restartAfterFailure() {
    if (lock.current || !confirm('현재 토너먼트와 전체 기록을 삭제하고 새 토너먼트를 시작할까요?'))
      return;
    lock.current = true;
    restoreVersion.current++;
    setApp({ status: 'loading', error: '' });
    try {
      runtime.repo.reconnect();
      await c.restart(defaultSettings);
      inGame.current = true;
      setDialog('');
      setApp({ game: c.state, status: 'ready', home: false, error: '' });
      runtime.channel?.postMessage('changed');
    } catch (error) {
      setApp({ status: 'restoreError', error: String(error) });
    } finally {
      lock.current = false;
    }
  }
  async function dispatch(command: Request['command']) {
    const result = await c.dispatch(command);
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
      lock.current = false;
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
    if (lock.current || c.pending) return;
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
    if (!s || !legal?.actor) return notify('지금은 베팅 차례가 아닙니다.');
    if (action === 'CLEAR') {
      setDraft({ scope: draftScope, version: s.version, amount: 0 });
      return;
    }
    if (action === 'CHIP') {
      if (draftAmount + amount > legal.maxAdditional)
        return notify('남은 칩을 초과할 수 없습니다.');
      setDraft({ scope: draftScope, version: s.version, amount: draftAmount + amount });
      return;
    }
    if (action === 'DRAFT_ALL') {
      setDraft({ scope: draftScope, version: s.version, amount: legal.maxAdditional });
      return;
    }
    if (action === 'UNDO' && !s.undo) return notify('취소할 이전 베팅이 없습니다.');
    if (
      action === 'FOLD' &&
      s.players.filter((p) => !p.folded && !p.eliminated).length === 2 &&
      !confirm('마지막 폴드입니다. 남은 참가자에게 팟을 지급하고 다음 핸드로 진행할까요?')
    )
      return;
    let command: GameCommand = { type: action as GameCommand['type'] };
    if (action === 'SUBMIT') {
      if (
        draftAmount <= 0 ||
        (draftAmount < legal.callAdditional && draftAmount !== legal.maxAdditional)
      )
        return notify('콜 금액 이상으로 칩을 선택하세요.');
      if (draftAmount === legal.callAdditional) command = { type: 'CALL' };
      else if (draftAmount === legal.maxAdditional) {
        if (legal.actor.B + draftAmount > s.hand!.W && !legal.canRaise) return notify(legal.reason);
        command = { type: 'ALL_IN' };
      } else {
        if (!legal.canRaise) return notify(legal.reason);
        if (draftAmount < legal.minRaiseAdditional)
          return notify(
            '최소 추가 레이즈는 ' + legal.minRaiseAdditional.toLocaleString('ko-KR') + '칩입니다.',
          );
        command = { type: s.hand!.W === 0 ? 'BET' : 'RAISE', additional: draftAmount };
      }
    }
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
                  if (c.pending) {
                    const r = await c.retry();
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
              navigation={
                pots.length > 1
                  ? {
                      previous: () =>
                        setWinnerDraft({
                          key: settlementKey,
                          winners,
                          index: (potIndex + pots.length - 1) % pots.length,
                        }),
                      next: () =>
                        setWinnerDraft({
                          key: settlementKey,
                          winners,
                          index: (potIndex + 1) % pots.length,
                        }),
                      index: potIndex + 1,
                      count: pots.length,
                    }
                  : undefined
              }
              phase={s.status === 'setup' ? 'setup' : (s.hand?.phase ?? '')}
              street={['PREFLOP', 'FLOP', 'TURN', 'RIVER'][s.hand?.street ?? 0]}
              handKey={s.hand?.id}
              viewSeat={s.settings.viewSeat}
              drag={s.status === 'setup' ? drag : undefined}
              busy={busy}
              editScope={draftScope}
              onNameEditing={(id, editing) => setRenameId(editing ? draftScope + ':' + id : '')}
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
                      if (JSON.stringify(v.settings) !== JSON.stringify(s.settings))
                        saveSettings(v.settings);
                      return true;
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
              {currentPot && (
                <SettlementPanel
                  count={winners[currentPot.id].length}
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
                  submitAllowed={
                    !!legal?.actor &&
                    draftAmount > 0 &&
                    (draftAmount === legal.callAdditional ||
                      (draftAmount === legal.maxAdditional &&
                        (legal.actor.B + draftAmount <= s.hand!.W || legal.canRaise)) ||
                      (legal.canRaise && draftAmount >= legal.minRaiseAdditional))
                  }
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
      {dialog === 'update' && (
        <Dialog
          dismissOutside
          closeDisabled={pwa.updateStatus === 'applying'}
          title="앱 업데이트"
          onClose={() => {
            pwa.cancelCheck();
            setDialog('');
          }}
        >
          <UpdateNotice
            {...pwa}
            canApply={app.home && !busy && !c.pending && !lock.current}
            onCheck={() => void pwa.check()}
            onApply={() => {
              if (!app.home || busy || lock.current || c.pending)
                return notify('저장 완료 후 홈에서 업데이트하세요.');
              void pwa.apply(() => runtime.repo.load());
            }}
          />
        </Dialog>
      )}
      {dialog === 'payout' && s && (
        <Dialog title="지급 미리보기" onClose={() => setDialog('')}>
          <p>테이블의 누적액은 현재 핸드 납부액입니다. WIN 저장 후 지급됩니다.</p>
          {pots.map((p, i) => (
            <p key={p.id}>
              {i === 0 ? '메인 팟' : '사이드 팟 ' + i}: {p.amount.toLocaleString('ko-KR')} ·{' '}
              {(winners[p.id] ?? [])
                .map((id) => s.players.find((p) => p.id === id)!.name)
                .join(', ') || '선택 필요'}
            </p>
          ))}
          {preview?.allocations?.map((a, i) => (
            <div key={a.potId}>
              <p>
                {i === 0 ? '메인' : '사이드 ' + i} 분배:{' '}
                {Object.entries(a.payouts)
                  .map(
                    ([id, n]) =>
                      s.players.find((p) => p.id === id)!.name + ' ' + n.toLocaleString('ko-KR'),
                  )
                  .join(', ')}
              </p>
              {a.remainderRecipients.length > 0 && (
                <p>
                  남는 5칩:{' '}
                  {a.remainderRecipients
                    .map((id) => s.players.find((p) => p.id === id)!.name)
                    .join(', ')}
                </p>
              )}
            </div>
          ))}
          {preview?.ok ? (
            s.players.map((p) => (
              <p key={p.id}>
                {p.name}: +{preview.payouts[p.id].toLocaleString('ko-KR')} →{' '}
                {(p.stack + preview.payouts[p.id]).toLocaleString('ko-KR')}
              </p>
            ))
          ) : (
            <p role="alert">{preview?.error}</p>
          )}
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
