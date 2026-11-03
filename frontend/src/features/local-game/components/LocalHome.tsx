// 단일 기기 모드 진입, 앱 설치, 업데이트 버튼이 있는 앱 홈
export function LocalHome({
  busy,
  onLocal,
  onUpdate,
  hasUpdate,
  onInstall,
}: {
  busy: boolean;
  onLocal: () => void;
  onUpdate: () => void;
  hasUpdate: boolean;
  onInstall?: () => void;
}) {
  return (
    <section className="home app-home">
      <h1>Poker Chip Manager</h1>
      <button className="primary" disabled={busy} onClick={onLocal}>
        단일 기기 모드
      </button>
      <button disabled={busy} onClick={() => location.assign('/online/')}>
        멀티플레이 모드
      </button>
      {onInstall && (
        <button disabled={busy} onClick={onInstall}>
          앱 설치
        </button>
      )}
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
