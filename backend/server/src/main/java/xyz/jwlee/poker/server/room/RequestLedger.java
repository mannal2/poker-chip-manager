package xyz.jwlee.poker.server.room;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.function.Function;
import java.util.function.Supplier;

// 스트림별로 요청 순번과 최근 결과를 보관해 재시도를 가려내는 원장
/**
 * Per-stream request ledger: sequence numbers start at 1, the last {@value #RETAINED} results are kept
 * and the high watermark outlives them. Methods synchronize on the instance; check and record are two
 * calls, so a caller must hold its room/global lock, or wrap both in {@code synchronized (ledger)}.
 */
public final class RequestLedger {

    static final int RETAINED = 64;

    // 요청을 원장에 대조한 결과의 종류
    public sealed interface Check {
        // 처음 보는 정상 요청
        record New() implements Check { }
        // 같은 요청의 재시도(저장된 결과 포함)
        record Replay(RequestOutcome outcome) implements Check { }
        // 같은 순번이나 id에 다른 내용이 온 충돌
        record Conflict() implements Check { }
        // 결과가 이미 보관 범위를 벗어난 오래된 요청
        record Expired() implements Check { }
        // 순번이 건너뛰어진 요청
        record Gap() implements Check { }
    }

    // 원장에 보관된 결과와 요청 지문
    private record Entry(RequestOutcome outcome, String fingerprint) { }

    private final Deque<Entry> results = new ArrayDeque<>();
    private long highWatermark;

    // 요청을 보관된 결과와 대조해 새 요청, 재시도, 충돌, 만료, 순번 누락으로 분류한다
    public synchronized Check check(String requestId, long sequence, String fingerprint) {
        for (Entry entry : results) {
            RequestOutcome stored = entry.outcome();
            if (stored.sequence() == sequence || stored.requestId().equals(requestId)) {
                boolean same = stored.requestId().equals(requestId) && stored.sequence() == sequence
                        && entry.fingerprint().equals(fingerprint);
                return same ? new Check.Replay(stored) : new Check.Conflict();
            }
        }
        if (sequence <= highWatermark) {
            return new Check.Expired();
        }
        if (sequence != highWatermark + 1) {
            return new Check.Gap();
        }
        return new Check.New();
    }

    // 재시도면 저장된 결과를, 새 요청이면 빈 값을 돌려주고 비정상 요청은 예외로 거절한다
    /**
     * {@link #check} for a caller that goes on only with a new request: the stored outcome of a retry, empty
     * for a new request, or REQUEST_CONFLICT / RESULT_EXPIRED / SEQUENCE_GAP.
     */
    public java.util.Optional<RequestOutcome> replayOf(String requestId, long sequence, String fingerprint) {
        return switch (check(requestId, sequence, fingerprint)) {
            case Check.Replay replay -> java.util.Optional.of(replay.outcome());
            case Check.Conflict c -> throw new RoomException("REQUEST_CONFLICT");
            case Check.Expired e -> throw new RoomException("RESULT_EXPIRED");
            case Check.Gap g -> throw new RoomException("SEQUENCE_GAP");
            case Check.New n -> java.util.Optional.empty();
        };
    }

    // 요청 id의 보관된 결과를 찾는다
    /** The retained result of {@code requestId}, if it is still among the last {@value #RETAINED}. */
    public synchronized java.util.Optional<RequestOutcome> find(String requestId) {
        for (Entry entry : results) {
            if (entry.outcome().requestId().equals(requestId)) {
                return java.util.Optional.of(entry.outcome());
            }
        }
        return java.util.Optional.empty();
    }

    // 요청 결과와 지문을 기록하고 최근 64건만 유지하며, 마지막으로 처리한 순번은 별도로 보관한다
    public synchronized void record(RequestOutcome outcome, String fingerprint) {
        results.addLast(new Entry(outcome, fingerprint));
        if (results.size() > RETAINED) {
            results.removeFirst();
        }
        highWatermark = outcome.sequence();
    }
    // 같은 요청은 처음 결과로 답하고, 새 요청은 한 번만 실행해 결과를 기록한 뒤 응답을 만든다
    /**
     * The one place for "check; do the work; record" under this ledger's monitor. A retry is answered from the
     * stored outcome (a stored rejection is thrown again with its code) without running {@code work}. A new
     * request runs {@code work} once; a {@link RoomException} from it is recorded as a rejection and rethrown.
     * The outcome is recorded before {@code respond} runs, so a failure while building the answer does not lose
     * work that was already done. Conflicts, expired results and sequence gaps are thrown by {@link #replayOf}.
     */
    public <T> T runOnce(String requestId, long sequence, String fingerprint,
            Supplier<RequestOutcome> work, Function<RequestOutcome, T> respond) {
        synchronized (this) {
            java.util.Optional<RequestOutcome> replay = replayOf(requestId, sequence, fingerprint);
            if (replay.isPresent()) {
                RequestOutcome first = replay.get();
                if (first.outcome() == RequestOutcome.Outcome.REJECTED) {
                    throw new RoomException(first.code());
                }
                return respond.apply(first);
            }
            RequestOutcome outcome;
            try {
                outcome = work.get();
            } catch (RoomException e) {
                record(RequestOutcome.rejected(requestId, sequence, e.code()), fingerprint);
                throw e;
            }
            record(outcome, fingerprint);
            return respond.apply(outcome);
        }
    }
}
