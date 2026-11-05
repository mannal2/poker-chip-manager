import { useEffect, useEffectEvent } from 'react';

// 단일 기기 게임 진입을 방문 이력에 남겨 뒤로가기가 앱 홈으로 돌아오게 한다
export function useLocalNavigation(
  home: boolean,
  enter: () => Promise<void>,
  leave: () => boolean,
) {
  useEffect(() => {
    if (!home && !history.state?.localGameScreen)
      history.pushState({ ...history.state, localGameScreen: true }, '');
  }, [home]);

  const onPop = useEffectEvent((event: PopStateEvent) => {
    if (event.state?.localGameScreen) {
      if (home) void enter();
    } else if (!home && !leave()) {
      // 저장 중에는 게임 이력을 복원해 화면과 방문 이력이 어긋나지 않게 한다
      history.pushState({ ...history.state, localGameScreen: true }, '');
    }
  });
  useEffect(() => {
    const pop = (event: PopStateEvent) => onPop(event);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  return () => {
    if (leave() && history.state?.localGameScreen) history.back();
  };
}
