package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.ActionType;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.server.support.IdGenerator;

// 접속이 끊긴 사람의 자동 진행을 검증한다
class AutoPlayTest {

    private static final RoomEnv ENV = new RoomEnv(Clock.systemUTC(), IdGenerator.random());

    // 참가자의 연결을 끊는다
    private static void disconnect(GameFixture f, String who) {
        f.room.presence().detach("conn-" + who, Instant.EPOCH);
    }

    // 참가자가 다시 접속한다
    private static void reconnect(GameFixture f, String who) {
        f.room.presence().attach(who, "again-" + who, Instant.EPOCH);
    }

    // 자동으로 기록된 베팅 이벤트만 모은다
    private static List<EventDetails.PlayerActed> automatic(GameFixture f) {
        return f.room.events().stream().map(GameEvent::details)
                .filter(d -> d instanceof EventDetails.PlayerActed a && a.automatic())
                .map(d -> (EventDetails.PlayerActed) d).toList();
    }

    // 끊긴 차례는 낼 몫이 있으면 같은 응답 안에서 폴드되는지 확인한다
    @Test
    void aDisconnectedActorFoldsInsideTheSameResponseWhenSomethingIsOwed() {
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "b");
        long before = f.room.version();

        f.check(f.send("a", "CALL", null));

