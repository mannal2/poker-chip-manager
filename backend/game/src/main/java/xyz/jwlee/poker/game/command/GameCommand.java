package xyz.jwlee.poker.game.command;

import java.util.List;
import java.util.Map;
import xyz.jwlee.poker.game.model.GameSettings;

/** One record per command; a null {@code playerId} means the current actor, as in TS. */
public sealed interface GameCommand {
    record StartTournament() implements GameCommand {}

    /** {@code order} (nullable) is the new seat order as player ids. */
    record SetupUpdate(GameSettings settings, List<String> order) implements GameCommand {}

    record Check(String playerId) implements GameCommand {}

    record Call(String playerId) implements GameCommand {}

    record Fold(String playerId) implements GameCommand {}

    record AllIn(String playerId) implements GameCommand {}

    record Bet(int additional, String playerId) implements GameCommand {}

    record Raise(int additional, String playerId) implements GameCommand {}

    /** Winner player ids per pot id. */
    record SettleHand(Map<String, List<String>> winners) implements GameCommand {}

    record ScheduleBlinds(int smallBlind, int bigBlind) implements GameCommand {}

    record Undo() implements GameCommand {}

    record Abort() implements GameCommand {}

    record Forfeit(String playerId) implements GameCommand {}
}
