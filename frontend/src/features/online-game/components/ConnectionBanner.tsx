import type { OnlineView, OnlineController } from '../session/onlineController';

// 연결 동기화와 조작권 복구에 필요한 현재 상태 및 조작을 표시한다
export function ConnectionBanner({
  view,
  controller,
}: {
  view: OnlineView;
  controller: OnlineController;
}) {
  if (view.connection !== 'online')
    return (
      <div className="notice" role="status">
        재연결 중 <button onClick={() => controller.reconnect()}>다시 연결</button>
      </div>
    );
  if (!view.hasControl)
    return (
      <div className="notice" role="status">
        다른 화면에서 조작 중입니다.{' '}
        <button disabled={view.pending} onClick={() => void controller.takeControl()}>
          이 화면에서 이어하기
        </button>
      </div>
    );
  return null;
}
