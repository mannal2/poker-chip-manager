package xyz.jwlee.poker.game;

import java.util.List;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.rule.RuleErrorCode;

// 전이 결과로, 적용 성공 또는 거절 중 하나다
/** Outcome of one transition: the new state with its events, or the rule that rejected it. */
public sealed interface TransitionResult {
    // 명령이 적용되어 새 상태와 이벤트가 생긴 경우
    record Applied(GameState state, List<GameEvent> events) implements TransitionResult {}

    // 규칙 위반으로 명령이 거절된 경우
    record Rejected(RuleErrorCode code) implements TransitionResult {}
}
