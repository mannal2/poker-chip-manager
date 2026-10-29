import { useEffect, useRef } from 'react';

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
