package xyz.jwlee.poker.server.room;

/**
 * The recorded result of one request in a ledger, kept so a retry can be replayed. {@code roomId} is set
 * only for create/join, so a replay can answer with the same room.
 */
public record RequestOutcome(
        String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId) {

    public enum Outcome { APPLIED, REJECTED }
}
