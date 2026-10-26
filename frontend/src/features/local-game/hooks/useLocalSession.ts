import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { LocalRepository, type ControlLease, type Request } from '../storage/repository';
import { LocalController } from '../storage/controller';
import { defaultSettings } from '../../../game/settings';
import type { GameState } from '../../../game/types';
import { appReducer, initialAppState } from '../model/appReducer';
import { messageFor } from '../../gameplay/model/errorMessages';

export function useLocalSession({
  restartOnMount,
  recoveryContext,
  onRecover,
  notify,
  prepareCommand,
}: {
  restartOnMount: boolean;
  recoveryContext: { inGame: boolean; lease: ControlLease | null };
  onRecover: (inGame: boolean, lease: ControlLease | null) => void;
  notify: (message: string) => void;
  prepareCommand: (state: GameState, command: Request['command']) => (() => void) | null;
}) {
  const [app, setApp] = useReducer(appReducer, {
    ...initialAppState,
    home: !recoveryContext.inGame,
  });
  const inGame = useRef(recoveryContext.inGame);
  const resumeRequested = useRef(false);
  const lock = useRef(false);
  const pendingCommit = useRef<{ requestId: string; confirm: (() => void) | null } | null>(null);
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
    s = app.game;
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
    };
  }, [c, runtime, restore, cancelRestore, restartOnMount, finish]);
  function restartAfterFailure() {
    if (confirm('현재 토너먼트와 전체 기록을 삭제하고 새 토너먼트를 시작할까요?'))
      onRecover(inGame.current, c.lease);
  }
  async function dispatch(command: Request['command']) {
    const confirm = c.state ? prepareCommand(c.state, command) : null;
    const result = await c.dispatch(command);
    pendingCommit.current =
      result.status === 'UNKNOWN' ? { requestId: result.requestId, confirm } : null;
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
        error: `저장 결과를 확인할 수 없습니다: ${messageFor(result.reason)}. 같은 요청으로 재시도하세요.`,
      });
      return false;
    }
    setApp({
      game: c.state,
      status: c.lease ? 'ready' : 'controlLost',
      error: result.reason === 'CONTROL_LOST' ? messageFor('CONTROL_LOST') : '',
    });
    if (result.status === 'REJECTED') {
      notify(messageFor(result.reason));
      return false;
    }
    if (result.resultVersion === result.state?.version) confirm?.();
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
  async function newGame(onPrepared: () => void) {
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
      onPrepared();
      runtime.channel?.postMessage('changed');
    });
  }
  async function retryStorage(onUndoApplied: () => void) {
    await run(async () => {
      runtime.repo.reconnect();
      if (c.pending) {
        const command = c.pending.command;
        const r = await c.retry();
        if (
          pendingCommit.current?.requestId === r.requestId &&
          r.status === 'APPLIED' &&
          r.resultVersion === r.state?.version
        )
          pendingCommit.current.confirm?.();
        if (r.status !== 'UNKNOWN') pendingCommit.current = null;
        if (r.status === 'APPLIED' && command.type === 'UNDO') {
          onUndoApplied();
        }
        setApp({
          game: c.state,
          status: !c.lease ? 'controlLost' : r.status === 'UNKNOWN' ? 'storageError' : 'ready',
          error: !c.lease
            ? '다른 화면이 조작 권한을 인수했습니다.'
            : r.status === 'UNKNOWN'
              ? r.reason
                ? messageFor(r.reason)
                : '저장 실패'
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
    });
  }
  function goHome(onLeave: () => void) {
    if (['ready', 'controlLost'].includes(app.status) && !lock.current && !c.pending) {
      inGame.current = false;
      onLeave();
      setApp({ home: true, status: 'ready', error: '' });
    } else notify('저장 완료를 기다려주세요.');
  }
  return {
    app,
    generation: c.lease?.generation,
    repository: runtime.repo,
    isLocked: () => lock.current,
    hasPending: () => !!c.pending,
    getSettings: () => c.state!.settings,
    restore,
    restartAfterFailure,
    dispatch,
    run,
    continueGame,
    enterLocalGame,
    newGame,
    retryStorage,
    goHome,
  };
}
