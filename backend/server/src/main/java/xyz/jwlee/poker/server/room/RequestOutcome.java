package xyz.jwlee.poker.server.room;

/** The recorded result of one request in a ledger, kept so a retry can be replayed. */
public record RequestOutcome(
        String requestId, long sequence, Outcome outcome, String code, long resultStateVersion) {

    public enum Outcome { APPLIED, REJECTED }
}
