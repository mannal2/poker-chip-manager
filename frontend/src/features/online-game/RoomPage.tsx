import { useRef, useState } from 'react';
import { GameScreen } from '../gameplay/GameScreen';
import { useScreenFit } from '../../shared/hooks/useScreenFit';
import { WaitingBar } from './components/WaitingBar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { useOnlineGameSession } from './hooks/useOnlineGameSession';
import type { OnlineController, OnlineView } from './session/onlineController';
import '../gameplay/styles/header.css';
import '../gameplay/styles/table.css';
import '../gameplay/styles/controls.css';

// 온라인 방의 연결 안내와 공통 게임 화면 및 토스트를 조립한다.
export function RoomPage({ view, controller }: { view: OnlineView; controller: OnlineController }) {
  const screen = useRef<HTMLElement>(null);
  useScreenFit(screen);
  const [dialog, setDialog] = useState('');
  const { session, setup, toast } = useOnlineGameSession(view, controller);
  return (
    <main ref={screen} className="phone online-room" aria-busy={view.pending}>
      <ConnectionBanner view={view} controller={controller} />
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
        session={session}
        setup={setup}
        dialog={dialog}
        onDialog={setDialog}
        menu={<button onClick={() => controller.leaveRoomScreen()}>앱 홈으로</button>}
      />
      {toast.message && (
        <div className="toast" role="status">
          {toast.message}
        </div>
      )}
    </main>
  );
}
