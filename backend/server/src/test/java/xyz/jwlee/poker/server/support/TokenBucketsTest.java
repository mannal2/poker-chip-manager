package xyz.jwlee.poker.server.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.server.room.MutableClock;

// 토큰 버킷의 소진·회복·키 수 한도를 검사한다
class TokenBucketsTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-01T00:00:00Z"));

    // 순간 한도까지 허용하고 그다음은 거절한다
    @Test
    void allowsTheBurstAndRefusesTheNext() {
        TokenBuckets buckets = new TokenBuckets(5, 10, 100, Duration.ofMinutes(10), clock);

        for (int i = 0; i < 10; i++) {
            assertThat(buckets.tryTake("a")).as("take %d", i).isTrue();
        }
        assertThat(buckets.tryTake("a")).isFalse();
    }

    // 시간이 지난 만큼만 회복하고 순간 한도를 넘겨 쌓지 않는다
    @Test
    void recoversWithTheClockUpToTheBurst() {
        TokenBuckets buckets = new TokenBuckets(5, 10, 100, Duration.ofMinutes(10), clock);
        for (int i = 0; i < 10; i++) {
            buckets.tryTake("a");
        }

        clock.advance(Duration.ofMillis(200));
        assertThat(buckets.tryTake("a")).isTrue();
        assertThat(buckets.tryTake("a")).isFalse();

        clock.advance(Duration.ofMinutes(1));
        for (int i = 0; i < 10; i++) {
            assertThat(buckets.tryTake("a")).as("take %d", i).isTrue();
        }
        assertThat(buckets.tryTake("a")).isFalse();
    }

    // 거절은 토큰을 쓰지 않으므로 회복 중인 소수 토큰이 그대로 쌓인다
    @Test
    void aRefusalDoesNotDelayRecovery() {
        TokenBuckets buckets = new TokenBuckets(1, 1, 100, Duration.ofMinutes(10), clock);
        buckets.tryTake("a");

        clock.advance(Duration.ofMillis(600));
        assertThat(buckets.tryTake("a")).isFalse();
        clock.advance(Duration.ofMillis(400));

        assertThat(buckets.tryTake("a")).isTrue();
    }

    // 한 키의 소진이 다른 키에 영향을 주지 않는다
    @Test
    void keysAreIndependent() {
        TokenBuckets buckets = new TokenBuckets(1, 1, 100, Duration.ofMinutes(10), clock);

        assertThat(buckets.tryTake("a")).isTrue();
        assertThat(buckets.tryTake("a")).isFalse();
        assertThat(buckets.tryTake("b")).isTrue();
    }

    // 표가 가득 차고 지울 키가 없으면 새 키를 거절하고 기존 키는 유지한다
    @Test
    void aFullTableRefusesNewKeysAndKeepsItsSize() {
        TokenBuckets buckets = new TokenBuckets(1, 5, 2, Duration.ofMinutes(10), clock);
        assertThat(buckets.tryTake("a")).isTrue();
        assertThat(buckets.tryTake("b")).isTrue();

        assertThat(buckets.tryTake("c")).isFalse();

        assertThat(buckets.size()).isEqualTo(2);
        assertThat(buckets.tryTake("a")).isTrue();
    }

    // 오래 쓰지 않은 키부터 지워 새 키의 자리를 만든다
    @Test
    void theLeastRecentlyUsedIdleKeyGoesFirst() {
        TokenBuckets buckets = new TokenBuckets(1, 5, 2, Duration.ofMinutes(10), clock);
        buckets.tryTake("old");
        clock.advance(Duration.ofMinutes(6));
        buckets.tryTake("recent");
        clock.advance(Duration.ofMinutes(5));

        assertThat(buckets.tryTake("new")).isTrue();

        assertThat(buckets.size()).isEqualTo(2);
        assertThat(buckets.tryTake("another")).as("recent is only 5 minutes idle").isFalse();
    }
}
