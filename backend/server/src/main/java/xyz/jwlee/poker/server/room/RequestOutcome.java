package xyz.jwlee.poker.server.room;

/**
 * The recorded result of one request in a ledger, kept so a retry can be replayed. {@code roomId} is set
 * only for create/join, so a replay can answer with the same room. {@code issuedGeneration} is set only for a
 * successful takeover (0 otherwise): a retry gets the generation it was issued, not whatever is current by then.
 */
public record RequestOutcome(
        String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId,
        long issuedGeneration) {

    public enum Outcome { APPLIED, REJECTED }

    public RequestOutcome(
            String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId) {
        this(requestId, sequence, outcome, code, resultStateVersion, roomId, 0);
    }
}
