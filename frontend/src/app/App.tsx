import { useEffect } from 'react';
import { LocalGamePage } from '../features/local-game/LocalGamePage';

export function App() {
  if (location.pathname.startsWith('/online/'))
    return (
      <main className="phone home">
        <h1>멀티플레이 모드 · 준비 중</h1>
        <a href="/local/">앱 홈으로</a>
      </main>
    );
  if (!location.pathname.startsWith('/local/')) return <AppRedirect />;
  return <LocalGamePage />;
}
function AppRedirect() {
  useEffect(() => {
    location.replace('/local/');
  }, []);
  return <main className="phone home">앱 홈을 여는 중…</main>;
}
