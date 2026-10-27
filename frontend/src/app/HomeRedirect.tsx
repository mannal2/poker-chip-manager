import { useEffect } from 'react';

/** The site root has no screen of its own: the app home lives under /local/ so it opens offline. */
export function HomeRedirect() {
  useEffect(() => {
    location.replace('/local/');
  }, []);
  return <main className="phone home">앱 홈을 여는 중…</main>;
}
