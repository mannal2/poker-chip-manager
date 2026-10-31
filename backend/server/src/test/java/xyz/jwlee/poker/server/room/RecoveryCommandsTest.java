package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static xyz.jwlee.poker.server.room.CommandFixture.code;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.server.room.RecoveryRequests.Status;
import xyz.jwlee.poker.server.support.IdGenerator;

// 복구 신청·승인·거절·만료 규칙을 방 수준에서 검사한다
class RecoveryCommandsTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
    private final RoomEnv env = new RoomEnv(clock, IdGenerator.random());
    private final CommandFixture f = new CommandFixture(3, clock);
    private final Room room = f.room;

    // 세션 없는 새 기기가 이름으로 복구를 신청한다
    private RecoveryRequests.Request ask(Room in, String name) {
        return RecoveryCommands.request(in, Optional.empty(), name, env);
    }

    // 복구 명령의 payload를 만든다
    private static String payload(String recoveryRequestId) {
        return "{\"recoveryRequestId\":\"" + recoveryRequestId + "\"}";
    }

    // 방장 a가 신청을 승인한다
    private CommandResult approve(RecoveryRequests.Request request) {
        return f.send("a", "RECOVERY_APPROVE", payload(request.id()));
    }

    // 신청의 현재 저장 상태를 읽는다
    private Status statusOf(Room in, RecoveryRequests.Request request) {
        return in.recoveryRequests().find(request.id()).orElseThrow().status();
    }

    // 참가자에게 보이는 복구 신청 목록을 읽는다
    private static JsonNode listFor(Room in, String who) {
        return SnapshotWriter.snapshot(in, in.participant(who).orElseThrow()).json().get("recoveryRequests");
    }

    @Test
    void seatOfChecksTheRosterAndTheCredentialTogether() {
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.seatOf(new SeatBinding("b", "wrong"))).isEmpty();
        assertThat(room.seatOf(new SeatBinding("gone", CommandFixture.credential("b")))).isEmpty();
    }

    @Test
    void approvingLeavesOnlyTheNewBindingAndMovesTheGenerationByOne() {
        SeatBinding old = CommandFixture.binding("b");
        RecoveryRequests.Request request = ask(room, "Bob");
        long before = room.participant("b").orElseThrow().controlGeneration();

        assertThat(code(approve(request))).isEqualTo("OK");

        RecoveryRequests.Request approved = room.recoveryRequests().find(request.id()).orElseThrow();
        assertThat(approved.status()).isEqualTo(Status.APPROVED);
        assertThat(room.seatOf(old)).isEmpty();
        assertThat(room.seatOf(new SeatBinding("b", approved.credential()))).isPresent();
        assertThat(room.participant("b").orElseThrow().controlGeneration()).isEqualTo(before + 1);
    }

    @Test
    void approvingBumpsTheVersionAndClosesTheOldConnections() {
        RecoveryRequests.Request request = ask(room, "Bob");
        PublicationBuilder.collect(room);
        long version = room.version();

        approve(request);

        assertThat(room.version()).isGreaterThan(version);
        Publication publication = PublicationBuilder.collect(room);
        assertThat(publication.revokedConnections()).containsExactly("conn-b");
        assertThat(publication.deliveries()).extracting(Publication.Delivery::connectionId)
                .containsExactlyInAnyOrder("conn-a", "conn-c");
    }

    @Test
    void theApprovalTimeBecomesTheAbsenceAndAWaitingRoomWaitsThirtySecondsForTheNewDevice() {
        RecoveryRequests.Request request = ask(room, "Bob");
        clock.advance(Duration.ofSeconds(10));
        approve(request);

        assertThat(room.presence().isConnected("b")).isFalse();
        assertThat(room.presence().absentSince("b")).contains(clock.instant());
        clock.advance(Duration.ofMillis(29_900));
        RoomLifecycle.sweep(room, env);
        assertThat(room.participant("b")).isPresent();

        clock.advance(Duration.ofMillis(100));
        RoomLifecycle.sweep(room, env);
        assertThat(room.participant("b")).isEmpty();
    }

    @Test
    void aRecoveredSeatStaysHostAndKeepsItsChips() {
        GameFixture game = GameFixture.started(3, 1, clock);
        List<Integer> stacks = game.room.game().players.stream().map(p -> p.stack).toList();
        RecoveryRequests.Request request = ask(game.room, "Alice");

        game.check(game.sendWithoutHand("a", "RECOVERY_APPROVE", payload(request.id())));

        assertThat(game.room.hostId()).isEqualTo("a");
        assertThat(game.room.game().players.stream().map(p -> p.stack).toList()).isEqualTo(stacks);
    }

    @Test
    void anEliminatedSeatCanBeRecoveredAndStaysEliminated() {
        GameFixture game = GameFixture.started(3, 1, clock);
        String playerId = game.room.playerIds().get("c");
        GameState state = game.room.game();
        Player seat = state.players.stream().filter(p -> p.id.equals(playerId)).findFirst().orElseThrow();
        seat.eliminated = true;
        RecoveryRequests.Request request = ask(game.room, "Carol");

        game.check(game.sendWithoutHand("a", "RECOVERY_APPROVE", payload(request.id())));

        assertThat(game.room.game().players.stream().filter(p -> p.id.equals(playerId)).findFirst().orElseThrow()
                .eliminated).isTrue();
        assertThat(statusOf(game.room, request)).isEqualTo(Status.APPROVED);
    }

    @Test
    void aSeatTakesThreePendingRequestsAndRefusesTheFourth() {
        ask(room, "Bob");
        ask(room, "Bob");
        ask(room, "Bob");

        assertThatThrownBy(() -> ask(room, "Bob")).isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("RECOVERY_LIMIT");
        ask(room, "Carol");
    }

    @Test
    void anEndedRequestNoLongerCountsAgainstTheLimit() {
        RecoveryRequests.Request first = ask(room, "Bob");
        ask(room, "Bob");
        ask(room, "Bob");

        f.send("a", "RECOVERY_REJECT", payload(first.id()));

        ask(room, "Bob");
    }

    @Test
    void oneApprovalSupersedesTheOtherRequestsOfThatSeatOnly() {
        RecoveryRequests.Request first = ask(room, "Bob");
        RecoveryRequests.Request second = ask(room, "Bob");
        RecoveryRequests.Request third = ask(room, "Bob");
        RecoveryRequests.Request carol = ask(room, "Carol");

        approve(second);

        assertThat(statusOf(room, first)).isEqualTo(Status.SUPERSEDED);
        assertThat(statusOf(room, third)).isEqualTo(Status.SUPERSEDED);
        assertThat(statusOf(room, carol)).isEqualTo(Status.PENDING);
        assertThat(code(approve(first))).isEqualTo("RECOVERY_NOT_PENDING");
        assertThat(code(approve(second))).isEqualTo("RECOVERY_NOT_PENDING");
    }

    @Test
    void aRejectedRequestCannotBeApprovedAndChangesNoSeat() {
        RecoveryRequests.Request request = ask(room, "Bob");
        long version = room.version();

        assertThat(code(f.send("a", "RECOVERY_REJECT", payload(request.id())))).isEqualTo("OK");

        assertThat(statusOf(room, request)).isEqualTo(Status.REJECTED);
        assertThat(room.version()).isGreaterThan(version);
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.presence().isConnected("b")).isTrue();
        assertThat(code(approve(request))).isEqualTo("RECOVERY_NOT_PENDING");
    }

    @Test
    void anUnknownRequestIsNotPendingAndAMissingFieldIsInvalid() {
        assertThat(code(f.send("a", "RECOVERY_APPROVE", payload("nope")))).isEqualTo("RECOVERY_NOT_PENDING");
        assertThat(code(f.send("a", "RECOVERY_APPROVE", "{}"))).isEqualTo("INVALID_INPUT");
    }

    @Test
    void afterFiveMinutesARequestIsExpiredByTheSweepWithAVersionBump() {
        RecoveryRequests.Request request = ask(room, "Bob");
        long version = room.version();

        clock.advance(Duration.ofMinutes(5).minusMillis(1));
        RoomLifecycle.sweep(room, env);
        assertThat(statusOf(room, request)).isEqualTo(Status.PENDING);

        clock.advance(Duration.ofMillis(1));
        RoomLifecycle.sweep(room, env);
        assertThat(statusOf(room, request)).isEqualTo(Status.EXPIRED);
        assertThat(room.version()).isEqualTo(version + 1);
        assertThat(code(approve(request))).isEqualTo("RECOVERY_NOT_PENDING");
    }

    @Test
    void aRequestPastItsTimeCannotBeApprovedBeforeTheSweepSeesIt() {
        RecoveryRequests.Request request = ask(room, "Bob");

        clock.advance(Duration.ofMinutes(5));

        assertThat(code(approve(request))).isEqualTo("RECOVERY_NOT_PENDING");
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.recoveryRequests().find(request.id()).orElseThrow().statusAt(clock.instant()))
                .isEqualTo(Status.EXPIRED);
    }

    @Test
    void anEndedRequestIsDeletedFiveMinutesLaterWithoutABump() {
        RecoveryRequests.Request request = ask(room, "Bob");
        approve(request);
        long version = room.version();
        clock.advance(Duration.ofSeconds(1));
        room.presence().attach("b", "fresh-b", clock.instant());

        clock.advance(Duration.ofMinutes(5).minusSeconds(1).minusMillis(1));
        RoomLifecycle.sweep(room, env);
        assertThat(room.recoveryRequests().find(request.id())).isPresent();

        clock.advance(Duration.ofMillis(1));
        RoomLifecycle.sweep(room, env);
        assertThat(room.recoveryRequests().find(request.id())).isEmpty();
        assertThat(room.version()).isEqualTo(version);
    }

    @Test
    void theSweepExpiresRequestsWhileAGameRuns() {
        GameFixture game = GameFixture.started(3, 1, clock);
        RecoveryRequests.Request request = ask(game.room, "Bob");

        clock.advance(Duration.ofMinutes(5));
        RoomLifecycle.sweep(game.room, env);

        assertThat(statusOf(game.room, request)).isEqualTo(Status.EXPIRED);
    }

    @Test
    void onlyTheHostMayDecide() {
        RecoveryRequests.Request request = ask(room, "Carol");

        assertThat(code(f.send("b", "RECOVERY_APPROVE", payload(request.id())))).isEqualTo("FORBIDDEN");
        assertThat(code(f.send("b", "RECOVERY_REJECT", payload(request.id())))).isEqualTo("FORBIDDEN");
        assertThat(code(f.send("c", "RECOVERY_APPROVE", payload(request.id())))).isEqualTo("FORBIDDEN");

        assertThat(statusOf(room, request)).isEqualTo(Status.PENDING);
        assertThat(room.seatOf(CommandFixture.binding("c"))).isPresent();
    }

    @Test
    void onlyTheHostsSnapshotListsRequestsAndItCarriesNoSessionOrCredential() {
        RecoveryRequests.Request request = ask(room, "Bob");
        clock.advance(Duration.ofSeconds(1));

        JsonNode list = listFor(room, "a");

        assertThat(listFor(room, "b")).isEmpty();
        assertThat(listFor(room, "c")).isEmpty();
        assertThat(list).hasSize(1);
        JsonNode row = list.get(0);
        assertThat(row.propertyNames()).containsExactlyInAnyOrder(
                "recoveryRequestId", "participantId", "name", "requestedAt", "expiresAt");
        assertThat(row.get("recoveryRequestId").asString()).isEqualTo(request.id());
        assertThat(row.get("participantId").asString()).isEqualTo("b");
        assertThat(row.get("name").asString()).isEqualTo("Bob");
        assertThat(row.get("requestedAt").asString()).isEqualTo("2026-10-31T00:00:00Z");
        assertThat(row.get("expiresAt").asString()).isEqualTo("2026-10-31T00:05:00Z");
    }

    @Test
    void aDecidedRequestLeavesTheHostsList() {
        RecoveryRequests.Request request = ask(room, "Bob");

        approve(request);

        assertThat(listFor(room, "a")).isEmpty();
    }

    @Test
    void noSnapshotOrPublicationEverShowsACredential() {
        RecoveryRequests.Request request = ask(room, "Bob");
        approve(request);
        String credential = room.recoveryRequests().find(request.id()).orElseThrow().credential();

        String hostView = SnapshotWriter.snapshot(room, room.participant("a").orElseThrow()).json().toString();
        String seatView = SnapshotWriter.snapshot(room, room.participant("b").orElseThrow()).json().toString();

        assertThat(hostView).doesNotContain(credential).doesNotContain(CommandFixture.credential("a"));
        assertThat(seatView).doesNotContain(credential);
    }

    @Test
    void aNameMatchesIgnoringSpacesFormAndCase() {
        RecoveryRequests.Request request = ask(room, "  bOB ");
        assertThat(request.participantId()).isEqualTo("b");

        Room korean = new Room("r2", "XYZ234", clock.instant());
        korean.addParticipant("k", "한글", "cred", clock.instant());
        assertThat(ask(korean, "한글").participantId()).isEqualTo("k");
    }

    @Test
    void anUnknownNameIsNotFoundAndAnInvalidOneToo() {
        for (String name : List.of("Nobody", "", "bad_name!")) {
            assertThatThrownBy(() -> ask(room, name)).isInstanceOf(RoomException.class)
                    .extracting(e -> ((RoomException) e).code()).isEqualTo("RECOVERY_TARGET_NOT_FOUND");
        }
    }

    @Test
    void someoneAlreadySeatedCannotAskButAStaleBindingCan() {
        assertThatThrownBy(() -> RecoveryCommands.request(room, Optional.of(CommandFixture.binding("c")), "Bob", env))
                .isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("ALREADY_PARTICIPANT");

        RecoveryCommands.request(room, Optional.of(new SeatBinding("c", "stale")), "Bob", env);
    }

    @Test
    void askingLeavesTheSeatAloneButTellsTheHost() {
        long version = room.version();

        ask(room, "Bob");

        assertThat(room.version()).isEqualTo(version + 1);
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.presence().isConnected("b")).isTrue();
    }

    @Test
    void aSeatThatLeftBeforeTheDecisionIsNotFoundAndLeavesTheHostsList() {
        RecoveryRequests.Request request = ask(room, "Bob");
        f.send("a", "KICK", "{\"participantId\":\"b\"}");

        assertThat(code(approve(request))).isEqualTo("RECOVERY_TARGET_NOT_FOUND");
        assertThat(listFor(room, "a")).isEmpty();
    }

    @Test
    void aRenameAndATakeoverKeepTheCredential() {
        SeatBinding binding = CommandFixture.binding("b");

        f.send("b", "RENAME", "{\"name\":\"Bobby\"}");
        CommandPipeline.takeControl(room, "b", 1);

        assertThat(room.seatOf(binding)).isPresent();
    }

    @Test
    void theNewDeviceConnectsAsTheSameSeat() {
        RecoveryRequests.Request request = ask(room, "Bob");
        approve(request);
        long version = room.version();

        RoomLifecycle.connected(room, "b", "fresh-b", env);

        assertThat(room.presence().isConnected("b")).isTrue();
        assertThat(room.presence().neverConnected("b")).isFalse();
        assertThat(room.version()).isEqualTo(version + 1);
    }

    @Test
    void theOldConnectionClosingLateDoesNotDisconnectTheNewDevice() {
        RecoveryRequests.Request request = ask(room, "Bob");
        approve(request);
        RoomLifecycle.connected(room, "b", "fresh-b", env);
        long version = room.version();

        RoomLifecycle.disconnected(room, "conn-b", env);

        assertThat(room.presence().isConnected("b")).isTrue();
        assertThat(room.version()).isEqualTo(version);
    }
}
