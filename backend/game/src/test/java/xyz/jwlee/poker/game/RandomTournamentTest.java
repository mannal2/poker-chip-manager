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
 * Deterministic 2..10 player tournaments driven by random legal commands: folds, calls, all-ins,
 * bets and raises of any legal size, occasional undos, forfeits of any remaining player (several
 * per hand and heads-up included) and split-winner settlements. Every applied transition must keep
 * the invariants, leave its input untouched and the tournament must end within the step bound.
 * Mirrors the TS random tournament test (different PRNG, wider command mix).
 */
class RandomTournamentTest {
    private static final long SEED = 20261029L;
    private static final int GAMES_PER_SIZE = 20;
    private static final int MAX_STEPS = 2000;

    private int forfeits;
    private int undos;
    private int sizedBets;
    private int splits;

    @Test
    void randomTournamentsKeepInvariantsAndEnd() {
        Random rand = new Random(SEED);
        int tournaments = 0;
        int steps = 0;
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
                    TransitionResult r;
                    try {
                        r = GameEngine.transition(s, command, new TransitionContext(n + "-" + game + "-" + step, "test"));
                    } catch (RuntimeException e) {
                        throw new AssertionError(where + " threw " + e, e);
                    }
                    assertThat(StateJson.write(s).toString()).as(where + " mutated its input").isEqualTo(before);
                    assertThat(r).as(where + " was rejected: " + r).isInstanceOf(TransitionResult.Applied.class);
                    s = ((TransitionResult.Applied) r).state();
                    try {
                        Invariants.check(s);
                    } catch (IllegalStateException e) {
                        throw new AssertionError(where + " broke invariant " + e.getMessage(), e);
                    }
                    count(command);
                }
                steps += step;
                tournaments++;
                assertThat(s.status).as(label).isEqualTo(TournamentStatus.ENDED);
                assertThat(s.pot).as(label).isZero();
                assertThat(s.players.stream().filter(p -> p.stack > 0)).as(label).hasSize(1);
            }
        }
        System.out.println("RandomTournamentTest: " + tournaments + " tournaments, " + steps + " steps, " + forfeits
                + " forfeits, " + undos + " undos, " + sizedBets + " sized bets/raises, " + splits + " split settlements");
        assertThat(forfeits).as("forfeit coverage").isPositive();
        assertThat(undos).as("undo coverage").isPositive();
        assertThat(sizedBets).as("bet/raise size coverage").isPositive();
        assertThat(splits).as("split winner coverage").isPositive();
    }

    private void count(GameCommand command) {
        switch (command) {
            case GameCommand.Forfeit x -> forfeits++;
            case GameCommand.Undo x -> undos++;
            case GameCommand.Bet x -> sizedBets++;
            case GameCommand.Raise x -> sizedBets++;
            case GameCommand.SettleHand x -> {
                if (x.winners().values().stream().anyMatch(w -> w.size() > 1)) {
                    splits++;
                }
            }
            default -> {}
        }
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
        // Any player who has not left may forfeit (heads-up and several per hand included), as long
        // as one non-forfeited player remains to receive the stacks.
        List<Player> leavable = s.players.stream().filter(p -> !p.eliminated && !p.forfeited).toList();
        if (leavable.size() >= 2 && rand.nextDouble() < 0.04) {
            return new GameCommand.Forfeit(leavable.get(rand.nextInt(leavable.size())).id);
        }
        if (s.undo != null && rand.nextDouble() < 0.05) {
            return new GameCommand.Undo();
        }
        if (s.hand.phase == Phase.BETTING) {
            LegalActions l = Legal.of(s);
            double choice = rand.nextDouble();
            if (choice < 0.15) {
                return new GameCommand.Fold(null);
            }
            if (choice < 0.3 && l.canRaise()) {
                return new GameCommand.AllIn(null);
            }
            if (choice < 0.55 && l.canRaise() && l.minRaiseAdditional() < l.maxAdditional()) {
                // Any multiple of 5 from the minimum raise up to the whole stack.
                int sizes = (l.maxAdditional() - l.minRaiseAdditional()) / 5 + 1;
                int amount = l.minRaiseAdditional() + 5 * rand.nextInt(sizes);
                return s.hand.currentBet == 0 ? new GameCommand.Bet(amount, null) : new GameCommand.Raise(amount, null);
            }
            return l.canCall() ? new GameCommand.Call(null) : new GameCommand.Check(null);
        }
        List<Pot> pots = Settlement.buildPots(s);
        Map<String, List<String>> winners = new LinkedHashMap<>();
        for (Pot pot : pots) {
            List<String> chosen = new ArrayList<>();
            for (String id : pot.eligible()) {
                if (rand.nextDouble() < 0.4) {
                    chosen.add(id);
                }
            }
            if (chosen.isEmpty()) {
                chosen.add(pot.eligible().get(rand.nextInt(pot.eligible().size())));
            }
            winners.put(pot.id(), chosen);
        }
        if (Settlement.preview(s, winners, pots).ok()) {
            return new GameCommand.SettleHand(winners);
        }
        // Fallback when the random split is inconsistent: one ranking, the best eligible player wins each pot.
        List<Player> rank = s.players.stream()
                .filter(p -> !p.folded && !p.eliminated)
                .sorted((a, b) -> a.id.compareTo(b.id))
                .toList();
        winners.clear();
        for (Pot pot : pots) {
            Player w = rank.stream().filter(x -> pot.eligible().contains(x.id)).findFirst().orElseThrow();
            winners.put(pot.id(), List.of(w.id));
        }
        return new GameCommand.SettleHand(winners);
    }
}
