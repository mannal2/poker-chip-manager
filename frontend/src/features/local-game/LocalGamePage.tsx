import { useLocalChipMotion } from './hooks/useLocalChipMotion';
import { useScreenFit } from '../../shared/hooks/useScreenFit';
import { useToast } from '../../shared/hooks/useToast';
import { useLocalPWA } from '../pwa/register';
import { UpdateNotice } from '../pwa/UpdateNotice';
import { usePwaPresentation } from '../pwa/usePwaPresentation';
import { InstallNotice } from '../pwa/InstallNotice';
import { LocalHistoryPanel } from './components/LocalHistoryPanel';
import { ManagerMenu } from './components/ManagerMenu';
import { useRef, useState } from 'react';
import type { ControlLease } from './storage/repository';
import { GameScreen } from '../gameplay/GameScreen';
import type { GameScreenHandle, GameSession } from '../gameplay/session';
import { fullCapabilities } from '../gameplay/model/capabilities';
import { getLegalActions } from '../../game/transition';
import { LocalHome } from './components/LocalHome';
import { Dialog } from '../../shared/ui/Dialog';
import { useSetupEditing } from './hooks/useSetupEditing';
import { useLocalSession } from './hooks/useLocalSession';
import '../../shared/styles/tokens.css';
import '../gameplay/styles/table.css';
import '../gameplay/styles/controls.css';
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
  const setup = useSetupEditing({
    state: s,
    generation,
    busy,
    notify,
    isLocked,
    getSettings,
    run,
    dispatch,
  });
  const session: GameSession | null = s && {
    state: s,
    busy,
    // One local operator holds every role; lease loss is handled by busy, guard and storage.
    capabilities: fullCapabilities,
    legal: getLegalActions(s),
    scope: generation,
    guard: () =>
      busy || isLocked()
        ? app.status === 'controlLost'
          ? '다른 화면에서 조작 중입니다.'
          : '저장 완료 또는 재시도를 기다려주세요.'
        : null,
    run,
    dispatch,
    notify,
  };
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
                  game.current?.resetSelection();
                  toast.clear();
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
                onHome={() => {
                  goHome(() => {
                    setup.clearEditing();
                    setDialog('');
                  });
                }}
                onNew={() => void newGame(() => setDialog(''))}
              />
            }
            history={<LocalHistoryPanel repository={repository} state={session.state} />}
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
      {toast.message && (
        <div className="toast" role="status">
          {toast.message}
        </div>
      )}
    </main>
  );
}
