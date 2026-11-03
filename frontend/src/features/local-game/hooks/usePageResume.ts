import { useEffect, useRef } from 'react';

// 페이지가 다시 보이거나 복원될 때 콜백을 호출하는 훅
/** Calls onResume when the page becomes visible again, is restored from bfcache or resumes. */
export function usePageResume(onResume: () => void) {
  const latest = useRef(onResume);
  useEffect(() => {
    latest.current = onResume;
  });
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      latest.current();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('resume', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('resume', resume);
    };
  }, []);
}
