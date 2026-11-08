package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.server.room.RequestLedger.Check;

class RequestLedgerTest {

    private static RequestOutcome applied(String id, long seq) {
        return new RequestOutcome(id, seq, RequestOutcome.Outcome.APPLIED, "OK", seq, null);
    }

    @Test
    void firstSequenceIsNew() {
        assertThat(new RequestLedger().check("a", 1, "f")).isInstanceOf(Check.New.class);
    }

    @Test
    void sameRequestReplaysRecordedOutcome() {
        var ledger = new RequestLedger();
        var outcome = applied("a", 1);
        ledger.record(outcome, "f");
        assertThat(ledger.check("a", 1, "f")).isEqualTo(new Check.Replay(outcome));
    }

    @Test
    void sameSequenceWithDifferentFingerprintConflicts() {
        var ledger = new RequestLedger();
        ledger.record(applied("a", 1), "f");
        assertThat(ledger.check("a", 1, "other")).isInstanceOf(Check.Conflict.class);
        assertThat(ledger.check("b", 1, "f")).isInstanceOf(Check.Conflict.class);
    }

    @Test
    void sameRequestIdWithDifferentSequenceConflicts() {
        var ledger = new RequestLedger();
        ledger.record(applied("a", 1), "f");
        assertThat(ledger.check("a", 2, "f")).isInstanceOf(Check.Conflict.class);
    }

    @Test
    void skippedSequenceIsGap() {
        var ledger = new RequestLedger();
        ledger.record(applied("a", 1), "f");
        assertThat(ledger.check("c", 3, "f")).isInstanceOf(Check.Gap.class);
        assertThat(new RequestLedger().check("x", 2, "f")).isInstanceOf(Check.Gap.class);
    }

    @Test
    void sequenceBeyondRetainedResultsIsExpired() {
        var ledger = new RequestLedger();
        for (int i = 1; i <= 65; i++) {
            ledger.record(applied("r" + i, i), "f" + i);
        }
        assertThat(ledger.check("r1", 1, "f1")).isInstanceOf(Check.Expired.class);
        assertThat(ledger.check("r2", 2, "f2")).isInstanceOf(Check.Replay.class);
        assertThat(ledger.check("r66", 66, "f")).isInstanceOf(Check.New.class);
    }

    @Test
    void rejectedOutcomeConsumesTheSequence() {
        var ledger = new RequestLedger();
        var rejected = new RequestOutcome("a", 1, RequestOutcome.Outcome.REJECTED, "STALE", 0, null);
        ledger.record(rejected, "f");
        assertThat(ledger.check("a", 1, "f")).isEqualTo(new Check.Replay(rejected));
        assertThat(ledger.check("b", 2, "g")).isInstanceOf(Check.New.class);
    }
    // ---- runOnce ----

    // 새 요청은 작업을 한 번 실행하고 결과를 기록한 뒤 응답한다
    @Test
    void runOnceRunsANewRequestAndRecordsIt() {
        var ledger = new RequestLedger();
        var runs = new AtomicInteger();

        String answer = ledger.runOnce("a", 1, "f", () -> {
            runs.incrementAndGet();
            return applied("a", 1);
        }, o -> "answer:" + o.requestId());

        assertThat(answer).isEqualTo("answer:a");
        assertThat(runs).hasValue(1);
        assertThat(ledger.check("a", 1, "f")).isEqualTo(new Check.Replay(applied("a", 1)));
    }

    // 새 요청의 작업이 거절되면 거절을 기록하고 같은 예외를 던진다
    @Test
    void runOnceRecordsARejectionAndRethrows() {
        var ledger = new RequestLedger();
        var refusal = new RoomException("ROOM_FULL");

        assertThatThrownBy(() -> ledger.runOnce("a", 1, "f", () -> {
            throw refusal;
        }, o -> o)).isSameAs(refusal);

        var replay = (Check.Replay) ledger.check("a", 1, "f");
        assertThat(replay.outcome().outcome()).isEqualTo(RequestOutcome.Outcome.REJECTED);
        assertThat(replay.outcome().code()).isEqualTo("ROOM_FULL");
    }

    // 성공한 요청의 재시도는 작업을 다시 실행하지 않고 처음 결과로 응답한다
    @Test
    void runOnceAnswersARetryWithTheFirstOutcome() {
        var ledger = new RequestLedger();
        ledger.record(applied("a", 1), "f");
        var runs = new AtomicInteger();

        RequestOutcome answer = ledger.runOnce("a", 1, "f", () -> {
            runs.incrementAndGet();
            return applied("a", 1);
        }, o -> o);

        assertThat(answer).isEqualTo(applied("a", 1));
        assertThat(runs).hasValue(0);
    }

    // 거절된 요청의 재시도는 작업을 다시 실행하지 않고 같은 코드로 거절한다
    @Test
    void runOnceRefusesARetryOfARejection() {
        var ledger = new RequestLedger();
        ledger.record(new RequestOutcome("a", 1, RequestOutcome.Outcome.REJECTED, "ROOM_FULL", 0, null), "f");
        var runs = new AtomicInteger();

        assertThatThrownBy(() -> ledger.runOnce("a", 1, "f", () -> {
            runs.incrementAndGet();
            return applied("a", 1);
        }, o -> o)).isInstanceOfSatisfying(RoomException.class, e -> assertThat(e.code()).isEqualTo("ROOM_FULL"));
        assertThat(runs).hasValue(0);
    }

    // 같은 순번에 다른 내용이 오면 아무것도 실행하거나 기록하지 않고 충돌로 거절한다
    @Test
    void runOnceRefusesAConflictWithoutRunning() {
        var ledger = new RequestLedger();
        ledger.record(applied("a", 1), "f");
        var runs = new AtomicInteger();

        assertThatThrownBy(() -> ledger.runOnce("a", 1, "other", () -> {
            runs.incrementAndGet();
            return applied("a", 1);
        }, o -> o)).isInstanceOfSatisfying(RoomException.class,
                e -> assertThat(e.code()).isEqualTo("REQUEST_CONFLICT"));
        assertThat(runs).hasValue(0);
        assertThat(ledger.check("a", 1, "f")).isEqualTo(new Check.Replay(applied("a", 1)));
    }

    // 응답을 만들다 실패해도 이미 끝난 작업의 결과는 기록되어 있다
    @Test
    void runOnceKeepsTheOutcomeWhenTheAnswerFails() {
        var ledger = new RequestLedger();

        assertThatThrownBy(() -> ledger.runOnce("a", 1, "f", () -> applied("a", 1), o -> {
            throw new IllegalStateException("answer failed");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(ledger.check("a", 1, "f")).isEqualTo(new Check.Replay(applied("a", 1)));
    }
}
