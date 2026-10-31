package xyz.jwlee.poker.server.room;

// 요청 한 건의 처리 결과로, 재시도에 같은 답을 주기 위해 보관한다
/**
 * The recorded result of one request in a ledger, kept so a retry can be replayed. {@code roomId} is set
 * only for create/join, so a replay can answer with the same room. {@code issuedGeneration} and {@code issuedTo}
 * are set only for a successful takeover (0 and null otherwise): a retry gets the generation it was issued, not
 * whatever is current by then, and only while the session is still the participant it was issued to.
 */
public record RequestOutcome(
        String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId,
        long issuedGeneration, String issuedTo) {

    // 요청이 적용되었는지 거절되었는지 나타낸다
    public enum Outcome { APPLIED, REJECTED }

    public RequestOutcome(
            String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId) {
        this(requestId, sequence, outcome, code, resultStateVersion, roomId, 0, null);
    }
}
