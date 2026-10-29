package xyz.jwlee.poker.game.command;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import xyz.jwlee.poker.game.Round;
import xyz.jwlee.poker.game.Settlement;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.Rules;

/**
 * FORFEIT, server only (MULTIPLAYER_MODE section 10). Who may forfeit whom is checked by the room
 * layer; this rule only checks that the target can still leave the game. The stack itself is split
 * among the survivors when the hand ends ({@link Round#settle}).
 */
public final class ForfeitCommand {
    private ForfeitCommand() {}

    public static void forfeit(GameState s, GameCommand.Forfeit cmd, TransitionContext c, List<GameEvent> events) {
        Hand h = HandGuard.inPlay(s);
        Player p = s.players.stream()
                .filter(x -> x.id.equals(cmd.playerId()))
                .findFirst()
                .orElse(null);
        Rules.require(p != null && !p.eliminated && !p.forfeited);
        p.forfeited = true;
        p.folded = true;
        h.pending.remove(p.id);
        s.undo = null;
        Round.emit(s, c, events, new EventDetails.PlayerForfeited(p.id));
        if (h.phase == Phase.BETTING) {
            int n = s.players.size();
            int actorSeat = indexOf(s, h.actorId);
            // Resolving from the seat before the actor keeps the actor, or moves on if the actor left.
            Round.resolveRound(s, (actorSeat - 1 + n) % n, c, events);
            // Continue only if the round closed into winner selection of this same hand.
            if (s.hand != h || s.status != TournamentStatus.PLAYING || h.phase != Phase.SETTLEMENT) {
                return;
            }
        }
        returnUnclaimable(s, p, c, events);
        List<Player> live = s.players.stream().filter(x -> !x.folded && !x.eliminated).toList();
        if (live.size() == 1) {
            Map<String, List<String>> winners = new LinkedHashMap<>();
            for (var pot : Settlement.buildPots(s)) {
                winners.put(pot.id(), List.of(live.get(0).id));
            }
            Round.settle(s, winners, c, events);
        }
    }

    /**
     * Contribution layers above the highest live contribution have no eligible player any more;
     * they go back to the forfeiter like an uncalled bet and are split with the stack later.
     */
    private static void returnUnclaimable(GameState s, Player forfeiter, TransitionContext c, List<GameEvent> events) {
        int cap = s.players.stream()
                .filter(x -> !x.folded && !x.eliminated)
                .mapToInt(x -> x.handTotal)
                .max()
                .orElseThrow();
        int amount = 0;
        for (Player x : s.players) {
            if (x.handTotal > cap) {
                amount += x.handTotal - cap;
                x.handTotal = cap;
                x.roundBet = Math.min(x.roundBet, cap);
            }
        }
        if (amount == 0) {
            return;
        }
        s.pot -= amount;
        forfeiter.stack += amount;
        Round.emit(s, c, events, new EventDetails.UncalledReturned(forfeiter.id, amount));
    }

    private static int indexOf(GameState s, String id) {
        for (int i = 0; i < s.players.size(); i++) {
            if (s.players.get(i).id.equals(id)) {
                return i;
            }
        }
        throw new IllegalStateException("INVALID_ACTOR");
    }
}
