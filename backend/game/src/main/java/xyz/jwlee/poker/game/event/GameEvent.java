package xyz.jwlee.poker.game.event;

/** {@code hand} is the hand number (0 outside a hand). */
public record GameEvent(String id, String at, String tournamentId, int hand, EventDetails details) {
    public String type() {
        return details.type();
    }
}
