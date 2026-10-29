package xyz.jwlee.poker.game.command;

import java.util.Objects;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.rule.Rules;

final class HandGuard {
    private HandGuard() {}

    /** In-hand commands need a running tournament. */
    static Hand inPlay(GameState s) {
        return inPlay(s, false);
    }

    /** UNDO also works right after the tournament ended. */
    static Hand inPlay(GameState s, boolean allowEnded) {
        Rules.require(s.status == TournamentStatus.PLAYING || (allowEnded && s.status == TournamentStatus.ENDED));
        return Objects.requireNonNull(s.hand, "a running tournament always has a hand");
    }
}
