package xyz.jwlee.poker.game.command;

import java.util.Objects;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.rule.Rules;

// 핸드 중 명령이 실행 가능한 상태인지 확인하는 가드
final class HandGuard {
    private HandGuard() {}

    // 진행 중인 토너먼트의 현재 핸드를 돌려준다
    /** In-hand commands need a running tournament. */
    static Hand inPlay(GameState s) {
        return inPlay(s, false);
    }

    // 토너먼트가 진행 중인지 확인하고 현재 핸드를 반환한다. allowEnded가 참이면 종료 상태도 허용한다
    /** UNDO also works right after the tournament ended. */
    static Hand inPlay(GameState s, boolean allowEnded) {
        Rules.require(s.status == TournamentStatus.PLAYING || (allowEnded && s.status == TournamentStatus.ENDED));
        return Objects.requireNonNull(s.hand, "a running tournament always has a hand");
    }
}
