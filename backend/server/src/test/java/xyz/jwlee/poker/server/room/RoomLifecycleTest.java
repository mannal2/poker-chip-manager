package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static xyz.jwlee.poker.server.room.CommandFixture.code;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.server.support.IdGenerator;

class RoomLifecycleTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
    private final RoomEnv env = new RoomEnv(clock, IdGenerator.random());

    // 시계를 밀리초만큼 진행한다
    private void pass(long millis) {
        clock.advance(Duration.ofMillis(millis));
    }

    // 참가자의 처음 연결을 끊는다
    private void drop(Room room, String who) {
        RoomLifecycle.disconnected(room, "conn-" + who, env);
    }

    // 참가자가 새 연결로 돌아온다
    private void back(Room room, String who) {
        RoomLifecycle.connected(room, who, "again-" + who, env);
    }

    // 명단의 참가자 id를 모은다
    private static List<String> roster(Room room) {
        return room.participants().stream().map(Participant::participantId).toList();
    }

    // 현재 토너먼트 범위로 TAKE_HOST를 보낸다
    private static CommandResult takeHost(GameFixture f, String who) {
        return f.sendWithoutHand(who, "TAKE_HOST", "{}");
    }

    // 참가자에게 보이는 스냅샷을 만든다
    private static ObjectNode snapshotFor(Room room, String who) {
        return SnapshotWriter.snapshot(room, room.participant(who).orElseThrow()).json();
    }

    // 방장 a가 끊긴 지 60초가 지나 인수 요청이 열린 게임을 만든다
    private GameFixture takeoverOpen() {
        GameFixture f = GameFixture.started(3, 0, clock);
        drop(f.room, "a");
        pass(60_000);
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.hostTakeoverOpen()).isTrue();
        return f;
    }

    // 끊긴 대기방 참가자는 4.9초에 남고 5초에 빠지는지 확인한다
    @Test
    void aWaitingAbsenceExpiresAtFiveSeconds() {
        Room room = new CommandFixture(3, clock).room;
        drop(room, "b");

        pass(4_900);
        RoomLifecycle.sweep(room, env);
        assertThat(roster(room)).containsExactly("a", "b", "c");

        long before = room.version();
        pass(100);
        RoomLifecycle.sweep(room, env);
        assertThat(roster(room)).containsExactly("a", "c");
        assertThat(room.version()).isEqualTo(before + 1);
        assertThat(room.isClosed()).isFalse();
    }

    // 4.9초에 돌아오면 유예가 취소되는지 확인한다
    @Test
    void comingBackInsideTheGraceKeepsTheSeat() {
        Room room = new CommandFixture(3, clock).room;
        drop(room, "b");
        pass(4_900);
        back(room, "b");

        pass(60_000);
        RoomLifecycle.sweep(room, env);

        assertThat(roster(room)).containsExactly("a", "b", "c");
    }

    // 한 번도 연결하지 않은 참가자는 29.9초에 남고 30초에 빠지는지 확인한다
    @Test
    void aFirstConnectionHasThirtySeconds() {
        Room room = new CommandFixture(1, clock).room;
        room.addParticipant("late", "Late", clock.instant());

        pass(29_900);
        RoomLifecycle.sweep(room, env);
        assertThat(roster(room)).containsExactly("a", "late");

        pass(100);
        RoomLifecycle.sweep(room, env);
        assertThat(roster(room)).containsExactly("a");
    }

    // 방장이 빠지면 끊긴 사람을 건너뛰고 연결된 최초 입장자가 넘겨받는지 확인한다
    @Test
    void aLeavingHostPassesToTheEarliestConnectedJoiner() {
        Room room = new CommandFixture(4, clock).room;
        drop(room, "a");
        pass(1_000);
        drop(room, "b");
        pass(4_000);

        RoomLifecycle.sweep(room, env);
        assertThat(roster(room)).containsExactly("b", "c", "d");
        assertThat(room.hostId()).isEqualTo("c");

        pass(1_000);
        RoomLifecycle.sweep(room, env);
        assertThat(roster(room)).containsExactly("c", "d");
    }

    // 좌석 순서가 아니라 입장 순서로 방장을 고르는지 확인한다
    @Test
    void theHandOverFollowsJoinOrderNotSeatOrder() {
        CommandFixture f = new CommandFixture(3, clock);
        assertThat(code(f.send("a", "SET_SEAT_ORDER", "{\"participantIds\":[\"a\",\"c\",\"b\"]}"))).isEqualTo("OK");
        drop(f.room, "a");
        pass(5_000);

        RoomLifecycle.sweep(f.room, env);

        assertThat(f.room.hostId()).isEqualTo("b");
    }

    // 연결된 사람이 없으면 남은 사람 중 입장 순서로 방장을 정하는지 확인한다
    @Test
    void withNobodyConnectedTheEarliestRemainingJoinerHosts() {
        Room room = new CommandFixture(3, clock).room;
        drop(room, "a");
        pass(1_000);
        drop(room, "b");
        drop(room, "c");
        pass(4_000);

        RoomLifecycle.sweep(room, env);

        assertThat(roster(room)).containsExactly("b", "c");
        assertThat(room.hostId()).isEqualTo("b");
    }

    // 나갔다 다시 들어온 사람은 새 입장 순서를 받아 먼저 온 사람 뒤로 가는지 확인한다
    @Test
    void someoneWhoReentersGetsANewJoinOrder() {
        Room room = new CommandFixture(3, clock).room;
        drop(room, "b");
        pass(5_000);
        RoomLifecycle.sweep(room, env);
        room.addParticipant("b2", "Bob", clock.instant());
        RoomLifecycle.connected(room, "b2", "conn-b2", env);
        drop(room, "a");
        pass(5_000);

        RoomLifecycle.sweep(room, env);

        assertThat(room.hostId()).isEqualTo("c");
    }

    // 마지막 사람이 빠지면 방이 닫히는지 확인한다
    @Test
    void theLastOneOutClosesTheRoom() {
        Room room = new CommandFixture(1, clock).room;
        drop(room, "a");
        pass(5_000);

        RoomLifecycle.sweep(room, env);

        assertThat(room.isClosed()).isTrue();
        assertThat(room.participants()).isEmpty();
    }

    // 한 번의 점검에서 전원이 빠져도 방이 닫히는지 확인한다
    @Test
    void everyoneExpiringInOneSweepClosesTheRoom() {
        Room room = new CommandFixture(2, clock).room;
        drop(room, "a");
        drop(room, "b");
        pass(5_000);

        RoomLifecycle.sweep(room, env);

        assertThat(room.isClosed()).isTrue();
    }

    // 강퇴된 사람의 접속 기록이 지워지고 연결 ID가 폐기 대기로 남는지 확인한다(R5)
    @Test
    void aRemovedPersonLeavesPendingRevocationsAndNoPresence() {
        CommandFixture f = new CommandFixture(2, clock);
        RoomLifecycle.connected(f.room, "b", "second-b", env);

        assertThat(code(f.send("a", "KICK", "{\"participantId\":\"b\"}"))).isEqualTo("OK");

        assertThat(f.room.presence().isConnected("b")).isFalse();
        assertThat(f.room.presence().subscribers()).containsOnlyKeys("conn-a");
        assertThat(f.room.drainPendingRevocations()).containsExactlyInAnyOrder("conn-b", "second-b");
        assertThat(f.room.drainPendingRevocations()).isEmpty();
    }

    // 접속 상태 전환만 버전을 올리는지 확인한다
    @Test
    void onlyConnectionTransitionsBumpTheVersion() {
        Room room = new CommandFixture(2, clock).room;
        long start = room.version();

        RoomLifecycle.connected(room, "b", "second-b", env);
        RoomLifecycle.disconnected(room, "second-b", env);
        RoomLifecycle.disconnected(room, "unknown", env);
        assertThat(room.version()).isEqualTo(start);

        drop(room, "b");
        assertThat(room.version()).isEqualTo(start + 1);
        back(room, "b");
        assertThat(room.version()).isEqualTo(start + 2);
    }

    // 끊긴 행동자는 끊긴 시점에 자동 처리되는지 확인한다
    @Test
    void aDisconnectingActorIsPlayedForAtOnce() {
        GameFixture f = GameFixture.started(3, 0, clock);
        assertThat(f.actor()).isEqualTo("a");

        drop(f.room, "a");

        assertThat(f.room.game().players.get(0).folded).isTrue();
        assertThat(f.actor()).isEqualTo("b");
    }

    // 전원 끊김으로 멈춘 차례가 누군가 돌아오면 이어지는지 확인한다
    @Test
    void aReturningPersonResumesAStalledTurn() {
        GameFixture f = GameFixture.started(3, 0, clock);
        drop(f.room, "b");
        drop(f.room, "c");
        drop(f.room, "a");
        assertThat(f.room.game().players.get(0).folded).isFalse();

        back(f.room, "b");

        assertThat(f.room.game().players.get(0).folded).isTrue();
        assertThat(f.actor()).isEqualTo("b");
    }

    // 방장 59.9초 끊김에는 요청이 없고 60초에 한 번만 열리는지 확인한다
    @Test
    void theTakeoverOpensAtSixtySeconds() {
        GameFixture f = GameFixture.started(3, 0, clock);
        drop(f.room, "a");

        pass(59_900);
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.hostTakeoverOpen()).isFalse();

        long before = f.room.version();
        pass(100);
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.hostTakeoverOpen()).isTrue();
        assertThat(f.room.version()).isEqualTo(before + 1);

        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.version()).isEqualTo(before + 1);
    }

    // 결과 화면에서도 인수 요청이 열리는지 확인한다
    @Test
    void theTakeoverAlsoOpensOnTheResultScreen() {
        GameFixture f = GameFixture.started(3, 0, clock);
        f.check(f.send("a", "ABORT", "{}"));
        drop(f.room, "a");
        pass(60_000);

        RoomLifecycle.sweep(f.room, env);

        assertThat(f.room.hostTakeoverOpen()).isTrue();
    }

    // 대기방에서는 인수 요청 없이 바로 방장이 넘어가는지 확인한다
    @Test
    void aWaitingRoomNeverOpensATakeover() {
        Room room = new CommandFixture(2, clock).room;
        drop(room, "a");
        pass(60_000);

        RoomLifecycle.sweep(room, env);

        assertThat(room.hostTakeoverOpen()).isFalse();
        assertThat(room.hostId()).isEqualTo("b");
    }

    // 방장이 돌아오면 요청이 닫히고 버전이 오르는지 확인한다
    @Test
    void theHostReturningClosesTheTakeover() {
        GameFixture f = takeoverOpen();
        long before = f.room.version();

        back(f.room, "a");

        assertThat(f.room.hostTakeoverOpen()).isFalse();
        assertThat(f.room.version()).isEqualTo(before + 1);
    }

    // 방장이 아닌 사람이 돌아와도 요청은 열려 있는지 확인한다
    @Test
    void aGuestReturningLeavesTheTakeoverOpen() {
        GameFixture f = takeoverOpen();
        drop(f.room, "c");

        back(f.room, "c");

        assertThat(f.room.hostTakeoverOpen()).isTrue();
    }

    // 방장이 바뀌면 요청이 닫히는지 확인한다
    @Test
    void transferringTheHostClosesTheTakeover() {
        GameFixture f = takeoverOpen();

        f.check(f.sendWithoutHand("a", "TRANSFER_HOST", "{\"participantId\":\"b\"}"));

        assertThat(f.room.hostTakeoverOpen()).isFalse();
    }

    // 스냅샷이 인수 요청과 요청자별 자격을 보여 주는지 확인한다
    @Test
    void theSnapshotShowsTheTakeoverAndWhoMayTakeIt() {
        GameFixture f = takeoverOpen();
        drop(f.room, "c");

        ObjectNode forB = snapshotFor(f.room, "b");

        assertThat(forB.get("hostTakeoverOpen").asBoolean()).isTrue();
        assertThat(forB.get("you").get("canTakeHost").asBoolean()).isTrue();
        assertThat(snapshotFor(f.room, "c").get("you").get("canTakeHost").asBoolean()).isFalse();
        assertThat(snapshotFor(f.room, "a").get("you").get("canTakeHost").asBoolean()).isFalse();
    }

    // 수락 두 건 중 먼저 처리된 쪽만 방장이 되는지 확인한다(M09)
    @Test
    void ofTwoAcceptancesOnlyTheFirstWins() {
        GameFixture f = takeoverOpen();
        String tournament = f.room.game().tournamentId;
        CommandRequest fromB = f.request("b", "TAKE_HOST", "{}", tournament, null);
        CommandRequest fromC = f.request("c", "TAKE_HOST", "{}", tournament, null);
        long before = f.room.version();

        f.check(f.base.pipeline.execute(f.room, "b", fromB));
        CommandResult late = f.base.pipeline.execute(f.room, "c", fromC);

        assertThat(f.room.hostId()).isEqualTo("b");
        assertThat(f.room.hostTakeoverOpen()).isFalse();
        assertThat(f.room.version()).isEqualTo(before + 1);
        assertThat(code(late)).isEqualTo("STALE_STATE");
        assertThat(code(takeHost(f, "c"))).isEqualTo("HOST_TAKEOVER_CLOSED");
    }

    // 인수가 먼저 확정되면 돌아온 옛 방장은 일반 참가자로 남는지 확인한다(M09)
    @Test
    void aFormerHostReturningAfterTheTakeoverStaysAGuest() {
        GameFixture f = takeoverOpen();
        f.check(takeHost(f, "b"));

        back(f.room, "a");

        assertThat(f.room.hostId()).isEqualTo("b");
        assertThat(f.room.hostTakeoverOpen()).isFalse();
    }

    // 요청이 닫혀 있으면 HOST_TAKEOVER_CLOSED로 거절하는지 확인한다
    @Test
    void takingAClosedRequestIsRefused() {
        CommandFixture waiting = new CommandFixture(2, clock);
        assertThat(code(waiting.send("b", "TAKE_HOST", "{}"))).isEqualTo("HOST_TAKEOVER_CLOSED");

        GameFixture playing = GameFixture.started(2, 0, clock);
        assertThat(code(takeHost(playing, "b"))).isEqualTo("HOST_TAKEOVER_CLOSED");
        assertThat(playing.room.hostId()).isEqualTo("a");
    }

    // 접속 중이 아닌 요청자는 FORBIDDEN으로 거절하는지 확인한다
    @Test
    void aDisconnectedRequesterIsForbidden() {
        GameFixture f = takeoverOpen();
        drop(f.room, "c");

        assertThat(code(takeHost(f, "c"))).isEqualTo("FORBIDDEN");
        assertThat(f.room.hostId()).isEqualTo("a");
        assertThat(f.room.hostTakeoverOpen()).isTrue();
    }

    // 본문이 있는 TAKE_HOST는 형식 오류로 거절하는지 확인한다
    @Test
    void takeHostTakesAnEmptyPayload() {
        GameFixture f = takeoverOpen();

        assertThat(code(f.sendWithoutHand("b", "TAKE_HOST", "{\"participantId\":\"c\"}"))).isEqualTo("INVALID_INPUT");
    }

    // 탈락자는 진행 중 인수가 거절되고 결과 화면에서는 성공하는지 확인한다
    @Test
    void anEliminatedPersonMayTakeOverOnlyOnTheResultScreen() {
        GameFixture f = GameFixture.started(3, 0, clock);
        f.check(f.send("a", "ALL_IN", null));
        f.check(f.send("b", "FOLD", null));
        f.check(f.send("c", "CALL", null));
        f.check(f.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p0\"]}}"));
        assertThat(f.room.game().players.get(2).eliminated).isTrue();
        assertThat(f.room.phase()).isEqualTo(RoomPhase.PLAYING);
        drop(f.room, "a");
        pass(60_000);
        RoomLifecycle.sweep(f.room, env);

        assertThat(code(takeHost(f, "c"))).isEqualTo("FORBIDDEN");
        assertThat(f.room.hostId()).isEqualTo("a");

        f.check(f.send("a", "ABORT", "{}"));
        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);
        assertThat(f.room.hostTakeoverOpen()).isTrue();

        f.check(takeHost(f, "c"));
        assertThat(f.room.hostId()).isEqualTo("c");
    }

    // 인수하면 옛 방장의 승자 초안이 지워지는지 확인한다
    @Test
    void takingOverDropsTheOldHostsDraft() {
        GameFixture f = GameFixture.started(2, 0, clock);
        f.check(f.send("a", "ALL_IN", null));
        f.check(f.send("b", "CALL", null));
        f.check(f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p0\"]}}"));
        assertThat(f.room.settlementDraft()).isNotNull();
        drop(f.room, "a");
        pass(60_000);
        RoomLifecycle.sweep(f.room, env);

        f.check(f.send("b", "TAKE_HOST", "{}"));

        assertThat(f.room.settlementDraft()).isNull();
    }

    // 결과 화면에서 1분 끊긴 사람도 RE_READY 시점부터 새 5초를 받는지 확인한다(M21)
    @Test
    void reReadyGivesTheAbsentAFreshGrace() {
        GameFixture f = GameFixture.started(3, 0, clock);
        f.check(f.send("a", "ABORT", "{}"));
        drop(f.room, "b");
        pass(60_000);

        f.check(f.send("a", "RE_READY", "{}"));
        RoomLifecycle.sweep(f.room, env);
        assertThat(roster(f.room)).containsExactly("a", "b", "c");

        pass(4_900);
        RoomLifecycle.sweep(f.room, env);
        assertThat(roster(f.room)).containsExactly("a", "b", "c");

        pass(100);
        RoomLifecycle.sweep(f.room, env);
        assertThat(roster(f.room)).containsExactly("a", "c");
    }

    // 다시 준비가 열린 인수 요청을 닫는지 확인한다
    @Test
    void reReadyClosesTheTakeover() {
        GameFixture f = GameFixture.started(3, 0, clock);
        f.check(f.send("a", "ABORT", "{}"));
        drop(f.room, "a");
        pass(60_000);
        RoomLifecycle.sweep(f.room, env);

        f.check(f.send("a", "RE_READY", "{}"));

        assertThat(f.room.hostTakeoverOpen()).isFalse();
    }

    // 다시 준비의 재전송과 같은 시점 점검이 유예를 늘리지 않는지 확인한다(M22)
    @Test
    void aRetryOfReReadyDoesNotExtendTheGrace() {
        GameFixture f = GameFixture.started(3, 0, clock);
        f.check(f.send("a", "ABORT", "{}"));
        drop(f.room, "b");
        pass(60_000);
        CommandRequest reReady = f.request("a", "RE_READY", "{}", f.room.game().tournamentId, null);
        f.check(f.base.pipeline.execute(f.room, "a", reReady));

        pass(3_000);
        RoomLifecycle.sweep(f.room, env);
        f.check(f.base.pipeline.execute(f.room, "a", reReady));
        assertThat(code(f.send("a", "RE_READY", "{}"))).isEqualTo("INVALID_ACTION");

        pass(2_000);
        RoomLifecycle.sweep(f.room, env);
        assertThat(roster(f.room)).containsExactly("a", "c");
    }

    // 전원 미접속 29분 59초에는 남고 30분에 닫히는지 확인한다
    @Test
    void aRoomEveryoneLeftClosesAtThirtyMinutes() {
        GameFixture f = GameFixture.started(2, 0, clock);
        drop(f.room, "a");
        drop(f.room, "b");

        pass(Duration.ofMinutes(30).minusSeconds(1).toMillis());
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.isClosed()).isFalse();

        pass(1_000);
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.isClosed()).isTrue();
    }

    // 삭제 시간은 마지막 사람이 끊긴 때부터 세는지 확인한다
    @Test
    void theThirtyMinutesCountFromTheLastDisconnect() {
        GameFixture f = GameFixture.started(2, 0, clock);
        f.check(f.send("a", "ABORT", "{}"));
        drop(f.room, "a");
        pass(Duration.ofMinutes(10).toMillis());
        drop(f.room, "b");

        pass(Duration.ofMinutes(20).toMillis());
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.isClosed()).isFalse();

        pass(Duration.ofMinutes(10).toMillis());
        RoomLifecycle.sweep(f.room, env);
        assertThat(f.room.isClosed()).isTrue();
    }

    // 한 사람이라도 접속 중이면 방이 닫히지 않는지 확인한다
    @Test
    void oneConnectionKeepsTheRoomOpen() {
        GameFixture f = GameFixture.started(2, 0, clock);
        drop(f.room, "a");

        pass(Duration.ofHours(2).toMillis());
        RoomLifecycle.sweep(f.room, env);

        assertThat(f.room.isClosed()).isFalse();
    }
}
