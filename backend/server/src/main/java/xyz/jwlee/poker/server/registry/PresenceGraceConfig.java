package xyz.jwlee.poker.server.registry;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import xyz.jwlee.poker.server.room.PresenceGrace;

// 설정에서 끊김 유예(대기방 재접속, 진행 중 자동 행동)를 읽어 빈으로 등록한다
@Configuration(proxyBeanMethods = false)
class PresenceGraceConfig {

    // 대기방 5분, 진행 중 30초를 기본으로 하는 끊김 유예를 등록한다
    @Bean
    PresenceGrace presenceGrace(
            @Value("${poker.waiting-reconnect-grace-seconds:300}") long waitingReconnectSeconds,
            @Value("${poker.auto-play-grace-seconds:30}") long autoPlaySeconds) {
        return new PresenceGrace(Duration.ofSeconds(waitingReconnectSeconds), Duration.ofSeconds(autoPlaySeconds));
    }
}
