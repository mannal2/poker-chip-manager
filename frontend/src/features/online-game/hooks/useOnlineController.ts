import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiClient } from '../api/client';
import { RoomSocket } from '../realtime/roomSocket';
import { OnlineController } from '../session/onlineController';

// 화면의 컨트롤러를 구독하고 효과 수명 안에서 복귀와 자원 정리를 수행한다.
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
    // 최초 연결이 가능해졌을 때 저장된 방 복귀를 한 번 시도한다.
    const resume = () => {
      if (active && navigator.onLine && !attempted) {
        attempted = true;
        void controller.resume();
      }
    };
    // 효과 재실행에서 폐기된 복귀를 시작하지 않는다.
    queueMicrotask(resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      window.removeEventListener('online', resume);
      controller.dispose();
    };
  }, [controller]);
  return { view, controller };
}
