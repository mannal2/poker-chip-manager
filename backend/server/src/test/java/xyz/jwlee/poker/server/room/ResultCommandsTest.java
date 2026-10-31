package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ResultCommandsTest {

    private static String code(CommandResult r) {
        return CommandFixture.code(r);
    }

    /** Three people, dealer a, blinds 5/10, started and then aborted by the host: the result screen. */
    private static GameFixture onResult() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "ABORT", "{}"));
        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);
        return f;
    }

    @Test
    void reReadyReturnsToTheWaitingRoomWithTheStartSettingsAndTheSameRoster() {
        GameFixture f = onResult();
        long before = f.room.version();

        f.check(f.send("a", "RE_READY", "{}"));

        Room room = f.room;
        assertThat(room.phase()).isEqualTo(RoomPhase.WAITING);
        assertThat(room.version()).isEqualTo(before + 1);
        assertThat(room.game()).isNull();
        assertThat(room.playerIds()).isEmpty();
        assertThat(room.events()).isEmpty();
        assertThat(room.settlementDraft()).isNull();
        assertThat(room.settings()).isEqualTo(new RoomSettings(1000, 5, 10, -1));
        assertThat(room.hostId()).isEqualTo("a");
        assertThat(room.participants()).extracting(Participant::participantId).containsExactly("a", "b", "c");
        assertThat(room.participants()).extracting(Participant::name).containsExactly("Alice", "Bob", "Carol");
    }

    @Test
    void blindsRaisedDuringTheGameDoNotCarryIntoTheNextSettings() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "SCHEDULE_BLINDS", "{\"sb\":50,\"bb\":100}"));
        f.check(f.send("a", "ABORT", "{}"));

        f.check(f.send("a", "RE_READY", "{}"));

        assertThat(f.room.settings()).isEqualTo(new RoomSettings(1000, 5, 10, -1));
    }

    @Test
    void duringAGameReReadyIsAbortFirstAndInTheWaitingRoomInvalidAction() {
        GameFixture playing = GameFixture.started(3, 0);
        assertThat(code(playing.send("a", "RE_READY", "{}"))).isEqualTo("ABORT_FIRST");
        assertThat(playing.room.phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(playing.room.game()).isNotNull();

        GameFixture waiting = new GameFixture(3, 0);
        assertThat(code(waiting.send("a", "RE_READY", "{}"))).isEqualTo("INVALID_ACTION");
    }

    @Test
    void onlyTheHostMayReReady() {
        GameFixture f = onResult();

        assertThat(code(f.send("b", "RE_READY", "{}"))).isEqualTo("FORBIDDEN");
        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);
    }

    @Test
    void aSecondStartAfterReReadyMakesANewTournament() {
        GameFixture f = onResult();
        String first = f.room.game().tournamentId;
        f.check(f.send("a", "RE_READY", "{}"));
        f.check(f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}"));

        f.check(f.send("a", "START", "{}"));

        assertThat(f.room.phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(f.room.game().tournamentId).isNotEqualTo(first);
        assertThat(f.room.game().hand.buttonSeat).isEqualTo(1);
        assertThat(f.room.playerIds()).hasSize(3);
    }

    // 두 번째 토너먼트 뒤의 다시 준비는 첫 번째가 아니라 두 번째 시작 설정으로 돌아가는지 확인한다.
    @Test
    void reReadyAfterASecondTournamentRestoresTheSecondStartSettings() {
        GameFixture f = onResult();
        f.check(f.send("a", "RE_READY", "{}"));
        f.check(f.send("a", "SET_SETTINGS", "{\"initial\":2000,\"sb\":10,\"bb\":20}"));
        f.check(f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}"));
        f.check(f.send("a", "START", "{}"));
        f.check(f.send("a", "SCHEDULE_BLINDS", "{\"sb\":50,\"bb\":100}"));
        f.check(f.send("a", "ABORT", "{}"));

        f.check(f.send("a", "RE_READY", "{}"));

        assertThat(f.room.settings()).isEqualTo(new RoomSettings(2000, 10, 20, -1));
    }

    // 결과 화면에서는 탈락자를 포함해 명단의 누구에게나 방장을 넘길 수 있는지 확인한다.
    @Test
    void onTheResultScreenTheRoomPassesToAnyoneOnTheRoster() {
        GameFixture ended = GameFixture.started(2, 0);
        ended.check(ended.send("a", "ALL_IN", null));
        ended.check(ended.send("b", "CALL", null));
        ended.check(ended.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p0\"]}}"));
        assertThat(ended.room.phase()).isEqualTo(RoomPhase.RESULT);
        assertThat(ended.room.game().players.get(1).eliminated).isTrue();

        ended.check(ended.send("a", "TRANSFER_HOST", "{\"participantId\":\"b\"}"));

        assertThat(ended.room.hostId()).isEqualTo("b");
        ended.check(ended.send("b", "RE_READY", "{}"));

        GameFixture aborted = onResult();
        aborted.check(aborted.send("a", "TRANSFER_HOST", "{\"participantId\":\"c\"}"));
        assertThat(aborted.room.hostId()).isEqualTo("c");
        assertThat(code(aborted.send("a", "TRANSFER_HOST", "{\"participantId\":\"b\"}"))).isEqualTo("FORBIDDEN");
        assertThat(code(aborted.send("c", "TRANSFER_HOST", "{\"participantId\":\"zzz\"}"))).isEqualTo("INVALID_INPUT");
    }

    @Test
    void aForfeitedGuestStaysOnTheRosterAndPlaysAgain() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("b", "FORFEIT", "{}"));
        f.check(f.send("a", "ABORT", "{}"));

        f.check(f.send("a", "RE_READY", "{}"));

        assertThat(f.room.participants()).extracting(Participant::participantId).containsExactly("a", "b", "c");
        f.check(f.send("a", "SET_DEALER", "{\"participantId\":\"a\"}"));
        f.check(f.send("a", "START", "{}"));
        assertThat(f.room.game().players).noneMatch(p -> p.forfeited);
    }

    @Test
    void leaveOnTheResultScreenWorksAndKickDoesNot() {
        GameFixture f = onResult();

        assertThat(code(f.send("a", "KICK", "{\"participantId\":\"c\"}"))).isEqualTo("NOT_WAITING");
        f.check(f.send("c", "LEAVE", "{}"));
        assertThat(f.room.participants()).extracting(Participant::participantId).containsExactly("a", "b");
        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);

        f.check(f.send("b", "LEAVE", "{}"));
        f.check(f.send("a", "RE_READY", "{}"));
        assertThat(f.room.participants()).extracting(Participant::participantId).containsExactly("a");
    }

    @Test
    void hostLeavingOnTheResultScreenPassesTheRoomAndClearsTheDraft() {
        GameFixture f = onResult();

        f.check(f.send("a", "LEAVE", "{}"));

        assertThat(f.room.hostId()).isEqualTo("b");
        assertThat(f.room.settlementDraft()).isNull();
        f.check(f.send("b", "RE_READY", "{}"));
        assertThat(f.room.phase()).isEqualTo(RoomPhase.WAITING);
    }

    @Test
    void theLastPersonLeavingTheResultScreenClosesTheRoom() {
        GameFixture f = GameFixture.started(2, 0);
        f.check(f.send("a", "ABORT", "{}"));
        f.check(f.send("b", "LEAVE", "{}"));

        f.check(f.send("a", "LEAVE", "{}"));

        assertThat(f.room.isClosed()).isTrue();
    }

    @Test
    void rosterChangesOnTheResultScreenShapeTheNextStartNames() {
        GameFixture f = onResult();
        f.check(f.send("c", "LEAVE", "{}"));
        f.check(f.send("a", "RE_READY", "{}"));
        f.check(f.send("a", "SET_DEALER", "{\"participantId\":\"a\"}"));

        f.check(f.send("a", "START", "{}"));

        assertThat(f.room.game().players).extracting(p -> p.name).containsExactly("Alice", "Bob");
    }
}
