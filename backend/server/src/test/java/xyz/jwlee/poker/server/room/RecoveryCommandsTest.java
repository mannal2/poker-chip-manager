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
    // 복구 요청 수명(5분)보다 먼저 부재가 만료되도록 대기방 유예를 5초로 줄인 환경
    private final RoomEnv shortGrace = new RoomEnv(clock, IdGenerator.random(), new StartGate(),
            new PresenceGrace(Duration.ofSeconds(5), PresenceGrace.DEFAULT.autoPlay()));
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

    // 자리 확인이 명단과 자격 증명을 함께 보는지 확인한다
    @Test
    void seatOfChecksTheRosterAndTheCredentialTogether() {
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.seatOf(new SeatBinding("b", "wrong"))).isEmpty();
        assertThat(room.seatOf(new SeatBinding("gone", CommandFixture.credential("b")))).isEmpty();
    }

    // 승인하면 새 바인딩만 남고 세대가 하나 오르는지 확인한다
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

    // 승인이 버전을 올리고 옛 연결을 닫도록 알리는지 확인한다
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

    // 승인 시각이 부재 시작이 되고 대기실은 30초를 기다리는지 확인한다
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

    // 복구된 자리가 방장 지위와 칩을 유지하는지 확인한다
    @Test
    void aRecoveredSeatStaysHostAndKeepsItsChips() {
        GameFixture game = GameFixture.started(3, 1, clock);
        List<Integer> stacks = game.room.game().players.stream().map(p -> p.stack).toList();
        RecoveryRequests.Request request = ask(game.room, "Alice");

        game.check(game.sendWithoutHand("a", "RECOVERY_APPROVE", payload(request.id())));

        assertThat(game.room.hostId()).isEqualTo("a");
        assertThat(game.room.game().players.stream().map(p -> p.stack).toList()).isEqualTo(stacks);
    }

    // 탈락한 자리도 복구되며 탈락 상태로 남는지 확인한다
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

    // 한 자리가 대기 요청 세 개까지 받고 네 번째는 거부하는지 확인한다
    @Test
    void aSeatTakesThreePendingRequestsAndRefusesTheFourth() {
        ask(room, "Bob");
        ask(room, "Bob");
        ask(room, "Bob");

        assertThatThrownBy(() -> ask(room, "Bob")).isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("RECOVERY_LIMIT");
        ask(room, "Carol");
    }

    // 끝난 요청은 더 이상 한도에 들지 않는지 확인한다
    @Test
    void anEndedRequestNoLongerCountsAgainstTheLimit() {
        RecoveryRequests.Request first = ask(room, "Bob");
        ask(room, "Bob");
        ask(room, "Bob");

        f.send("a", "RECOVERY_REJECT", payload(first.id()));

        ask(room, "Bob");
    }

    // 한 요청의 승인이 그 자리의 다른 요청만 대체하는지 확인한다
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

    // 거절된 요청은 승인할 수 없고 자리를 바꾸지 않는지 확인한다
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

    // 없는 요청은 대기 중이 아니고 빠진 필드는 무효인지 확인한다
    @Test
    void anUnknownRequestIsNotPendingAndAMissingFieldIsInvalid() {
        assertThat(code(f.send("a", "RECOVERY_APPROVE", payload("nope")))).isEqualTo("RECOVERY_NOT_PENDING");
        assertThat(code(f.send("a", "RECOVERY_APPROVE", "{}"))).isEqualTo("INVALID_INPUT");
    }

    // 5분이 지난 요청이 정리로 만료되며 버전이 오르는지 확인한다
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

    // 시간이 지난 요청은 정리가 보기 전에도 승인할 수 없는지 확인한다
    @Test
    void aRequestPastItsTimeCannotBeApprovedBeforeTheSweepSeesIt() {
        RecoveryRequests.Request request = ask(room, "Bob");

        clock.advance(Duration.ofMinutes(5));

        assertThat(code(approve(request))).isEqualTo("RECOVERY_NOT_PENDING");
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.recoveryRequests().find(request.id()).orElseThrow().statusAt(clock.instant()))
                .isEqualTo(Status.EXPIRED);
    }

    // 끝난 요청이 5분 뒤 버전 변화 없이 지워지는지 확인한다
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

    // 게임이 진행 중이어도 정리가 요청을 만료시키는지 확인한다
    @Test
    void theSweepExpiresRequestsWhileAGameRuns() {
        GameFixture game = GameFixture.started(3, 1, clock);
        RecoveryRequests.Request request = ask(game.room, "Bob");

        clock.advance(Duration.ofMinutes(5));
        RoomLifecycle.sweep(game.room, env);

        assertThat(statusOf(game.room, request)).isEqualTo(Status.EXPIRED);
    }

    // 방장만 결정할 수 있는지 확인한다
    @Test
    void onlyTheHostMayDecide() {
        RecoveryRequests.Request request = ask(room, "Carol");

        assertThat(code(f.send("b", "RECOVERY_APPROVE", payload(request.id())))).isEqualTo("FORBIDDEN");
        assertThat(code(f.send("b", "RECOVERY_REJECT", payload(request.id())))).isEqualTo("FORBIDDEN");
        assertThat(code(f.send("c", "RECOVERY_APPROVE", payload(request.id())))).isEqualTo("FORBIDDEN");

        assertThat(statusOf(room, request)).isEqualTo(Status.PENDING);
        assertThat(room.seatOf(CommandFixture.binding("c"))).isPresent();
    }

    // 방장의 스냅샷에만 요청이 실리고 세션과 자격 증명은 빠지는지 확인한다
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

    // 결정된 요청은 방장의 목록에서 빠지는지 확인한다
    @Test
    void aDecidedRequestLeavesTheHostsList() {
        RecoveryRequests.Request request = ask(room, "Bob");

        approve(request);

        assertThat(listFor(room, "a")).isEmpty();
    }

    // 어떤 스냅샷이나 발행에도 자격 증명이 보이지 않는지 확인한다
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

    // 이름이 공백·형태·대소문자를 무시하고 일치하는지 확인한다
    @Test
    void aNameMatchesIgnoringSpacesFormAndCase() {
        RecoveryRequests.Request request = ask(room, "  bOB ");
        assertThat(request.participantId()).isEqualTo("b");

        Room korean = new Room("r2", "XYZ234", clock.instant());
        korean.addParticipant("k", "한글", "cred", clock.instant());
        assertThat(ask(korean, "한글").participantId()).isEqualTo("k");
    }

    // 모르는 이름은 찾을 수 없음이고 잘못된 이름은 무효인지 확인한다
    @Test
    void anUnknownNameIsNotFoundAndAnInvalidOneToo() {
        for (String name : List.of("Nobody", "", "bad_name!")) {
            assertThatThrownBy(() -> ask(room, name)).isInstanceOf(RoomException.class)
                    .extracting(e -> ((RoomException) e).code()).isEqualTo("RECOVERY_TARGET_NOT_FOUND");
        }
    }

    // 이미 앉은 사람은 신청할 수 없지만 낡은 바인딩은 신청할 수 있는지 확인한다
    @Test
    void someoneAlreadySeatedCannotAskButAStaleBindingCan() {
        assertThatThrownBy(() -> RecoveryCommands.request(room, Optional.of(CommandFixture.binding("c")), "Bob", env))
                .isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("ALREADY_PARTICIPANT");

        RecoveryCommands.request(room, Optional.of(new SeatBinding("c", "stale")), "Bob", env);
    }

    // 신청은 자리를 건드리지 않고 방장에게만 알리는지 확인한다
    @Test
    void askingLeavesTheSeatAloneButTellsTheHost() {
        long version = room.version();

        ask(room, "Bob");

        assertThat(room.version()).isEqualTo(version + 1);
        assertThat(room.seatOf(CommandFixture.binding("b"))).isPresent();
        assertThat(room.presence().isConnected("b")).isTrue();
    }

    // 결정 전에 떠난 자리의 요청은 대기가 아니고 방장 목록에서 빠지는지 확인한다
    @Test
    void aSeatThatLeftBeforeTheDecisionIsNoLongerPendingAndLeavesTheHostsList() {
        RecoveryRequests.Request request = ask(room, "Bob");
        f.send("a", "KICK", "{\"participantId\":\"b\"}");

        assertThat(code(approve(request))).isEqualTo("RECOVERY_NOT_PENDING");
        assertThat(listFor(room, "a")).isEmpty();
    }

    // 강퇴는 그 자리의 대기 요청만 끝내는지 확인한다
    @Test
    void aKickEndsTheSeatsPendingRequestsOnly() {
        RecoveryRequests.Request bobs = ask(room, "Bob");
        RecoveryRequests.Request carols = ask(room, "Carol");

        f.send("a", "KICK", "{\"participantId\":\"b\"}");

        assertThat(statusOf(room, bobs)).isEqualTo(Status.SUPERSEDED);
        assertThat(statusOf(room, carols)).isEqualTo(Status.PENDING);
    }

    // 자리를 떠나면 그 자리의 대기 요청이 끝나는지 확인한다
    @Test
    void leavingEndsTheSeatsPendingRequests() {
        RecoveryRequests.Request request = ask(room, "Bob");

        f.send("b", "LEAVE", "{}");

        assertThat(statusOf(room, request)).isEqualTo(Status.SUPERSEDED);
    }

    // 부재가 만료되면 그 자리의 대기 요청이 끝나는지 확인한다
    @Test
    void anAbsenceThatExpiresEndsTheSeatsPendingRequests() {
        RecoveryRequests.Request request = ask(room, "Bob");
        RoomLifecycle.disconnected(room, "conn-b", env);

        clock.advance(Duration.ofSeconds(5));
        RoomLifecycle.sweep(room, shortGrace);

        assertThat(room.hasParticipant("b")).isFalse();
        assertThat(statusOf(room, request)).isEqualTo(Status.SUPERSEDED);
    }

    // 다시 준비한 뒤 부재가 만료돼도 그 자리의 대기 요청이 끝나는지 확인한다
    @Test
    void anAbsenceThatExpiresAfterReReadyEndsTheSeatsPendingRequests() {
        GameFixture game = GameFixture.started(2, 0, clock);
        RecoveryRequests.Request request = ask(game.room, "Bob");
        RoomLifecycle.disconnected(game.room, "conn-b", env);
        game.check(game.send("a", "ABORT", "{}"));
        game.check(game.send("a", "RE_READY", "{}"));
        assertThat(statusOf(game.room, request)).isEqualTo(Status.PENDING);

        clock.advance(Duration.ofSeconds(5));
        RoomLifecycle.sweep(game.room, shortGrace);

        assertThat(game.room.hasParticipant("b")).isFalse();
        assertThat(statusOf(game.room, request)).isEqualTo(Status.SUPERSEDED);
    }

    // 이름 변경과 인계가 자격 증명을 유지하는지 확인한다
    @Test
    void aRenameAndATakeoverKeepTheCredential() {
        SeatBinding binding = CommandFixture.binding("b");

        f.send("b", "RENAME", "{\"name\":\"Bobby\"}");
        CommandPipeline.takeControl(room, "b", 1);

        assertThat(room.seatOf(binding)).isPresent();
    }

    // 새 기기가 같은 자리로 접속하는지 확인한다
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

    // 옛 연결이 늦게 닫혀도 새 기기가 끊김으로 바뀌지 않는지 확인한다
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
