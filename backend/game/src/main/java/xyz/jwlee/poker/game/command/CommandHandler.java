package xyz.jwlee.poker.game.command;

import java.util.List;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.TransitionContext;

/** Applies one command to an already cloned state, appending the events it produces. */
@FunctionalInterface
public interface CommandHandler<C extends GameCommand> {
    void apply(GameState s, C command, TransitionContext c, List<GameEvent> events);
}
