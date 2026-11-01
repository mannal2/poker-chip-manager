package xyz.jwlee.poker.server.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

// 키별 토큰 버킷을 정해진 수까지만 메모리에 보관한다
/**
 * The table is ordered by last use, so forgetting idle keys only looks at its oldest end. A key forgotten after
 * {@code idle} starts full again, so {@code idle} must be longer than the time a bucket takes to refill.
 */
public final class TokenBuckets {

    private final double perSecond;
    private final int burst;
    private final int maxKeys;
    private final Duration idle;
    private final Clock clock;
    private final LinkedHashMap<String, Bucket> buckets = new LinkedHashMap<>(16, 0.75f, true);

    // 회복 속도와 순간 한도, 키 수 한도를 받는다
    public TokenBuckets(double perSecond, int burst, int maxKeys, Duration idle, Clock clock) {
        this.perSecond = perSecond;
        this.burst = burst;
        this.maxKeys = maxKeys;
        this.idle = idle;
        this.clock = clock;
    }

    // 키의 토큰 하나를 쓰고, 토큰이 없거나 표에 자리가 없으면 거절한다
    public synchronized boolean tryTake(String key) {
        Instant now = clock.instant();
        forgetIdle(now);
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            if (buckets.size() >= maxKeys) {
                return false;
            }
            bucket = new Bucket(burst, now);
            buckets.put(key, bucket);
        }
        bucket.refill(now, perSecond, burst);
        return bucket.take();
    }

    // 지금 보관 중인 키 수를 돌려준다
    synchronized int size() {
        return buckets.size();
    }

    // 쓴 지 오래된 키부터 유휴 시간을 넘긴 만큼 지운다
    private void forgetIdle(Instant now) {
        Instant oldest = now.minus(idle);
        Iterator<Map.Entry<String, Bucket>> entries = buckets.entrySet().iterator();
        while (entries.hasNext() && entries.next().getValue().usedAt.isBefore(oldest)) {
            entries.remove();
        }
    }

    // 키 하나의 남은 토큰과 마지막 사용 시각
    private static final class Bucket {

        private double tokens;
        private Instant usedAt;

        // 가득 찬 버킷을 만든다
        Bucket(double tokens, Instant now) {
            this.tokens = tokens;
            this.usedAt = now;
        }

        // 지난 시간만큼 토큰을 채운다
        void refill(Instant now, double perSecond, int burst) {
            double elapsed = Duration.between(usedAt, now).toNanos() / 1e9;
            tokens = Math.min(burst, tokens + Math.max(0, elapsed) * perSecond);
            usedAt = now;
        }

        // 토큰이 있으면 하나 쓴다
        boolean take() {
            if (tokens < 1) {
                return false;
            }
            tokens -= 1;
            return true;
        }
    }
}
