package xyz.jwlee.poker.game.command;

import java.util.List;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.TransitionContext;

// 특정 명령 하나를 상태에 적용하는 핸들러 형식
/** Applies one command to an already cloned state, appending the events it produces. */
@FunctionalInterface
public interface CommandHandler<C extends GameCommand> {
    // 복사된 상태에 명령을 적용하고 발생한 이벤트를 추가한다
    void apply(GameState s, C command, TransitionContext c, List<GameEvent> events);
}
