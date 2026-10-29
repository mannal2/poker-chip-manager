package xyz.jwlee.poker.game.command;

import java.util.List;
import xyz.jwlee.poker.game.Legal;
import xyz.jwlee.poker.game.LegalActions;
import xyz.jwlee.poker.game.Round;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.ActionType;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.Rules;

/** CHECK, CALL, FOLD, ALL_IN, BET and RAISE share one rule path. */
public final class BettingCommands {
    private BettingCommands() {}

    /**
     * @param playerId the acting player, or null for the current actor
     * @param requested the requested additional chips (BET and RAISE only)
     */
    public static void act(
            GameState s,
            ActionType type,
            String playerId,
            int requested,
            TransitionContext c,
            List<GameEvent> events) {
        Hand h = HandGuard.inPlay(s);
        Rules.require(h.phase == Phase.BETTING);
        LegalActions legal = Legal.of(s);
        Player p = legal.actor();
        Rules.require(p != null && (playerId == null || playerId.equals(p.id)));
        int amount = 0;
        switch (type) {
            case CHECK -> Rules.require(legal.canCheck());
            case CALL -> {
                Rules.require(legal.canCall());
                amount = legal.callAdditional();
            }
            case FOLD -> p.folded = true;
            case ALL_IN, BET, RAISE -> {
                Rules.require(type == ActionType.ALL_IN
                        || (type == ActionType.BET && h.currentBet == 0)
                        || (type == ActionType.RAISE && h.currentBet > 0));
                amount = type == ActionType.ALL_IN ? p.stack : requested;
                Rules.require(amount > 0 && amount % 5 == 0 && amount <= p.stack, RuleErrorCode.INVALID_AMOUNT);
                int target = p.roundBet + amount;
                if (target <= h.currentBet) {
                    Rules.require(amount == p.stack && amount <= legal.callAdditional());
                } else {
                    Rules.require(legal.canRaise(), RuleErrorCode.RAISE_CLOSED);
                    Rules.require(amount == p.stack || target >= h.currentBet + h.minRaise, RuleErrorCode.MIN_RAISE);
                    int increase = target - h.currentBet;
                    if (increase >= h.minRaise) {
                        h.minRaise = increase;
                    }
                    h.currentBet = target;
                }
            }
        }
        int index = s.players.indexOf(p);
        Round.pay(s, index, amount);
        p.actedAtBet = h.currentBet;
        p.reopensAt = h.currentBet + h.minRaise;
        h.pending.remove(p.id);
        // Everyone still live who has not matched the new bet must act again.
        for (Player other : s.players) {
            if (!other.eliminated
                    && !other.folded
                    && other.stack > 0
                    && other.roundBet < h.currentBet
                    && !h.pending.contains(other.id)) {
                h.pending.add(other.id);
            }
        }
        Round.emit(s, c, events, new EventDetails.PlayerActed(type, p.id, amount));
        Round.resolveRound(s, index, c, events);
    }
}
