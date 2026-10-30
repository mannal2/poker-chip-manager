package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class CommandPipelineTest {

    private static final String DEALER_A = "{\"participantId\":\"a\"}";
    private static final String DEALER_B = "{\"participantId\":\"b\"}";

    private final CommandFixture f = new CommandFixture(2);

    private static void rejectedWith(RoomException e, String code) {
        assertThat(e.code()).isEqualTo(code);
    }

    @Test
    void permissionIsCheckedBeforeTheStateVersion() {
        long stale = f.room.version() + 5;

        CommandResult r = f.send("b", "SET_DEALER", DEALER_A, stale);

        assertThat(CommandFixture.code(r)).isEqualTo("FORBIDDEN");
        assertThat(r.outcome().outcome()).isEqualTo(RequestOutcome.Outcome.REJECTED);
    }

    @Test
    void theScopeIsCheckedBeforeTheStateVersion() {
        CommandRequest r = new CommandRequest(1, "someone-elses", "r1", 1, 1, f.room.version() + 9, null,
                "SET_DEALER", CommandFixture.json(DEALER_A));

        assertThat(f.pipeline.execute(f.room, "a", r).outcome().code()).isEqualTo("TOURNAMENT_CHANGED");
    }

    @Test
    void aStaleVersionIsRejectedAndUsesUpTheSequence() {
        CommandResult stale = f.send("a", "SET_DEALER", DEALER_A, f.room.version() - 1);
        CommandResult next = f.send("a", "SET_DEALER", DEALER_B);

        assertThat(CommandFixture.code(stale)).isEqualTo("STALE_STATE");
        assertThat(stale.outcome().sequence()).isEqualTo(1);
        assertThat(CommandFixture.code(next)).isEqualTo("OK");
        assertThat(next.outcome().sequence()).isEqualTo(2);
    }

    @Test
    void aRetryReturnsTheStoredOutcomeEvenAfterPermissionChanged() {
        CommandRequest first = CommandFixture.request("r1", 1, 1, f.room.version(), "SET_DEALER", DEALER_A);
        CommandResult applied = f.pipeline.execute(f.room, "a", first);
        f.room.setHost("b");
        long version = f.room.version();

        CommandResult again = f.pipeline.execute(f.room, "a", first);

        assertThat(again.outcome()).isEqualTo(applied.outcome());
        assertThat(f.room.version()).isEqualTo(version);
    }

    @Test
    void sameSequenceWithAnotherPayloadIsARequestConflict() {
        f.pipeline.execute(f.room, "a", CommandFixture.request("r1", 1, 1, f.room.version(), "SET_DEALER", DEALER_A));

        assertThatThrownBy(() -> f.pipeline.execute(f.room, "a",
                CommandFixture.request("r1", 1, 1, f.room.version(), "SET_DEALER", DEALER_B)))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "REQUEST_CONFLICT"));
    }

    @Test
    void aSkippedSequenceIsAGap() {
        assertThatThrownBy(() -> f.pipeline.execute(f.room, "a",
                CommandFixture.request("r1", 2, 1, f.room.version(), "SET_DEALER", DEALER_A)))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "SEQUENCE_GAP"));
    }

    @Test
    void anOldSequenceWhoseResultIsGoneIsExpired() {
        for (int i = 0; i < 70; i++) {
            f.send("a", "SET_DEALER", DEALER_A);
        }
        assertThatThrownBy(() -> f.pipeline.execute(f.room, "a",
                CommandFixture.request("old", 1, 1, f.room.version(), "SET_DEALER", DEALER_A)))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "RESULT_EXPIRED"));
    }

    @Test
    void aDifferentControlGenerationIsControlLostAndKeepsTheSequence() {
        CommandRequest wrong = CommandFixture.request("r1", 1, 7, f.room.version(), "SET_DEALER", DEALER_A);

        assertThatThrownBy(() -> f.pipeline.execute(f.room, "a", wrong))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "CONTROL_LOST"));
        // The sequence was not consumed: the real holder starts at number 1.
        assertThat(CommandFixture.code(f.send("a", "SET_DEALER", DEALER_A))).isEqualTo("OK");
    }

    @Test
    void aRetryOfAnAnsweredRequestReplaysEvenWithAnotherGeneration() {
        CommandRequest first = CommandFixture.request("r1", 1, 1, f.room.version(), "SET_DEALER", DEALER_A);
        CommandResult applied = f.pipeline.execute(f.room, "a", first);
        CommandRequest again = CommandFixture.request("r1", 1, 2, first.expectedStateVersion(), "SET_DEALER",
                DEALER_A);

        // Generation is not part of the fingerprint; the duplicate check answers before the generation check.
        assertThat(f.pipeline.execute(f.room, "a", again).outcome()).isEqualTo(applied.outcome());
    }

    @Test
    void aRetryOfAnAnsweredRequestReplaysEvenAfterTheVersionMoved() {
        CommandRequest first = CommandFixture.request("r1", 1, 1, f.room.version(), "SET_DEALER", DEALER_A);
        CommandResult applied = f.pipeline.execute(f.room, "a", first);
        f.pipeline.execute(f.room, "a",
                CommandFixture.request("r2", 2, 1, f.room.version(), "SET_DEALER", DEALER_B));
        assertThat(f.room.version()).isGreaterThan(first.expectedStateVersion() + 1);

        assertThat(f.pipeline.execute(f.room, "a", first).outcome()).isEqualTo(applied.outcome());
    }

    @Test
    void controlGenerationIsCheckedBeforePermission() {
        CommandRequest wrong = CommandFixture.request("r1", 1, 5, f.room.version(), "SET_DEALER", DEALER_A);

        assertThatThrownBy(() -> f.pipeline.execute(f.room, "b", wrong))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "CONTROL_LOST"));
    }

    @Test
    void aNonParticipantIsNotFoundBeforeAnythingElse() {
        assertThatThrownBy(() -> f.pipeline.execute(f.room, "ghost",
                CommandFixture.request("r1", 99, 9, 99, "SET_DEALER", "{}")))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "ROOM_NOT_FOUND"));
    }

    @Test
    void anUnknownTypeIsRefusedWithoutUsingTheSequence() {
        assertThatThrownBy(() -> f.send("a", "NOPE", "{}"))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "UNKNOWN_TYPE"));
        assertThatThrownBy(() -> f.send("a", "START", "{}"))
                .isInstanceOfSatisfying(RoomException.class, e -> rejectedWith(e, "UNKNOWN_TYPE"));
        assertThat(CommandFixture.code(f.pipeline.execute(f.room, "a",
                CommandFixture.request("r1", 1, 1, f.room.version(), "SET_DEALER", DEALER_A)))).isEqualTo("OK");
    }

    @Test
    void aHandIdInTheWaitingRoomIsAScopeMismatch() {
        CommandRequest r = new CommandRequest(1, null, "r1", 1, 1, f.room.version(), "hand-9", "SET_DEALER",
                CommandFixture.json(DEALER_A));

        assertThat(f.pipeline.execute(f.room, "a", r).outcome().code()).isEqualTo("TOURNAMENT_CHANGED");
    }

    @Test
    void everySuccessBumpsTheVersionOnceAndARejectionDoesNot() {
        long v = f.room.version();
        CommandResult ok = f.send("a", "SET_DEALER", DEALER_A);
        assertThat(f.room.version()).isEqualTo(v + 1);
        assertThat(ok.outcome().resultStateVersion()).isEqualTo(v + 1);

        CommandResult bad = f.send("a", "SET_DEALER", "{\"participantId\":\"zzz\"}");
        assertThat(CommandFixture.code(bad)).isEqualTo("INVALID_INPUT");
        assertThat(f.room.version()).isEqualTo(v + 1);
        assertThat(bad.outcome().resultStateVersion()).isEqualTo(v + 1);
    }

    @Test
    void theFingerprintIgnoresKeyOrderButNotValues() {
        CommandRequest one = CommandFixture.request("r", 1, 1, 3, "SET_SETTINGS",
                "{\"initial\":1000,\"sb\":10,\"bb\":20}");
        CommandRequest swapped = CommandFixture.request("r", 1, 1, 3, "SET_SETTINGS",
                "{\"bb\":20,\"sb\":10,\"initial\":1000}");
        CommandRequest other = CommandFixture.request("r", 1, 1, 3, "SET_SETTINGS",
                "{\"initial\":1000,\"sb\":10,\"bb\":25}");

        assertThat(Fingerprint.of(one)).isEqualTo(Fingerprint.of(swapped)).isNotEqualTo(Fingerprint.of(other));
    }

    @Test
    void aNewControlGenerationStartsAFreshLedger() {
        assertThat(f.room.ledger("a", 1)).isNotSameAs(f.room.ledger("a", 2));
        assertThat(f.room.ledger("a", 1)).isSameAs(f.room.ledger("a", 1));
    }
}
