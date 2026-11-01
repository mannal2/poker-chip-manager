import type { OnlineView } from '../session/onlineController';

// 방 소실과 권한 회수 및 프로토콜 변경의 종료 안내를 표시한다.
export function OnlineFatal({ phase }: { phase: OnlineView['phase'] }) {
  return (
    <p role="alert">
      {phase === 'gone'
        ? '방을 찾을 수 없습니다.'
        : phase === 'revoked'
          ? '이 화면의 참가 권한이 회수되었습니다.'
          : '새로고침이 필요합니다.'}
    </p>
  );
}
