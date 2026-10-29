package xyz.jwlee.poker.game.command;

import java.util.List;
import xyz.jwlee.poker.game.Round;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.Rules;

/** Hand-flow commands (TS {@code flow.ts}); only SETTLE_HAND exists so far. */
public final class FlowCommands {
    private FlowCommands() {}

    /** Pays the pots to the chosen winners, then starts the next hand or ends the tournament. */
    public static void settleHand(
            GameState s, GameCommand.SettleHand cmd, TransitionContext c, List<GameEvent> events) {
        Hand h = HandGuard.inPlay(s);
        Rules.require(h.phase == Phase.SETTLEMENT && cmd.winners() != null);
        Round.settle(s, cmd.winners(), c, events);
    }
}
