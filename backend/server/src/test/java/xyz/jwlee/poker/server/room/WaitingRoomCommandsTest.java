package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class WaitingRoomCommandsTest {

    private final CommandFixture f = new CommandFixture(3);

    private void ok(String who, String type, String payload) {
        CommandResult r = f.send(who, type, payload);
        assertThat(CommandFixture.code(r)).as(type).isEqualTo("OK");
    }

    private void rejected(String code, String who, String type, String payload) {
        long before = f.room.version();
        CommandResult r = f.send(who, type, payload);
        assertThat(CommandFixture.code(r)).isEqualTo(code);
        assertThat(r.outcome().outcome()).isEqualTo(RequestOutcome.Outcome.REJECTED);
        assertThat(f.room.version()).isEqualTo(before);
    }

    @Test
    void settingsAreSavedForTheHost() {
        ok("a", "SET_SETTINGS", "{\"initial\":2000,\"sb\":25,\"bb\":50}");

        assertThat(f.room.settings().initial()).isEqualTo(2000);
        assertThat(f.room.settings().sb()).isEqualTo(25);
        assertThat(f.room.settings().bb()).isEqualTo(50);
    }

    @Test
    void settingsWorkInARoomOfOne() {
        CommandFixture solo = new CommandFixture(1);

        assertThat(CommandFixture.code(solo.send("a", "SET_SETTINGS", "{\"initial\":500,\"sb\":5,\"bb\":10}")))
                .isEqualTo("OK");
    }

    @Test
    void badSettingsAreInvalidInput() {
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "{\"initial\":1000,\"sb\":20,\"bb\":10}");
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "{\"initial\":1000,\"sb\":7,\"bb\":20}");
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "{\"initial\":10,\"sb\":5,\"bb\":20}");
    }

    @Test
    void settingsFieldsMustBeIntegers() {
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "{\"initial\":\"1000\",\"sb\":10,\"bb\":20}");
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "{\"initial\":1000.0,\"sb\":10,\"bb\":20}");
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "{\"initial\":1000,\"sb\":10}");
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", null);
        rejected("INVALID_INPUT", "a", "SET_SETTINGS", "[]");
    }

    @Test
    void aGuestCannotChangeSettings() {
        rejected("FORBIDDEN", "b", "SET_SETTINGS", "{\"initial\":2000,\"sb\":25,\"bb\":50}");
    }

    @Test
    void seatOrderMovesParticipantsAndTheDealerFollowsTheirPerson() {
        ok("a", "SET_DEALER", "{\"participantId\":\"b\"}");
        assertThat(f.room.settings().button()).isEqualTo(1);

        ok("a", "SET_SEAT_ORDER", "{\"participantIds\":[\"c\",\"a\",\"b\"]}");

        assertThat(f.names()).isEqualTo("Carol,Alice,Bob,");
        assertThat(f.room.settings().button()).isEqualTo(2);
    }

    @Test
    void aWrongSeatListIsInvalidInput() {
        rejected("INVALID_INPUT", "a", "SET_SEAT_ORDER", "{\"participantIds\":[\"a\",\"b\"]}");
        rejected("INVALID_INPUT", "a", "SET_SEAT_ORDER", "{\"participantIds\":[\"a\",\"b\",\"b\"]}");
        rejected("INVALID_INPUT", "a", "SET_SEAT_ORDER", "{\"participantIds\":[\"a\",\"b\",\"zzz\"]}");
        rejected("INVALID_INPUT", "a", "SET_SEAT_ORDER", "{\"participantIds\":[\"a\",\"b\",3]}");
        rejected("INVALID_INPUT", "a", "SET_SEAT_ORDER", "{\"participantIds\":\"abc\"}");
        rejected("FORBIDDEN", "c", "SET_SEAT_ORDER", "{\"participantIds\":[\"c\",\"a\",\"b\"]}");
    }

    @Test
    void theDealerIsStoredAsASeatIndex() {
        ok("a", "SET_DEALER", "{\"participantId\":\"c\"}");

        assertThat(f.room.settings().button()).isEqualTo(2);
        rejected("INVALID_INPUT", "a", "SET_DEALER", "{\"participantId\":\"zzz\"}");
        rejected("INVALID_INPUT", "a", "SET_DEALER", "{\"participantId\":5}");
        rejected("FORBIDDEN", "b", "SET_DEALER", "{\"participantId\":\"b\"}");
    }

    @Test
    void renameNormalizesAndChecksDuplicatesIgnoringCase() {
        ok("b", "RENAME", "{\"name\":\"  Bobby  \"}");
        assertThat(f.room.participant("b").orElseThrow().name()).isEqualTo("Bobby");

        rejected("DUPLICATE_NAME", "b", "RENAME", "{\"name\":\"CAROL\"}");
        rejected("INVALID_NAME", "b", "RENAME", "{\"name\":\"bad_name!\"}");
        rejected("INVALID_NAME", "b", "RENAME", "{\"name\":\"\"}");
        rejected("INVALID_INPUT", "b", "RENAME", "{\"name\":42}");
        ok("b", "RENAME", "{\"name\":\"BOBBY\"}");
        assertThat(f.room.participant("b").orElseThrow().name()).isEqualTo("BOBBY");
    }

    @Test
    void kickRemovesAGuestAndOnlyTheHostMayDoIt() {
        rejected("FORBIDDEN", "b", "KICK", "{\"participantId\":\"c\"}");
        rejected("INVALID_INPUT", "a", "KICK", "{\"participantId\":\"a\"}");
        rejected("INVALID_INPUT", "a", "KICK", "{\"participantId\":\"zzz\"}");

        ok("a", "KICK", "{\"participantId\":\"b\"}");

        assertThat(f.names()).isEqualTo("Alice,Carol,");
    }

    @Test
    void aKickedPersonIsNotFoundAfterwards() {
        ok("a", "KICK", "{\"participantId\":\"b\"}");

        assertThatThrownBy(() -> f.send("b", "LEAVE", "{}"))
                .isInstanceOfSatisfying(RoomException.class, e -> assertThat(e.code()).isEqualTo("ROOM_NOT_FOUND"));
    }

    @Test
    void theDealerBecomesUnsetWhenThatPersonIsKickedOrLeaves() {
        ok("a", "SET_DEALER", "{\"participantId\":\"b\"}");
        ok("a", "KICK", "{\"participantId\":\"b\"}");
        assertThat(f.room.settings().button()).isEqualTo(-1);

        ok("a", "SET_DEALER", "{\"participantId\":\"c\"}");
        assertThat(f.room.settings().button()).isEqualTo(1);
        ok("c", "LEAVE", "{}");
        assertThat(f.room.settings().button()).isEqualTo(-1);
    }

    @Test
    void theDealerKeepsTheirPersonWhenAnEarlierSeatLeaves() {
        ok("a", "SET_DEALER", "{\"participantId\":\"c\"}");
        ok("b", "LEAVE", "{}");

        assertThat(f.room.settings().button()).isEqualTo(1);
        assertThat(f.room.participants().get(1).participantId()).isEqualTo("c");
    }

    @Test
    void whenTheHostLeavesTheEarliestJoinerBecomesHost() {
        ok("a", "SET_SEAT_ORDER", "{\"participantIds\":[\"c\",\"b\",\"a\"]}");

        ok("a", "LEAVE", "{}");

        // Seat order changed but join order did not: b joined before c.
        assertThat(f.room.hostId()).isEqualTo("b");
        assertThat(f.room.isClosed()).isFalse();
    }

    @Test
    void joinOrderStaysUniqueAfterSomeoneLeaves() {
        ok("b", "LEAVE", "{}");
        f.room.addParticipant("e", "Eve");
        f.room.addParticipant("f", "Fay");

        assertThat(f.room.participants().stream().map(Participant::joinOrder).distinct().count())
                .isEqualTo(f.room.participants().size());
    }

    @Test
    void theLastPersonLeavingClosesTheRoom() {
        ok("b", "LEAVE", "{}");
        ok("c", "LEAVE", "{}");
        assertThat(f.room.isClosed()).isFalse();

        ok("a", "LEAVE", "{}");

        assertThat(f.room.isClosed()).isTrue();
    }

    @Test
    void leaveTakesNoPayloadFields() {
        rejected("INVALID_INPUT", "b", "LEAVE", "{\"x\":1}");
        ok("b", "LEAVE", null);
    }

    @Test
    void hostCanBeTransferredToAnyParticipantOnlyByTheHost() {
        rejected("FORBIDDEN", "b", "TRANSFER_HOST", "{\"participantId\":\"b\"}");
        rejected("INVALID_INPUT", "a", "TRANSFER_HOST", "{\"participantId\":\"zzz\"}");

        ok("a", "TRANSFER_HOST", "{\"participantId\":\"c\"}");

        assertThat(f.room.hostId()).isEqualTo("c");
        rejected("FORBIDDEN", "a", "SET_DEALER", "{\"participantId\":\"a\"}");
    }

    @Test
    void waitingRoomCommandsAreRefusedOnceTheGameIsOver() {
        f.room.setPhase(RoomPhase.RESULT);

        rejected("NOT_WAITING", "a", "SET_SETTINGS", "{\"initial\":2000,\"sb\":25,\"bb\":50}");
        rejected("NOT_WAITING", "a", "KICK", "{\"participantId\":\"b\"}");
        rejected("NOT_WAITING", "a", "RENAME", "{\"name\":\"Zed\"}");
        ok("b", "LEAVE", "{}");
    }

    @Test
    void leaveIsRefusedWhilePlaying() {
        f.room.setPhase(RoomPhase.PLAYING);

        rejected("NOT_WAITING", "b", "LEAVE", "{}");
    }
}
