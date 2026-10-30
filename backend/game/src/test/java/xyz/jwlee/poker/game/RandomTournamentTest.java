package xyz.jwlee.poker.game;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.fixtures.StateJson;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.Pot;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;

/**
 * Deterministic 2..10 player tournaments driven by random legal commands (and occasional forfeits).
 * Every applied transition must keep the invariants, leave its input untouched and the tournament
 * must end within the step bound. Mirrors the TS random tournament test (different PRNG).
 */
class RandomTournamentTest {
    private static final long SEED = 20261029L;
    private static final int GAMES_PER_SIZE = 8;
    private static final int MAX_STEPS = 2000;

    @Test
    void randomTournamentsKeepInvariantsAndEnd() {
        Random rand = new Random(SEED);
        int tournaments = 0;
        int steps = 0;
        int forfeits = 0;
        for (int n = 2; n <= 10; n++) {
            for (int game = 0; game < GAMES_PER_SIZE; game++) {
                String label = "seed=" + SEED + " n=" + n + " game=" + game;
                GameState s = start(n, label);
                int step = 0;
                while (s.status == TournamentStatus.PLAYING) {
                    assertThat(step++).as(label + " did not end within " + MAX_STEPS + " steps").isLessThan(MAX_STEPS);
                    GameCommand command = choose(s, rand);
                    String where = label + " step=" + step + " command=" + command;
                    String before = StateJson.write(s).toString();
                    TransitionResult r = GameEngine.transition(s, command, new TransitionContext(n + "-" + game + "-" + step, "test"));
                    assertThat(StateJson.write(s).toString()).as(where + " mutated its input").isEqualTo(before);
                    assertThat(r).as(where + " was rejected").isInstanceOf(TransitionResult.Applied.class);
                    s = ((TransitionResult.Applied) r).state();
                    try {
                        Invariants.check(s);
                    } catch (IllegalStateException e) {
                        throw new AssertionError(where + " broke invariant " + e.getMessage(), e);
                    }
                    if (command instanceof GameCommand.Forfeit) {
                        forfeits++;
                    }
                }
                steps += step;
                tournaments++;
                assertThat(s.status).as(label).isEqualTo(TournamentStatus.ENDED);
                assertThat(s.pot).as(label).isZero();
                assertThat(s.players.stream().filter(p -> p.stack > 0)).as(label).hasSize(1);
            }
        }
        System.out.println("RandomTournamentTest: " + tournaments + " tournaments, " + steps + " steps, " + forfeits + " forfeits");
        assertThat(forfeits).as("forfeit coverage").isPositive();
    }

    private static GameState start(int n, String label) {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            names.add(String.valueOf((char) ('A' + i)));
        }
        TransitionContext ctx = new TransitionContext("test", "2026-10-30T00:00:00Z");
        GameState setup = Tournament.create(new GameSettings(names, 1000, 5, 10, 0), ctx);
        TransitionResult r = GameEngine.transition(setup, new GameCommand.StartTournament(), ctx);
        assertThat(r).as(label + " start").isInstanceOf(TransitionResult.Applied.class);
        return ((TransitionResult.Applied) r).state();
    }

    private static GameCommand choose(GameState s, Random rand) {
        // About 3% of steps forfeit a random player while at least two non-forfeited ones remain.
        List<Player> leavable = s.players.stream().filter(p -> !p.eliminated && !p.forfeited).toList();
        if (leavable.size() > 2 && rand.nextDouble() < 0.03) {
            return new GameCommand.Forfeit(leavable.get(rand.nextInt(leavable.size())).id);
        }
        if (s.hand.phase == Phase.BETTING) {
            LegalActions l = Legal.of(s);
            double choice = rand.nextDouble();
            if (choice < 0.15) {
                return new GameCommand.Fold(null);
            }
            if (choice < 0.6 && l.canRaise()) {
                return new GameCommand.AllIn(null);
            }
            return l.canCall() ? new GameCommand.Call(null) : new GameCommand.Check(null);
        }
        List<Player> rank = s.players.stream()
                .filter(p -> !p.folded && !p.eliminated)
                .sorted((a, b) -> a.id.compareTo(b.id))
                .toList();
        Map<String, List<String>> winners = new LinkedHashMap<>();
        for (Pot pot : Settlement.buildPots(s)) {
            Player w = rank.stream().filter(x -> pot.eligible().contains(x.id)).findFirst().orElseThrow();
            winners.put(pot.id(), List.of(w.id));
        }
        return new GameCommand.SettleHand(winners);
    }
}
