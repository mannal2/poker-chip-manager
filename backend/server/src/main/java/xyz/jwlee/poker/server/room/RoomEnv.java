package xyz.jwlee.poker.server.room;

import java.time.Clock;
import java.time.Instant;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.server.support.IdGenerator;

// 처리기가 쓰는 주입된 시계와 ID 생성기를 묶는다
/** The injected clock and id source a handler may use; handlers never read the system clock themselves. */
public record RoomEnv(Clock clock, IdGenerator ids) {

    // 서버가 만든 ID와 현재 시각으로 엔진 문맥을 만든다
    public TransitionContext transition() {
        return new TransitionContext(ids.next(), clock.instant().toString());
    }

    // 새 고유 ID를 만든다
    public String newId() {
        return ids.next();
    }

    // 주입된 시계의 현재 시각을 돌려준다
    public Instant now() {
        return clock.instant();
    }
}
