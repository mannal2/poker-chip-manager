package xyz.jwlee.poker.game;

import java.util.List;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.rule.RuleErrorCode;

/** Outcome of one transition: the new state with its events, or the rule that rejected it. */
public sealed interface TransitionResult {
    record Applied(GameState state, List<GameEvent> events) implements TransitionResult {}

    record Rejected(RuleErrorCode code) implements TransitionResult {}
}
