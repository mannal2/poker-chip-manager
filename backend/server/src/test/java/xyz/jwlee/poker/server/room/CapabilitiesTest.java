package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Who can do what, per role: host or guest, on turn or not, in each phase. With dealer b the actor is b and host a is the big blind. */
class CapabilitiesTest {

    private static Capabilities caps(GameFixture f, String who) {
        return Capabilities.of(f.room, who);
    }

    private static Capabilities none() {
        return new Capabilities(false, false, false, false, false);
    }

    @Test
    void theWaitingRoomLetsOnlyTheHostEditTheSetup() {
        GameFixture f = new GameFixture(3, 1);

        assertThat(caps(f, "a")).isEqualTo(new Capabilities(false, false, false, true, false));
        assertThat(caps(f, "b")).isEqualTo(none());
    }

    @Test
    void duringPlayTheHostWhoIsNotActingMayEditBlindsOnly() {
        GameFixture f = GameFixture.started(3, 1);

        assertThat(f.actor()).isEqualTo("b");
        assertThat(caps(f, "a")).isEqualTo(new Capabilities(false, false, false, false, true));
    }

    @Test
    void theActingGuestMayActOnly() {
        GameFixture f = GameFixture.started(3, 1);

        assertThat(caps(f, "b")).isEqualTo(new Capabilities(true, false, false, false, false));
        assertThat(caps(f, "c")).isEqualTo(none());
    }

    @Test
    void theActingHostMayActAndEditBlinds() {
        GameFixture f = GameFixture.started(3, 0);

        assertThat(caps(f, "a")).isEqualTo(new Capabilities(true, false, false, false, true));
    }

    @Test
    void undoIsOfferedToTheHostOnceThereIsSomethingToUndo() {
        GameFixture f = GameFixture.started(3, 1);
        f.check(f.send("b", "CALL", null));

        assertThat(caps(f, "a").canUndo()).isTrue();
        assertThat(caps(f, "b").canUndo()).isFalse();
        assertThat(caps(f, "c").canUndo()).isFalse();
    }

    @Test
    void settlingIsOfferedToTheHostOnly() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));
        f.check(f.send("c", "CHECK", null));
        f.checkDown();

        assertThat(caps(f, "a")).isEqualTo(new Capabilities(false, true, true, false, true));
        assertThat(caps(f, "b")).isEqualTo(none());
        assertThat(caps(f, "c")).isEqualTo(none());
    }

    @Test
    void theResultScreenOnlyOffersUndoToTheHost() {
        GameFixture f = GameFixture.started(2, 0);
        f.check(f.send("a", "ALL_IN", null));
        f.check(f.send("b", "CALL", null));
        f.check(f.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}"));

        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);
        assertThat(caps(f, "a")).isEqualTo(new Capabilities(false, true, false, false, false));
        assertThat(caps(f, "b")).isEqualTo(none());
    }

    @Test
    void theSnapshotCarriesLegalActionsForTheActorOnly() {
        GameFixture f = GameFixture.started(3, 1);
        Participant actor = f.room.participant("b").orElseThrow();
        Participant other = f.room.participant("c").orElseThrow();

        var forActor = SnapshotWriter.snapshot(f.room, actor).json();
        var forOther = SnapshotWriter.snapshot(f.room, other).json();

        assertThat(forActor.get("legal").isObject()).isTrue();
        assertThat(forActor.get("legal").get("callAdditional").asInt()).isEqualTo(10);
        assertThat(forActor.get("you").get("capabilities").get("canAct").asBoolean()).isTrue();
        assertThat(forOther.get("legal").isNull()).isTrue();
        assertThat(forOther.get("tournamentId").asString()).isEqualTo(f.room.game().tournamentId);
    }
}
