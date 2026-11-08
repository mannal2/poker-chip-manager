import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { LocalRepository } from '../storage/repository';
import type { ControlLease, Request } from '../storage/types';
import { LocalController } from '../storage/controller';
import { defaultSettings } from '../../../game/settings';
import type { GameState } from '../../../game/types';
import { mergeAppState, initialAppState } from '../model/appState';
import { messageFor } from '../../gameplay/model/errorMessages';
import { createCommandRunner } from '../../../shared/async/commandRunner';
import { useCrossTabOwnership } from './useCrossTabOwnership';
import { usePageResume } from './usePageResume';

// 저장소 연결, 조작권, 명령 실행, 복구를 묶어 로컬 게임 세션을 관리하는 훅
export function useLocalSession({
  restartOnMount,
  recoveryContext,
  onRecover,
  notify,
  ask,
  prepareCommand,
}: {
  restartOnMount: boolean;
  recoveryContext: { inGame: boolean; lease: ControlLease | null };
  onRecover: (inGame: boolean, lease: ControlLease | null) => void;
  notify: (message: string) => void;
  /** Asks the user to confirm a destructive step; the page decides how to present it. */
  ask: (message: string) => Promise<boolean>;
  prepareCommand: (state: GameState, command: Request['command']) => (() => void) | null;
}) {
  const [app, setApp] = useReducer(mergeAppState, {
    ...initialAppState,
    home: !recoveryContext.inGame,
  });
  const inGame = useRef(recoveryContext.inGame);
  const resumeRequested = useRef(false);
  const [runner] = useState(createCommandRunner);
  const pendingCommit = useRef<{ requestId: string; confirm: (() => void) | null } | null>(null);
  const [runtime] = useState(() => {
    const repo = new LocalRepository(
      'poker-chip-manager',
      () =>
        setApp({
          status: 'restoreError',
          error: '이 앱이 열린 다른 창을 닫아 주세요.',
        }),
      () =>
        setApp({ status: 'restoreError', error: '저장에 문제가 생겼습니다. 앱을 다시 열어 주세요.' }),
    );
    const controller = new LocalController(
      repo,
      recoveryContext.lease?.screenId ?? crypto.randomUUID(),
    );
    controller.lease = recoveryContext.lease ? { ...recoveryContext.lease } : null;
    return { repo, controller };
  });
  const c = runtime.controller,
    s = app.game;
  const restoreVersion = useRef(0);
  // 저장소에서 게임과 조작권 상태를 다시 읽어 화면 상태를 맞춘다
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
            ? '저장됐는지 확인하지 못했습니다. 다시 시도를 눌러 주세요.'
            : !inGame.current || c.lease
              ? ''
              : '다른 창에서 이 게임을 열었습니다.',
        });
      } catch {
        if (version === restoreVersion.current)
          setApp({ status: 'restoreError', error: '' });
      }
    },
    [c, runtime],
  );
  // 진행 중인 복원 작업을 무효화하고 취소한다
  const cancelRestore = useCallback(() => {
    restoreVersion.current++;
    c.cancelRefresh();
  }, [c]);
  // 저장 작업 중 페이지가 다시 표시되어 복원이 보류되었다면, 작업이 끝난 뒤 저장소에 다시 연결해 최신 상태를 읽는다
  const afterRun = useCallback(() => {
    if (resumeRequested.current) {
      resumeRequested.current = false;
      void restore(true);
    }
  }, [restore]);
  const tabs = useCrossTabOwnership({
    ownsGame: () => !!c.lease && inGame.current,
    onPeerChange: () => {
      if (runner.isLocked() || c.pending) return;
      void restore();
    },
  });
  const { announce } = tabs;
  useEffect(() => {
    if (restartOnMount)
      void runner.run(
        async () => {
          await c.restart(defaultSettings);
          inGame.current = true;
          setApp({ game: c.state, status: 'ready', home: false, error: '' });
          announce('changed');
        },
        {
          onError: () => setApp({ status: 'restoreError', error: '' }),
          onRelease: afterRun,
        },
      );
    else void restore();
    return () => {
      resumeRequested.current = false;
      cancelRestore();
      runtime.repo.dispose();
    };
  }, [c, runtime, runner, restore, cancelRestore, restartOnMount, afterRun, announce]);
  usePageResume(() => {
    if (runner.isLocked()) {
      resumeRequested.current = true;
      return;
    }
    resumeRequested.current = false;
    void restore(true);
  });
  // 복구 불가 상태에서 확인을 받은 뒤 새 토너먼트로 다시 시작한다
  async function restartAfterFailure() {
    if (await ask('현재 토너먼트와 전체 기록을 삭제하고 새 토너먼트를 시작할까요?'))
      onRecover(inGame.current, c.lease);
  }
  // 명령을 저장소에 보내고 결과에 맞춰 화면 상태와 오류를 갱신한다
  async function dispatch(command: Request['command']) {
    const confirm = c.state ? prepareCommand(c.state, command) : null;
    const result = await c.dispatch(command);
    pendingCommit.current =
      result.status === 'UNKNOWN' ? { requestId: result.requestId, confirm } : null;
    if (!c.lease) {
      setApp({
        game: c.state,
        status: 'controlLost',
        error: '다른 창에서 이 게임을 열었습니다.',
      });
      return false;
    }
    if (result.status === 'UNKNOWN') {
      setApp({
        status: 'storageError',
        error: '저장됐는지 확인하지 못했습니다. 다시 시도를 눌러 주세요.',
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
    announce('changed');
    return true;
  }
  // 저장 작업을 한 번에 하나씩 실행하고, 시작 시 저장 중 상태로, 실패 시 저장 오류 상태로 전환한다
  async function run(action: () => Promise<void>) {
    await runner.run(action, {
      onBusy: () => notify('저장 중입니다. 잠시만 기다려 주세요.'),
      onStart: () => setApp({ status: 'saving' }),
      onError: () =>
        setApp({ status: 'storageError', error: '저장하지 못했습니다. 다시 시도를 눌러 주세요.' }),
      onRelease: afterRun,
    });
  }
  // 조작권을 얻고 저장된 게임이 없으면 새로 만든 뒤 게임 화면으로 들어간다
  async function activateLocal() {
    await c.takeControl();
    if (!c.state) {
      await runtime.repo.initialize(defaultSettings, c.lease!);
      await c.refresh();
    }
    inGame.current = true;
    setApp({ game: c.state, status: 'ready', home: false, error: '' });
    announce('control');
  }
  // 조작권을 잃은 창에서 조작권을 다시 가져와 게임을 이어간다
  async function continueGame() {
    if (!runner.isLocked()) await run(activateLocal);
  }
  // 이 창에 조작권이 없을 때 다른 창이 게임을 소유 중인지 확인한다
  async function otherWindowOwnsGame() {
    if (c.lease) return false;
    return tabs.otherWindowOwnsGame();
  }
  // 홈에서 게임에 진입할 때 다른 창이 조작 중이면 인수 안내를 표시하고, 그렇지 않으면 이 창이 조작권을 얻는다
  async function enterLocalGame() {
    await run(async () => {
      await c.refresh();
      if (await otherWindowOwnsGame()) {
        inGame.current = true;
        setApp({
          game: c.state,
          status: 'controlLost',
          home: false,
          error: '다른 창에서 이 게임을 열었습니다.',
        });
        return;
      }
      await activateLocal();
    });
  }
  // 확인을 받은 뒤 현재 토너먼트를 새 토너먼트로 교체한다
  async function newGame(onPrepared: () => void) {
    if (runner.isLocked() || c.pending) {
      await restartAfterFailure();
      return;
    }
    if (s && !(await ask('현재 토너먼트와 전체 기록을 삭제하고 새 토너먼트를 준비할까요?'))) return;
    await run(async () => {
      await c.takeControl();
      if (
        c.state &&
        c.state.tournamentId !== s?.tournamentId &&
        !(await ask(
          '다른 화면에서 새 토너먼트가 저장되었습니다. 현재 게임과 기록을 삭제하고 교체할까요?',
        ))
      ) {
        setApp({
          game: c.state,
          status: c.lease ? 'ready' : 'controlLost',
          error: c.lease ? '' : '다른 창에서 이 게임을 열었습니다.',
        });
        announce('control');
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
          },
        })
      )
        setApp({ home: false });
      onPrepared();
      announce('changed');
    });
  }
  // 저장 결과가 불명확한 요청을 같은 요청으로 재시도하거나 상태를 다시 읽는다
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
            ? '다른 창에서 이 게임을 열었습니다.'
            : r.status === 'UNKNOWN'
              ? r.reason
                ? messageFor(r.reason)
                : '저장 실패'
              : '',
        });
        announce('changed');
      } else {
        await c.refresh();
        setApp({
          game: c.state,
          status: c.lease ? 'ready' : 'controlLost',
          error: c.lease ? '' : '다른 창에서 이 게임을 열었습니다.',
        });
      }
    });
  }
  // 저장이 끝난 상태에서 홈 화면으로 나간다
  function goHome(onLeave: () => void) {
    if (['ready', 'controlLost'].includes(app.status) && !runner.isLocked() && !c.pending) {
      inGame.current = false;
      onLeave();
      setApp({ home: true, status: 'ready', error: '' });
      return true;
    }
    notify('저장 중입니다. 잠시만 기다려 주세요.');
    return false;
  }
  return {
    app,
    generation: c.lease?.generation,
    repository: runtime.repo,
    isLocked: runner.isLocked,
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
