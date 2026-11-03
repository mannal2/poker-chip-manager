package xyz.jwlee.poker.server.room;

import org.springframework.context.annotation.Fallback;
import org.springframework.stereotype.Component;

// 방 잠금을 푼 뒤 모은 변경 알림을 넘겨받는다
/** Runs outside every room lock, and must return at once whatever the state of the connections. */
public interface RoomPublisher {

    // 변경 알림 하나를 처리한다
    void publish(Publication publication);

    // 다른 구현이 없을 때 쓰는, 아무 일도 하지 않는 기본 구현
    @Component
    @Fallback
    final class Silent implements RoomPublisher {

        // 아무 일도 하지 않는다
        @Override
        public void publish(Publication publication) { }
    }
}
