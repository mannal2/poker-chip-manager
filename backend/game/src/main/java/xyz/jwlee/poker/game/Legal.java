package xyz.jwlee.poker.game;

import java.util.List;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;

public final class Legal {
    private Legal() {}

    /** Legal actions of the current actor; {@code actor} is the live player object of {@code s}. */
    public static LegalActions of(GameState s) {
        Hand h = s.hand;
        Player found = null;
        if (h != null) {
            for (Player candidate : s.players) {
                if (candidate.id.equals(h.actorId)) {
                    found = candidate;
                    break;
                }
            }
        }
        if (s.status != TournamentStatus.PLAYING || h == null || h.phase != Phase.BETTING || found == null) {
            return new LegalActions(null, 0, 0, 0, false, false, false, LegalReasonCode.NOT_ACTOR);
        }
        final Player p = found;
        List<Player> opponents = s.players.stream()
                .filter(o -> !o.id.equals(p.id) && !o.folded && !o.eliminated)
                .toList();
        boolean hasOpponent = opponents.stream().anyMatch(o -> o.stack > 0);
        int target = hasOpponent
                ? h.currentBet
                : opponents.stream().mapToInt(o -> o.roundBet).max().orElse(0);
        int callAdditional = Math.min(p.stack, Math.max(0, target - p.roundBet));
        boolean canRaise = hasOpponent
                && (p.actedAtBet == null || h.currentBet >= p.reopensAt)
                && p.roundBet + p.stack > h.currentBet;
        LegalReasonCode reason =
                !hasOpponent ? LegalReasonCode.NO_OPPONENT : !canRaise ? LegalReasonCode.RAISE_CLOSED : null;
        return new LegalActions(
                p,
                callAdditional,
                h.currentBet + h.minRaise - p.roundBet,
                p.stack,
                canRaise,
                callAdditional == 0,
                callAdditional > 0,
                reason);
    }
}
