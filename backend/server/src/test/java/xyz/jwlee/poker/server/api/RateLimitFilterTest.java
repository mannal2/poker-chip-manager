package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.MutableClock;

// 운영 기본값의 빈도 제한이 경로·세션·IP별로 동작하는지 검사한다
@SpringBootTest(properties = "poker.rate-limit.enabled=true")
@AutoConfigureMockMvc
class RateLimitFilterTest {

    private static final MutableClock CLOCK = new MutableClock(Instant.parse("2026-11-01T00:00:00Z"));

    // 테스트가 직접 진행시키는 시계를 넣는다
    @TestConfiguration(proxyBeanMethods = false)
    static class Timed {
        // 버킷 회복을 조절하는 시계를 만든다
        @Bean
        @Primary
        Clock rateLimitClock() {
            return CLOCK;
        }
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    // 앞 테스트가 쓴 토큰이 모두 회복되도록 시계를 돌린다
    @BeforeEach
    void refillBuckets() {
        CLOCK.advance(Duration.ofHours(1));
    }

    // 방 한도를 넘지 않도록 만든 방을 지운다
    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 대기방의 첫 딜러를 정하는 명령을 보낸다
    private static ResultActions setDealer(GameClient c) throws Exception {
        return c.send("SET_DEALER", "{\"participantId\":\"" + c.participantId + "\"}");
    }

    // 세션 없이 경로에 POST를 보낸다
    private ResultActions postFrom(String path, String ip) throws Exception {
        return mvc.perform(post(path).header("Origin", GameClient.ORIGIN).with(r -> {
            r.setRemoteAddr(ip);
            return r;
        }));
    }

    // 순간 한도를 넘은 명령은 429이고 장부를 건드리지 않아 회복 뒤 같은 요청이 적용된다
    @Test
    void aThrottledCommandLeavesTheLedgerSoTheSameRequestAppliesAfterRecovery() throws Exception {
        GameClient host = GameClient.room(mvc, registry, "Alice")[0];
        for (int i = 0; i < 10; i++) {
            setDealer(host).andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("APPLIED"));
        }
        long version = host.refresh().get("stateVersion").asLong();

        setDealer(host).andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "1"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.message").isNotEmpty());
        assertThat(host.refresh().get("stateVersion").asLong()).isEqualTo(version);

        CLOCK.advance(Duration.ofSeconds(1));
        host.resendLast().andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.sequence").value(11));
    }

    // 조작 인수 경로도 같은 세션 버킷을 쓴다
    @Test
    void theControlPathSharesTheSessionBucket() throws Exception {
        GameClient host = GameClient.room(mvc, registry, "Alice")[0];
        for (int i = 0; i < 10; i++) {
            setDealer(host);
        }

        host.postControl().andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"));
    }

    // 명령 버킷이 비어도 조회는 제한되지 않는다
    @Test
    void readingStateIsNotLimited() throws Exception {
        GameClient host = GameClient.room(mvc, registry, "Alice")[0];
        for (int i = 0; i < 10; i++) {
            setDealer(host);
        }
        setDealer(host).andExpect(status().isTooManyRequests());

        for (int i = 0; i < 30; i++) {
            assertThat(host.refresh().get("roomId").asString()).isEqualTo(host.roomId);
        }
    }

    // 한 세션의 제한이 같은 IP의 다른 세션에 번지지 않는다
    @Test
    void oneSessionsLimitDoesNotReachAnother() throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, "Alice", "Bob");
        for (int i = 0; i < 10; i++) {
            setDealer(c[0]);
        }
        setDealer(c[0]).andExpect(status().isTooManyRequests());

        assertThat(setDealer(c[1]).andReturn().getResponse().getStatus()).isNotEqualTo(429);
    }

    // 같은 IP의 9명이 각자 초당 1개 명령을 보내도 429가 없다
    @Test
    void nineNormalPlayersBehindOneAddressAreNotThrottled() throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, "A", "B", "C", "D", "E", "F", "G", "H", "I");

        for (int second = 0; second < 10; second++) {
            for (GameClient client : c) {
                assertThat(setDealer(client).andReturn().getResponse().getStatus()).isNotEqualTo(429);
            }
            CLOCK.advance(Duration.ofSeconds(1));
        }
    }

    // 방 생성 6번째는 429이고 다음 생성까지 기다릴 시간을 알려 준다
    @Test
    void theSixthRoomOfAnAddressIsRefused() throws Exception {
        for (int i = 0; i < 5; i++) {
            GameClient.room(mvc, registry, "A");
        }

        mvc.perform(post("/api/rooms").header("Origin", GameClient.ORIGIN))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "12"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"));
    }

    // 참가와 복구 시도는 IP 버킷을 함께 쓰고 순간 20개까지 받는다
    @Test
    void joinsAndRecoveriesShareTheAddressBucket() throws Exception {
        for (int i = 0; i < 10; i++) {
            postFrom("/api/room-joins", "198.51.100.1").andExpect(status().isUnauthorized());
            postFrom("/api/recovery-requests", "198.51.100.1").andExpect(status().isUnauthorized());
        }

        postFrom("/api/room-joins", "198.51.100.1").andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "1"));
        postFrom("/api/room-joins", "198.51.100.2").andExpect(status().isUnauthorized());
    }

    // 방 생성 한도로 거절된 시도는 IP 버킷을 쓰지 않아 참가를 막지 않는다
    @Test
    void refusedRoomCreationsDoNotDrainTheAddressBucket() throws Exception {
        for (int i = 0; i < 30; i++) {
            postFrom("/api/rooms", "198.51.100.3");
        }

        postFrom("/api/room-joins", "198.51.100.3").andExpect(status().isUnauthorized());
    }

    // 세션 경로는 IP 버킷 대상이 아니다
    @Test
    void sessionPathsAreNotLimited() throws Exception {
        for (int i = 0; i < 30; i++) {
            postFrom("/api/session/refresh", "198.51.100.4").andExpect(status().isUnauthorized());
        }
    }

    // 운영이 아니면 위조한 X-Real-IP로 버킷을 바꿀 수 없다
    @Test
    void aForgedRealIpHeaderIsIgnoredOutsideProd() throws Exception {
        for (int i = 0; i < 5; i++) {
            mvc.perform(post("/api/rooms").header("Origin", GameClient.ORIGIN).header("X-Real-IP", "203.0.113." + i))
                    .andExpect(status().isUnauthorized());
        }

        mvc.perform(post("/api/rooms").header("Origin", GameClient.ORIGIN).header("X-Real-IP", "203.0.113.9"))
                .andExpect(status().isTooManyRequests());
    }

    // 세션 없는 명령은 세션 버킷을 거치지 않고 401로 끝난다
    @Test
    void aCommandWithoutASessionIsLeftToTheSessionGuard() throws Exception {
        for (int i = 0; i < 30; i++) {
            postFrom("/api/rooms/any/commands", "198.51.100.5").andExpect(status().isUnauthorized());
        }
    }
}
