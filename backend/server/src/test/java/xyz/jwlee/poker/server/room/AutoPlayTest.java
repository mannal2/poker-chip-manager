package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.ActionType;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.server.support.IdGenerator;

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

    @Test
    void aDisconnectedHostIsPlayedForToo() {
        GameFixture f = GameFixture.started(3, 0);
        disconnect(f, "a");

        assertThat(AutoPlay.run(f.room, ENV)).isTrue();

        assertThat(f.room.game().players.get(0).folded).isTrue();
        assertThat(f.actor()).isEqualTo("b");
    }

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
