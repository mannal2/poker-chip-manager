import type { OnlineView } from '../session/onlineController';

// 방 소실과 권한 회수 및 프로토콜 변경의 종료 안내를 표시한다
export function OnlineFatal({ phase, code }: { phase: OnlineView['phase']; code?: string }) {
  return (
    <>
      <p role="alert">
        {phase === 'gone'
          ? "방에 다시 들어갈 수 없습니다. 방이 남아 있다면 '기존 플레이어로 복구'를 누르세요."
          : phase === 'revoked'
            ? '이 화면에서는 더 이상 참가할 수 없습니다. 방장이 내보냈거나 다른 기기에서 자리를 복구했습니다.'
            : '앱이 업데이트되었습니다. 새로고침해 주세요.'}
      </p>
      {phase === 'incompatible' && <button onClick={() => location.reload()}>새로고침</button>}
      {phase !== 'incompatible' && (
        <a href={`/online/${code ? `?code=${encodeURIComponent(code)}` : ''}`}>입장 화면으로</a>
      )}
    </>
  );
}
