package xyz.jwlee.poker.server.room;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

// 테스트가 직접 진행시키는 시계
public final class MutableClock extends Clock {

    private volatile Instant now;

    // 시작 시각으로 조작 가능한 시계를 만든다
    public MutableClock(Instant start) {
        this.now = start;
    }

    // 시계를 주어진 시간만큼 앞으로 돌린다
    public void advance(Duration by) {
        now = now.plus(by);
    }

    // 현재 시계 시각을 돌려준다
    @Override
    public Instant instant() {
        return now;
    }

    // 시계의 시간대를 돌려준다
    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    // 지정한 시간대로 바꾼 시계를 돌려준다
    @Override
    public Clock withZone(ZoneId zone) {
        return this;
    }
}
