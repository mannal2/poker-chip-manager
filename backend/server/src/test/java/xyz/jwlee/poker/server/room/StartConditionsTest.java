package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class StartConditionsTest {

    @Test
    void aRoomOfOneNeedsMorePlayers() {
        assertThat(StartConditions.blockReason(new CommandFixture(1).room, new StartGate())).contains("PLAYER_COUNT");
    }

    @Test
    void aRoomWithoutADealerIsBlocked() {
        assertThat(StartConditions.blockReason(new CommandFixture(2).room, new StartGate())).contains("NO_DEALER");
    }

    @Test
    void aRoomWithTwoPlayersAndADealerCanStart() {
        CommandFixture f = new CommandFixture(2);
        f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}");

        assertThat(StartConditions.blockReason(f.room, new StartGate())).isEmpty();
    }

    @Test
    void tenPlayersAreStillWithinTheLimit() {
        CommandFixture f = new CommandFixture(2);
        for (int i = 0; i < 8; i++) {
            f.room.addParticipant("p" + i, "P" + i, "cred", Instant.EPOCH);
            f.room.presence().attach("p" + i, "conn-p" + i, Instant.EPOCH);
        }
        f.send("a", "SET_DEALER", "{\"participantId\":\"p0\"}");

        assertThat(f.room.participants()).hasSize(10);
        assertThat(StartConditions.blockReason(f.room, new StartGate())).isEmpty();
    }

    @Test
    void invalidSettingsBlockTheStart() {
        CommandFixture f = new CommandFixture(2);
        f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}");
        f.room.replaceSettings(new RoomSettings(1000, 30, 20, f.room.settings().button()));

        assertThat(StartConditions.blockReason(f.room, new StartGate())).contains("INVALID_SETTINGS");
    }

    @Test
    void aRoomThatIsNotWaitingIsBlocked() {
        CommandFixture f = new CommandFixture(2);
        f.room.setPhase(RoomPhase.PLAYING);

        assertThat(StartConditions.blockReason(f.room, new StartGate())).contains("NOT_WAITING");
    }

    // 끊긴 참가자가 있으면 시작할 수 없다.
    @Test
    void aDisconnectedParticipantBlocksTheStart() {
        CommandFixture f = new CommandFixture(2);
        f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}");
        f.room.presence().detach("conn-b", Instant.EPOCH);

        assertThat(StartConditions.blockReason(f.room, new StartGate())).contains("NOT_CONNECTED");
    }

    // 한 번도 접속하지 않은 참가자도 시작을 막는다.
    @Test
    void aParticipantWhoNeverConnectedBlocksTheStart() {
        CommandFixture f = new CommandFixture(2);
        f.send("a", "SET_DEALER", "{\"participantId\":\"b\"}");
        f.room.addParticipant("c", "Carol", "cred", Instant.EPOCH);

        assertThat(StartConditions.blockReason(f.room, new StartGate())).contains("NOT_CONNECTED");
    }
}
