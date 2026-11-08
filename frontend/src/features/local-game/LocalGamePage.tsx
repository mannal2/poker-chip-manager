import { useLocalChipMotion } from './hooks/useLocalChipMotion';
import { useScreenFit } from '../../shared/hooks/useScreenFit';
import { useToast } from '../../shared/hooks/useToast';
import { useLocalPWA } from '../pwa/register';
import { UpdateNotice } from '../pwa/UpdateNotice';
import { usePwaPresentation } from '../pwa/usePwaPresentation';
import { InstallNotice } from '../pwa/InstallNotice';
import { ManagerMenu } from './components/ManagerMenu';
import { StorageErrorDetails } from './components/StorageErrorDetails';
import { useEffect, useRef, useState } from 'react';
import type { ControlLease } from './storage/types';
import { GameScreen } from '../gameplay/GameScreen';
import type { GameScreenHandle, GameSession } from '../gameplay/session';
import { fullCapabilities } from '../gameplay/model/capabilities';
import { getLegalActions } from '../../game/transition';
import { LocalHome } from './components/LocalHome';
import { Dialog } from '../../shared/ui/Dialog';
import { useSetupEditing } from '../gameplay/hooks/useSetupEditing';
import { useLocalSetupExtras } from './hooks/useLocalSetupExtras';
import { useLocalViewSeat } from './hooks/useLocalViewSeat';
import { useLocalSession } from './hooks/useLocalSession';
import { useLocalNavigation } from './hooks/useLocalNavigation';
import '../../shared/styles/tokens.css';
import '../../shared/styles/base.css';
import '../gameplay/styles/header.css';
import '../gameplay/styles/table.css';
import '../gameplay/styles/controls.css';
// 단일 기기 모드의 최상위 화면으로, 저장소 복구 시 게임 화면을 새로 마운트한다
export function LocalGamePage() {
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
// 저장 세션, 홈/게임 화면, 업데이트·설치 안내, 토스트를 조립하는 본 화면
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
  const [dialog, setDialog] = useState('');
  const [confirmation, setConfirmation] = useState<{
    message: string;
    resolve: (accepted: boolean) => void;
  } | null>(null);
  const pendingConfirmation = useRef<((accepted: boolean) => void) | null>(null);
  useEffect(() => () => pendingConfirmation.current?.(false), []);
  function ask(message: string): Promise<boolean> {
    pendingConfirmation.current?.(false);
    setDialog('');
    return new Promise((resolve) => {
      pendingConfirmation.current = resolve;
      setConfirmation({ message, resolve });
    });
  }
  function answer(accepted: boolean) {
    pendingConfirmation.current = null;
    setConfirmation(null);
    confirmation?.resolve(accepted);
  }
  const toast = useToast();
  const notify = toast.show;
  const game = useRef<GameScreenHandle>(null);
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
    ask,
    prepareCommand: (state, command) => {
      const prepared = motion.prepare(state, command);
      return () => motion.play(prepared);
    },
  });
  const s = app.game,
    busy = app.status !== 'ready';
  const motion = useLocalChipMotion(
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
  const view = useLocalViewSeat(s);
  const editing = useSetupEditing({
    state: s,
    scope: s?.tournamentId + ':' + generation,
    viewSeat: view.viewSeat,
    busy,
    notify,
    isLocked,
    getSettings,
    run,
    dispatch,
  });
  const extras = useLocalSetupExtras({
    state: s,
    busy,
    notify,
    saveSettings: editing.saveSettings,
  });
  const setup = {
    ...editing,
    ...extras,
    // Rotation is a screen preference: no command, no save, only shown before the start.
    rotate:
      s?.status === 'setup'
        ? () => {
            if (!busy) view.rotate();
          }
        : undefined,
  };
  const returnHome = useLocalNavigation(app.home, enterLocalGame, () =>
    goHome(() => {
      setup.clearEditing();
      setDialog('');
    }),
  );
  const session: GameSession | null = s && {
    state: s,
    busy,
    // One local operator holds every role; lease loss is handled by busy, guard and storage.
    capabilities: fullCapabilities,
    legal: getLegalActions(s),
    viewSeat: view.viewSeat,
    scope: generation,
    guard: () =>
      busy || isLocked()
        ? app.status === 'controlLost'
          ? '다른 창에서 이 게임을 열었습니다.'
          : '저장 중입니다. 잠시만 기다려 주세요.'
        : null,
    run,
    dispatch,
    notify,
    loadEvents: (tournamentId, after, limit) => repository.readEvents(tournamentId, after, limit),
  };
  const confirmationDialog = confirmation && (
    <Dialog
      title="새 토너먼트"
      onClose={() => answer(false)}
      actions={
        <button className="primary" onClick={() => answer(true)}>
          확인
        </button>
      }
    >
      <p>{confirmation.message}</p>
    </Dialog>
  );
  if (app.status === 'loading')
    return (
      <main ref={screen} className="phone home" role="status">
        저장 상태 확인 중…
      </main>
    );
  if (app.status === 'restoreError')
    return (
      <main ref={screen} className="phone home">
        <p role="alert">저장된 게임을 불러오지 못했습니다.</p>
        {app.error && <p>{app.error}</p>}
        <p>먼저 다시 시도를 눌러 보세요. 새 토너먼트를 시작하면 저장된 게임과 기록이 지워집니다.</p>
        <button onClick={() => void restore(true)}>다시 시도</button>
        <button onClick={() => void restartAfterFailure()}>새 토너먼트 시작</button>
        <StorageErrorDetails />
        {confirmationDialog}
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
                  game.current?.resetSelection();
                  toast.clear();
                })
              }
            >
              다시 시도
            </button>
          )}
          {app.status === 'controlLost' && (
            <button onClick={() => void continueGame()}>이 창에서 이어하기</button>
          )}
          {app.status === 'storageError' && <StorageErrorDetails />}
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
        session && (
          <GameScreen
            ref={game}
            session={session}
            setup={setup}
            dialog={dialog}
            onDialog={setDialog}
            onUndoApplied={toast.clear}
            menu={
              <ManagerMenu
                onHome={returnHome}
                onNew={() => void newGame(() => setDialog(''))}
              />
            }
          />
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
      <InstallNotice install={install} />
      {confirmationDialog}
      {toast.message && (
        <div className="toast" role="status">
          {toast.message}
        </div>
      )}
    </main>
  );
}
