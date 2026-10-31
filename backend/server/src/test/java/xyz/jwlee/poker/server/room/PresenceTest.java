package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class PresenceTest {

    private static final Instant T0 = Instant.parse("2026-10-31T00:00:00Z");
    private static final Instant T1 = T0.plusSeconds(10);
    private static final Instant T2 = T0.plusSeconds(20);

    private final Presence presence = new Presence();

    // 두 연결 중 하나가 끊겨도 접속 중이고 부재 시각이 없다.
    @Test
    void oneOfTwoConnectionsClosingKeepsTheParticipantConnected() {
        presence.joined("a", T0);
        assertThat(presence.attach("a", "c1", T0)).isTrue();
        assertThat(presence.attach("a", "c2", T0)).isFalse();

        assertThat(presence.detach("c1", T1)).isFalse();

        assertThat(presence.isConnected("a")).isTrue();
        assertThat(presence.absentSince("a")).isEmpty();
        assertThat(presence.connectionCount("a")).isEqualTo(1);
    }

    // 마지막 연결이 끊기면 끊김 시각이 기록되고 전환은 한 번만 일어난다.
    @Test
    void theLastConnectionClosingMarksAbsenceOnceAndOnlyOnce() {
        presence.joined("a", T0);
        presence.attach("a", "c1", T0);

        assertThat(presence.detach("c1", T1)).isTrue();
        assertThat(presence.detach("c1", T2)).isFalse();

        assertThat(presence.isConnected("a")).isFalse();
        assertThat(presence.absentSince("a")).contains(T1);
    }

    // 옛 연결의 detach가 새 연결에 영향을 주지 않는다.
    @Test
    void anOldConnectionClosingDoesNotAffectANewerOne() {
        presence.joined("a", T0);
        presence.attach("a", "old", T0);
        presence.attach("a", "new", T1);

        assertThat(presence.detach("old", T2)).isFalse();

        assertThat(presence.isConnected("a")).isTrue();
        assertThat(presence.subscribers()).containsOnlyKeys("new");
    }

    // 알 수 없는 연결의 detach는 아무 일도 하지 않는다.
    @Test
    void detachingAnUnknownConnectionChangesNothing() {
        presence.joined("a", T0);

        assertThat(presence.detach("ghost", T1)).isFalse();
        assertThat(presence.neverConnected("a")).isTrue();
    }

    // 참가 직후에는 한 번도 접속하지 않았고 첫 attach에서 달라진다.
    @Test
    void neverConnectedUntilTheFirstAttach() {
        presence.joined("a", T0);

        assertThat(presence.neverConnected("a")).isTrue();
        assertThat(presence.isConnected("a")).isFalse();
        assertThat(presence.absentSince("a")).contains(T0);

        presence.attach("a", "c1", T1);
        presence.detach("c1", T2);

        assertThat(presence.neverConnected("a")).isFalse();
    }

    // 끊긴 사람이 다시 붙으면 접속 상태로 돌아온다.
    @Test
    void reattachingAfterAbsenceReportsTheTransition() {
        presence.joined("a", T0);
        presence.attach("a", "c1", T0);
        presence.detach("c1", T1);

        assertThat(presence.attach("a", "c2", T2)).isTrue();
        assertThat(presence.absentSince("a")).isEmpty();
    }

    // restartAbsence는 끊긴 사람의 시각만 새로 정한다.
    @Test
    void restartAbsenceOnlyTouchesTheDisconnected() {
        presence.joined("a", T0);
        presence.joined("b", T0);
        presence.attach("a", "ca", T0);
        presence.attach("b", "cb", T0);
        presence.detach("cb", T1);

        presence.restartAbsence(T2);

        assertThat(presence.absentSince("b")).contains(T2);
        assertThat(presence.absentSince("a")).isEmpty();
        assertThat(presence.isConnected("a")).isTrue();
    }

    // forget은 그 사람의 연결 ID를 돌려주고 기록을 지운다.
    @Test
    void forgetReturnsTheConnectionsAndDropsTheRecord() {
        presence.joined("a", T0);
        presence.joined("b", T0);
        presence.attach("a", "c1", T0);
        presence.attach("a", "c2", T0);
        presence.attach("b", "c3", T0);

        assertThat(presence.forget("a")).containsExactlyInAnyOrder("c1", "c2");

        assertThat(presence.subscribers()).containsOnlyKeys("c3");
        assertThat(presence.isConnected("a")).isFalse();
        assertThat(presence.connectionCount("a")).isZero();
    }
}