        assertThat(f.room.game().players.get(1).folded).isTrue();
        assertThat(f.actor()).isEqualTo("c");
        assertThat(f.room.version()).isEqualTo(before + 1);
        assertThat(automatic(f)).singleElement().satisfies(a -> {
            assertThat(a.action()).isEqualTo(ActionType.FOLD);
            assertThat(a.playerId()).isEqualTo("p1");
        });
    }

    // 시계를 직접 돌리는 3인 게임과 그 시계를 쓰는 기본 유예 환경
    private record Timed(GameFixture f, MutableClock clock, RoomEnv env) {
        // 지금 시각에 참가자의 연결을 끊는다
        void drop(String who) {
            RoomLifecycle.disconnected(f.room, "conn-" + who, env);
        }

        // 시계를 초 단위로 진행한다
        void pass(long seconds) {
            clock.advance(Duration.ofSeconds(seconds));
        }
    }

    // 시계를 직접 돌리는 3인 게임을 a 차례로 시작한다
    private static Timed timed() {
        MutableClock clock = new MutableClock(Instant.parse("2026-11-14T00:00:00Z"));
        return new Timed(GameFixture.started(3, 0, clock), clock, new RoomEnv(clock, IdGenerator.random()));
    }

    // 끊긴 지 30초가 안 된 행동자는 자동 처리하지 않는지 확인한다
    @Test
    void aFreshlyDisconnectedActorIsNotPlayedForYet() {
        Timed t = timed();
        t.f().check(t.f().send("a", "CALL", null));
        t.drop("b");

        assertThat(AutoPlay.run(t.f().room, t.env())).isFalse();

        assertThat(t.f().actor()).isEqualTo("b");
        assertThat(automatic(t.f())).isEmpty();
    }

    // 끊긴 지 30초가 지나면 방 점검이 자동 처리하고 버전을 한 번 올리는지 확인한다
    @Test
    void theSweepPlaysForAnActorGoneForThirtySeconds() {
        Timed t = timed();
        t.f().check(t.f().send("a", "CALL", null));
        t.drop("b");

        t.pass(29);
        RoomLifecycle.sweep(t.f().room, t.env());
        assertThat(t.f().actor()).isEqualTo("b");

        long before = t.f().room.version();
        t.pass(1);
        RoomLifecycle.sweep(t.f().room, t.env());

        assertThat(t.f().room.game().players.get(1).folded).isTrue();
        assertThat(t.f().actor()).isEqualTo("c");
        assertThat(t.f().room.version()).isEqualTo(before + 1);
    }

    // 유예 안에 돌아오면 자동 처리 없이 본인 차례로 남는지 확인한다
    @Test
    void aPlayerWhoReturnsWithinTheGraceActsThemselves() {
        Timed t = timed();
        t.f().check(t.f().send("a", "CALL", null));
        t.drop("b");
        t.pass(20);
        RoomLifecycle.connected(t.f().room, "b", "again-b", t.env());

        t.pass(20);
        RoomLifecycle.sweep(t.f().room, t.env());

        assertThat(t.f().actor()).isEqualTo("b");
        assertThat(automatic(t.f())).isEmpty();
    }

    // 이미 30초 넘게 끊긴 사람에게 차례가 오면 그 명령 응답 안에서 바로 처리되는지 확인한다
    @Test
    void aLongGoneActorIsPlayedForInsideTheSameResponse() {
        Timed t = timed();
        t.drop("b");
        t.pass(31);

        t.f().check(t.f().send("a", "CALL", null));

        assertThat(t.f().room.game().players.get(1).folded).isTrue();
        assertThat(t.f().actor()).isEqualTo("c");
    }

    // 전원이 끊기면 30초가 지나도 점검이 진행하지 않는지 확인한다
    @Test
    void theSweepDoesNotPlayWhenNobodyIsConnected() {
        Timed t = timed();
        t.drop("a");
        t.drop("b");
        t.drop("c");
        // 30초 유예는 지났지만 60초 방장 인수 요청은 아직 열리지 않는 시점
        t.pass(45);
        long before = t.f().room.version();

        RoomLifecycle.sweep(t.f().room, t.env());

        assertThat(t.f().actor()).isEqualTo("a");
        assertThat(t.f().room.version()).isEqualTo(before);
    }

    // 끊긴 차례는 낼 몫이 없으면 체크하는지 확인한다
    @Test
    void aDisconnectedActorChecksWhenNothingIsOwed() {
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "c");
        f.check(f.send("a", "CALL", null));

        f.check(f.send("b", "CALL", null));

        assertThat(automatic(f)).singleElement().satisfies(a -> {
            assertThat(a.action()).isEqualTo(ActionType.CHECK);
            assertThat(a.playerId()).isEqualTo("p2");
        });
        assertThat(f.room.game().players.get(2).folded).isFalse();
        assertThat(f.room.game().hand.phase).isEqualTo(Phase.BETTING);
        assertThat(f.actor()).isEqualTo("b");
    }

    // 끊긴 자리가 이어져도 접속 중인 사람 차례까지 자동 진행되는지 확인한다
    @Test
    void consecutiveDisconnectedSeatsAreHandledUntilAConnectedPersonIsToAct() {
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "b");
        disconnect(f, "c");

        f.check(f.send("a", "CALL", null));

        assertThat(automatic(f)).hasSizeGreaterThanOrEqualTo(2);
        assertThat(f.room.game().players.get(1).folded).isTrue();
        assertThat(f.actor()).isEqualTo("a");
    }

    // 모두 끊기면 멈추고 누군가 돌아오면 다시 진행되는지 확인한다
    @Test
    void nothingMovesWhileEveryoneIsDisconnectedAndResumesWhenSomeoneReturns() {
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "a");
        disconnect(f, "b");
        disconnect(f, "c");
        int stackBefore = f.room.game().players.get(0).stack;
        int eventsBefore = f.room.events().size();

        assertThat(AutoPlay.run(f.room, ENV)).isFalse();

        assertThat(f.room.game().players.get(0).stack).isEqualTo(stackBefore);
        assertThat(f.room.events()).hasSize(eventsBefore);

        reconnect(f, "c");
        assertThat(AutoPlay.run(f.room, ENV)).isTrue();
        assertThat(automatic(f)).hasSizeGreaterThanOrEqualTo(2);
        assertThat(f.actor()).isEqualTo("c");
    }

    // 정산 단계에서 자동 진행이 멈추는지 확인한다
    @Test
    void itStopsAtTheSettlementStep() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));
        f.checkDown();
        assertThat(f.room.game().hand.phase).isEqualTo(Phase.SETTLEMENT);
        disconnect(f, "a");
        disconnect(f, "b");

        assertThat(AutoPlay.run(f.room, ENV)).isFalse();

        assertThat(f.room.game().hand.phase).isEqualTo(Phase.SETTLEMENT);
    }

    // 되돌린 뒤에도 행동자가 아직 없으면 자동 진행이 다시 이어지는지 확인한다
    @Test
    void anUndoIsFollowedByAutoPlayAgainWhileTheActorIsStillGone() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));
        disconnect(f, "b");
        // The host's undo takes back b's call; b is gone, so b is folded straight away.
        f.check(f.send("a", "UNDO", "{}"));

        assertThat(f.room.game().players.get(1).folded).isTrue();
        assertThat(f.actor()).isEqualTo("c");
    }

    // 되돌리면 돌아온 사람이 직접 행동하도록 남겨 두는지 확인한다
    @Test
    void anUndoLeavesTheReturnedPersonToActForThemselves() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));
        disconnect(f, "b");
        reconnect(f, "b");

        f.check(f.send("a", "UNDO", "{}"));

        assertThat(f.room.game().players.get(1).folded).isFalse();
        assertThat(f.actor()).isEqualTo("b");
    }

    // 끊긴 방장도 대신 진행되는지 확인한다
    @Test
    void aDisconnectedHostIsPlayedForToo() {
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "a");

        assertThat(AutoPlay.run(f.room, ENV)).isTrue();

        assertThat(f.room.game().players.get(0).folded).isTrue();
        assertThat(f.actor()).isEqualTo("b");
    }

    // 자동 폴드로 핸드가 끝나도 블라인드를 내고 탈락자가 없는지 확인한다
    @Test
    void anAutomaticFoldThatEndsTheHandStillPaysBlindsAndEliminatesNobody() {
        // Both gone: a and b fold, c takes hand 1, and play stops when connected c is to act in hand 2.
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "a");
        disconnect(f, "b");

        assertThat(AutoPlay.run(f.room, ENV)).isTrue();

        assertThat(f.room.game().players).noneMatch(p -> p.eliminated);
        assertThat(f.room.game().hand.number).isEqualTo(2);
        assertThat(f.room.game().players.stream().mapToInt(p -> p.stack).sum() + f.room.game().pot)
                .isEqualTo(3000);
        assertThat(f.room.game().players.get(1).stack).isLessThan(1000);
        assertThat(f.actor()).isEqualTo("c");
    }
}
