export function LocalHome({
  busy,
  onLocal,
  onUpdate,
  hasUpdate,
}: {
  busy: boolean;
  onLocal: () => void;
  onUpdate: () => void;
  hasUpdate: boolean;
}) {
  return (
    <section className="home app-home">
      <h1>Poker Chip Manager</h1>
      <button className="primary" disabled={busy} onClick={onLocal}>
        단일 기기 모드
      </button>
      <button disabled>멀티플레이 모드 · 준비 중</button>
      <button disabled={busy} onClick={onUpdate}>
        앱 업데이트
        {hasUpdate && (
          <span className="update-dot" aria-label="새 버전 준비됨">
            {' '}
            · 새 버전
          </span>
        )}
      </button>
    </section>
  );
}
