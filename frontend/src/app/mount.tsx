import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installZoomPolicy } from '../shared/browser/zoomPolicy';

// 확대 방지 정책을 설치하고 페이지를 상단 띠와 함께 루트에 렌더링한다
/** Shared start-up for every HTML entry: zoom policy, then the page's React root. */
export function mount(page: ReactNode) {
  installZoomPolicy();
  createRoot(document.getElementById('root')!).render(
    <>
      {/* iOS 26 설치 앱의 상단 블러를 막는 불투명한 고정 띠 */}
      <div className="top-edge" aria-hidden="true" />
      {page}
    </>,
  );
}
