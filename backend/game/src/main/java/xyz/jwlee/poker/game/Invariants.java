package xyz.jwlee.poker.game;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;

public final class Invariants {
    private Invariants() {}

    /** Throws {@link IllegalStateException} whose message is the TS invariant code. */
    public static void check(GameState s) {
        List<Integer> chips = new java.util.ArrayList<>(List.of(s.pot, s.initialTotal));
        for (Player p : s.players) {
            chips.addAll(List.of(p.stack, p.roundBet, p.handTotal));
        }
        if (chips.stream().anyMatch(n -> n < 0 || n % 5 != 0)) {
            throw new IllegalStateException("INVALID_CHIPS");
        }
        if (s.players.stream().mapToInt(p -> p.stack).sum() + s.pot != s.initialTotal) {
            throw new IllegalStateException("CHIP_TOTAL");
        }
        if (s.players.stream().mapToInt(p -> p.handTotal).sum() != s.pot
                || s.players.stream().anyMatch(p -> p.roundBet > p.handTotal)) {
            throw new IllegalStateException("POT_LEDGER");
        }
        Set<String> ids = new HashSet<>();
        s.players.forEach(p -> ids.add(p.id));
        if (ids.size() != s.players.size()) {
            throw new IllegalStateException("DUPLICATE_PLAYER");
        }
        if (s.hand != null) {
            Hand h = s.hand;
            Player actor = s.players.stream().filter(p -> p.id.equals(h.actorId)).findFirst().orElse(null);
            if (h.phase == Phase.BETTING
                    && s.status == TournamentStatus.PLAYING
                    && (actor == null
                            || actor.folded
                            || actor.eliminated
                            || actor.stack == 0
                            || !h.pending.contains(actor.id))) {
                throw new IllegalStateException("INVALID_ACTOR");
            }
            if (h.phase != Phase.BETTING && h.actorId != null) {
                throw new IllegalStateException("UNEXPECTED_ACTOR");
            }
        }
    }
}
