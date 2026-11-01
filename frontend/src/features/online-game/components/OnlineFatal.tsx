import type { OnlineView } from '../session/onlineController';

// 방 소실과 권한 회수 및 프로토콜 변경의 종료 안내를 표시한다.
export function OnlineFatal({ phase, code }: { phase: OnlineView['phase']; code?: string }) {
  return (
    <>
      <p role="alert">
        {phase === 'gone'
          ? '방이 사라졌거나 참가 세션이 만료되었습니다. 방이 남아 있다면 기존 참가자로 복구할 수 있습니다.'
          : phase === 'revoked'
            ? '이 화면의 참가 권한이 회수되었습니다.'
            : '새로고침이 필요합니다.'}
      </p>
      {phase !== 'incompatible' && (
        <a href={`/online/${code ? `?code=${encodeURIComponent(code)}` : ''}`}>입장 화면으로</a>
      )}
    </>
  );
}
