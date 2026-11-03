package xyz.jwlee.poker.server.realtime;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import xyz.jwlee.poker.server.registry.RoomRegistry;

// 1초마다 모든 방의 시간 규칙을 판정한다
@Component
@ConditionalOnProperty(value = "poker.sweep.enabled", matchIfMissing = true)
class SweepTask {

    private static final long SWEEP_MILLIS = 1000;

    private final RoomRegistry registry;

    // 정리 작업이 쓸 방 레지스트리를 받는다
    SweepTask(RoomRegistry registry) {
        this.registry = registry;
    }

    // 방 점검을 한 번 실행한다
    @Scheduled(fixedDelay = SWEEP_MILLIS)
    void sweep() {
        registry.sweepAll();
    }
}
