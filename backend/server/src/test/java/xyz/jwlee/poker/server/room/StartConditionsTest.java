package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class StartConditionsTest {

    @Test
    void aRoomOfOneNeedsMorePlayers() {
        assertThat(StartConditions.blockReason(new CommandFixture(1).room)).contains("PLAYER_COUNT");
    }

    @Test
    void aRoomWithoutADealerIsBlocked() {
        assertThat(StartConditions.blockReason(new CommandFixture(2).room)).contains("NO_DEALER");
    }

    @Test
    void aRoomWithTwoPlayersAndADealerCanStart() {
        CommandFixture f = new CommandFixture(2);
        f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}");

        assertThat(StartConditions.blockReason(f.room)).isEmpty();
    }

    @Test
    void tenPlayersAreStillWithinTheLimit() {
        CommandFixture f = new CommandFixture(2);
        for (int i = 0; i < 8; i++) {
            f.room.addParticipant("p" + i, "P" + i);
        }
        f.send("a", "SET_DEALER", "{\"participantId\":\"p0\"}");

        assertThat(f.room.participants()).hasSize(10);
        assertThat(StartConditions.blockReason(f.room)).isEmpty();
    }

    @Test
    void invalidSettingsBlockTheStart() {
        CommandFixture f = new CommandFixture(2);
        f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}");
        f.room.replaceSettings(new RoomSettings(1000, 30, 20, f.room.settings().button()));

        assertThat(StartConditions.blockReason(f.room)).contains("INVALID_SETTINGS");
    }

    @Test
    void aRoomThatIsNotWaitingIsBlocked() {
        CommandFixture f = new CommandFixture(2);
        f.room.setPhase(RoomPhase.PLAYING);

        assertThat(StartConditions.blockReason(f.room)).contains("NOT_WAITING");
    }
}
