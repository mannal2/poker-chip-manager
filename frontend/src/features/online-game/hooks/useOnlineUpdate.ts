import { useEffect, useState } from 'react';

// HTML이 참조하는 진입점과 공통 JS·CSS 파일 목록을 비교한다
function assetsOf(page: ParentNode): string {
  if (!page.querySelector('script[type="module"][src]')) return '';
  return [
    ...page.querySelectorAll(
      'script[type="module"][src], link[rel="modulepreload"][href], link[rel="stylesheet"][href]',
    ),
  ]
    .map(
      (node) => new URL(node.getAttribute('src') ?? node.getAttribute('href')!, location.href).href,
    )
    .sort()
    .join('\n');
}

// 온라인 화면을 유지하면서 새 프런트엔드의 배포를 확인한다
export function useOnlineUpdate() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const current = assetsOf(document);
    if (!current) return;
    let stopped = false;
    let found = false;
    let checking: AbortController | null = null;
    async function check() {
      if (
        stopped ||
        found ||
        checking ||
        document.visibilityState === 'hidden' ||
        !navigator.onLine
      )
        return;
      const controller = new AbortController();
      checking = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch('/online/', { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) return;
        const template = document.createElement('template');
        template.innerHTML = await response.text();
        const latest = assetsOf(template.content);
        if (!stopped && latest && latest !== current) {
          found = true;
          setAvailable(true);
        }
      } catch {
        // 통신 실패는 업데이트로 판단하지 않고 다음 확인을 기다린다
      } finally {
        clearTimeout(timeout);
        checking = null;
      }
    }
    const resume = () => {
      void check();
    };
    resume();
    const interval = setInterval(resume, 60_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    return () => {
      stopped = true;
      clearInterval(interval);
      checking?.abort();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
    };
  }, []);
  return available;
}
