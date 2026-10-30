package xyz.jwlee.poker.server.room;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Per-stream request ledger: sequence numbers start at 1, the last {@value #RETAINED} results are kept
 * and the high watermark outlives them. Methods synchronize on the instance; check and record are two
 * calls, so a caller must hold its room/global lock, or wrap both in {@code synchronized (ledger)}.
 */
public final class RequestLedger {

    static final int RETAINED = 64;

    public sealed interface Check {
        record New() implements Check { }
        record Replay(RequestOutcome outcome) implements Check { }
        record Conflict() implements Check { }
        record Expired() implements Check { }
        record Gap() implements Check { }
    }

    private record Entry(RequestOutcome outcome, String fingerprint) { }

    private final Deque<Entry> results = new ArrayDeque<>();
    private long highWatermark;

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

    public synchronized void record(RequestOutcome outcome, String fingerprint) {
        results.addLast(new Entry(outcome, fingerprint));
        if (results.size() > RETAINED) {
            results.removeFirst();
        }
        highWatermark = outcome.sequence();
    }
}
