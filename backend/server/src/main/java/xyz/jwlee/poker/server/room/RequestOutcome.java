package xyz.jwlee.poker.server.room;

// 요청 한 건의 처리 결과로, 재시도에 같은 답을 주기 위해 보관한다
/**
 * The recorded result of one request in a ledger, kept so a retry can be replayed. {@code roomId} is set
 * only for create/join, so a replay can answer with the same room. {@code issuedGeneration} and {@code issuedTo}
 * are set only for a successful takeover (0 and null otherwise): a retry gets the generation it was issued, not
 * whatever is current by then, and only while the session is still the participant it was issued to.
 * {@code recoveryRequestId} is set only for a recovery request, so a retry answers with the same request.
 */
public record RequestOutcome(
        String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId,
        long issuedGeneration, String issuedTo, String recoveryRequestId) {

    // 요청이 적용되었는지 거절되었는지 나타낸다
    public enum Outcome { APPLIED, REJECTED }

    public RequestOutcome(
            String requestId, long sequence, Outcome outcome, String code, long resultStateVersion, String roomId) {
        this(requestId, sequence, outcome, code, resultStateVersion, roomId, 0, null, null);
    }

    // 성공한 조작권 인수의 결과를 만든다
    public static RequestOutcome takeover(
            String requestId, long sequence, long resultStateVersion, long issuedGeneration, String issuedTo) {
        return new RequestOutcome(requestId, sequence, Outcome.APPLIED, "OK", resultStateVersion, null,
                issuedGeneration, issuedTo, null);
    }

    // 성공한 복구 신청의 결과를 만든다
    public static RequestOutcome recovery(
            String requestId, long sequence, long resultStateVersion, String roomId, String recoveryRequestId) {
        return new RequestOutcome(requestId, sequence, Outcome.APPLIED, "OK", resultStateVersion, roomId, 0, null,
                recoveryRequestId);
    }
}
