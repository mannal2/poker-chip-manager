import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiClient } from '../api/client';
import { RoomSocket } from '../realtime/roomSocket';
import { OnlineController } from '../session/onlineController';

// 화면의 컨트롤러를 구독하고 효과 수명 안에서 복귀와 자원 정리를 수행한다
export function useOnlineController() {
  const [controller] = useState(
    () =>
      new OnlineController(
        new ApiClient(),
        (handlers) =>
          new RoomSocket(
            `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
            handlers,
          ),
      ),
  );
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  useEffect(() => {
    let active = true;
    let attempted = false;
    // 최초 연결이 가능해졌을 때 저장된 방 복귀를 한 번 시도한다
    const resume = () => {
      if (active && navigator.onLine && !attempted) {
        attempted = true;
        void controller.resume();
      }
    };
    // 효과 재실행에서 폐기된 복귀를 시작하지 않는다
    queueMicrotask(resume);
    window.addEventListener('online', resume);
    // 문서 종료에서는 스트림을 반환하고 BFCache 진입에서는 요청 메모리를 보존한다
    const hide = (event: PageTransitionEvent) => controller.suspend(event.persisted);
    // BFCache에서 복원된 화면은 같은 구독자와 스트림으로 소켓 연결을 복구한다
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) controller.restore();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      active = false;
      window.removeEventListener('online', resume);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      controller.dispose();
    };
  }, [controller]);
  return { view, controller };
}
