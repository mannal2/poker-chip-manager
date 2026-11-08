import { useEffect } from 'react';

// 사이트 루트에서 /local/ 앱 홈으로 이동시키는 화면
/** The site root has no screen of its own: the app home lives under /local/ so it opens offline. */
export function HomeRedirect() {
  useEffect(() => {
    location.replace('/local/');
  }, []);
  return <main className="phone home">홈을 여는 중…</main>;
}
