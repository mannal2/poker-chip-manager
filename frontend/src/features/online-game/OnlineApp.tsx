import { useEffect, useState } from 'react';
import { OnlineEntry } from './components/OnlineEntry';
import { OnlineFatal } from './components/OnlineFatal';
import { useOnlineController } from './hooks/useOnlineController';
import { RoomPage } from './RoomPage';

// 연결 상태와 컨트롤러 단계에 따라 온라인 진입 화면을 선택한다.
export function OnlineApp() {
  const { view, controller } = useOnlineController();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    // 브라우저가 알린 네트워크 연결 여부를 화면에 반영한다.
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const fatal = ['gone', 'revoked', 'incompatible'].includes(view.phase);
  if (view.phase === 'room' && view.snapshot) return <RoomPage view={view} controller={controller} />;
  return (
    <main className="online-app">
      <h1>멀티플레이 모드</h1>
      {!online ? (
        <p role="status">멀티플레이 모드를 이용하려면 인터넷 연결이 필요합니다.</p>
      ) : fatal ? (
        <OnlineFatal phase={view.phase} />
      ) : (
        <OnlineEntry view={view} controller={controller} />
      )}
      {online && !fatal && view.error && <p role="alert">{view.error}</p>}
      <a href="/local/">앱 홈으로</a>
    </main>
  );
}
