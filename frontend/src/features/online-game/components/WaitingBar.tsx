// 대기방 코드와 초대 링크 복사 조작을 표시한다.
export function WaitingBar({ code, notify }: { code: string; notify: (message: string) => void }) {
  // 현재 방 코드가 담긴 초대 주소를 클립보드에 복사한다.
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/online/?code=${encodeURIComponent(code)}`,
      );
      notify('초대 링크를 복사했습니다.');
    } catch {
      notify('초대 링크를 복사하지 못했습니다.');
    }
  }
  return (
    <div className="waiting-bar">
      <span>
        방 코드: <strong data-testid="room-code">{code}</strong>
      </span>
      <button onClick={() => void copyInvite()}>초대 링크 복사</button>
    </div>
  );
}
