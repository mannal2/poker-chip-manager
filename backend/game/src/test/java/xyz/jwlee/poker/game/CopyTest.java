package xyz.jwlee.poker.game;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.model.UndoSnapshot;

class CopyTest {
    private static GameState sample() {
        GameState s = Tournament.create(
                new GameSettings(List.of("A", "B", "C"), 1000, 5, 10, 0),
                new TransitionContext("t", "2026-10-29T00:00:00Z"));
        Hand h = new Hand();
        h.id = "t:hand:1";
        h.phase = Phase.BETTING;
        h.pending.add("p0");
        s.hand = h;
        GameState inner = s.copy();
        inner.hand = null;
        s.undo = new UndoSnapshot(inner, List.of("t:0"));
        return s;
    }

    @Test
    void mutatingTheOriginalNeverChangesTheCopy() {
        GameState original = sample();
        GameState copy = original.copy();

        original.hand.pending.add("p1");
        original.players.get(0).stack = 1;
        original.players.remove(2);
        original.setupOrder.clear();
        original.undo.state().players.get(0).stack = 2;

        assertThat(copy.hand.pending).containsExactly("p0");
        assertThat(copy.players).hasSize(3);
        assertThat(copy.players.get(0).stack).isEqualTo(1000);
        assertThat(copy.setupOrder).containsExactly("p0", "p1", "p2");
        assertThat(copy.undo.state().players.get(0).stack).isEqualTo(1000);
    }

    @Test
    void tournamentCreationMatchesTheTsShape() {
        GameState s = sample();
        assertThat(s.tournamentId).isEqualTo("t");
        assertThat(s.initialTotal).isEqualTo(3000);
        assertThat(s.setupOrder).containsExactly("p0", "p1", "p2");
        assertThat(s.players.get(1).id).isEqualTo("p1");
        assertThat(s.players.get(1).actedAtBet).isNull();
    }
}
