package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

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
}
