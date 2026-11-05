import { useLayoutEffect, useRef, type ReactNode } from 'react';

// 핸드 번호, 블라인드, 메뉴 버튼을 보여주는 상단 바
export function GameHeader({
  handNumber,
  sb,
  bb,
  pendingBlinds,
  canEditBlinds,
  onHistory,
  onBlinds,
  onMenu,
  notice,
}: {
  handNumber: number;
  sb: number;
  bb: number;
  pendingBlinds: { sb: number; bb: number } | null;
  canEditBlinds: boolean;
  onHistory: () => void;
  onBlinds: () => void;
  onMenu: () => void;
  notice?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const hasNotice = !!notice;
  useLayoutEffect(() => {
    if (!hasNotice) return;
    const header = ref.current!;
    const info = header.querySelector<HTMLElement>('.meta-info')!;
    const menu = header.querySelector<HTMLElement>('#menu')!;
    // 양쪽 정보 중 더 넓은 쪽만큼 대칭 여백을 확보한다
    const fitNotice = () => {
      const bounds = header.getBoundingClientRect();
      const inset = Math.max(
        info.getBoundingClientRect().right - bounds.left,
        bounds.right - menu.getBoundingClientRect().left,
      );
      header.style.setProperty('--header-notice-inset', `${inset}px`);
    };
    const observer = new ResizeObserver(fitNotice);
    observer.observe(header);
    observer.observe(info);
    fitNotice();
    return () => observer.disconnect();
  }, [hasNotice]);
  return (
    <header ref={ref} className="meta">
      <div className="meta-info">
        <button className="meta-link" aria-label="현재 토너먼트 기록" onClick={onHistory}>
          HAND <strong>{String(handNumber).padStart(2, '0')}</strong>
        </button>
        <button
          id="blinds"
          className="meta-link"
          aria-label="다음 핸드 블라인드 설정"
          disabled={!canEditBlinds}
          onClick={onBlinds}
        >
          <strong>
            {sb.toLocaleString('ko-KR')} / {bb.toLocaleString('ko-KR')}
          </strong>
          {pendingBlinds && (
            <span className="pending-blinds">
              {' '}
              → {pendingBlinds.sb.toLocaleString('ko-KR')} /{' '}
              {pendingBlinds.bb.toLocaleString('ko-KR')}
            </span>
          )}
        </button>
      </div>
      {notice && <div className="header-notice">{notice}</div>}
      <button id="menu" aria-label="관리 메뉴" onClick={onMenu}>
        ☰
      </button>
    </header>
  );
}
