package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static xyz.jwlee.poker.server.room.CommandFixture.code;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.Legal;
import xyz.jwlee.poker.game.Settlement;
import xyz.jwlee.poker.game.model.FormerPlayer;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Joining;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.gamejson.GameJson;
import xyz.jwlee.poker.server.room.BuyInRequests.Status;
import xyz.jwlee.poker.server.support.IdGenerator;

// 진행 중인 방의 바이인 신청·승인·거절·만료·취소 규칙을 방 수준에서 검사한다
class BuyInCommandsTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-21T00:00:00Z"));
    private final RoomEnv env = new RoomEnv(clock, IdGenerator.random());

    // 세션 없는 새 사람이 이름으로 바이인을 신청한다
    private BuyInRequests.Request ask(Room in, String name) {
        return ask(in, "session-x", name);
    }

    // 주어진 세션이 이름으로 바이인을 신청한다
    private BuyInRequests.Request ask(Room in, String session, String name) {
        return BuyInCommands.request(in, Optional.empty(), session, name, env);
    }

    // 신청을 거절할 때의 오류 코드를 읽는다
    private String refusal(Room in, String name) {
        try {
            ask(in, name);
        } catch (RoomException e) {
            return e.code();
        }
        throw new AssertionError("the request was accepted");
    }

    // 3명이 진행 중인 게임을 만든다(딜러 a=p0, SB b=p1, BB c=p2)
    private GameFixture playing() {
        return GameFixture.started(3, 0, clock);
    }

    // 승인 payload를 만든다
    private static String approval(String id, String placement) {
        return "{\"buyInRequestId\":\"" + id + "\",\"placement\":" + placement + "}";
    }

    // 지정한 플레이어 뒤 자리
    private static String between(String after) {
        return "{\"kind\":\"between\",\"after\":\"" + after + "\"}";
    }

    // 탈락자의 자리
    private static String replace(String playerId) {
        return "{\"kind\":\"replace\",\"playerId\":\"" + playerId + "\"}";
    }

    // 방장 a가 신청을 승인한다
    private static CommandResult approve(GameFixture g, BuyInRequests.Request r, String placement) {
        return g.sendWithoutHand("a", "BUY_IN_APPROVE", approval(r.id(), placement));
    }

    // 신청의 현재 저장 상태를 읽는다
    private static Status statusOf(Room in, BuyInRequests.Request r) {
        return in.buyInRequests().find(r.id()).orElseThrow().status();
    }

    // 참가자에게 보이는 바이인 신청 목록을 읽는다
    private static JsonNode listFor(Room in, String who) {
        return SnapshotWriter.snapshot(in, in.participant(who).orElseThrow()).json().get("buyInRequests");
    }

    // id로 게임의 플레이어를 찾는다
    private static Player player(Room in, String id) {
        return in.game().players.stream().filter(p -> p.id.equals(id)).findFirst().orElseThrow();
    }

    // c가 올인하고 a가 받아 이겨 c(p2)를 탈락시킨다. b는 폴드한다
    private static void eliminateCarol(GameFixture g) {
        g.check(g.send("a", "CALL", null));
        g.check(g.send("b", "FOLD", null));
        g.check(g.send("c", "ALL_IN", null));
        g.check(g.send("a", "CALL", null));
        String winners = Settlement.buildPots(g.room.game()).stream()
                .map(p -> "\"" + p.id() + "\":[\"p0\"]").collect(Collectors.joining(",", "{", "}"));
        g.check(g.send("a", "SETTLE_HAND", "{\"winners\":" + winners + "}"));
        assertThat(player(g.room, "p2").eliminated).isTrue();
        assertThat(g.room.game().status).isEqualTo(TournamentStatus.PLAYING);
    }

    // 차례인 사람이 낼 몫이 있으면 폴드, 없으면 체크해 핸드를 넘긴다
    private static void passTurn(GameFixture g) {
        String who = g.actor();
        g.check(g.send(who, Legal.of(g.room.game()).callAdditional() > 0 ? "FOLD" : "CHECK", null));
    }

    // 대기실은 바이인을 받지 않는지 확인한다
    @Test
    void aWaitingRoomTakesNoBuyIn() {
        CommandFixture f = new CommandFixture(3, clock);

        assertThat(refusal(f.room, "Erin")).isEqualTo("BUY_IN_CLOSED");
        assertThat(f.room.buyInRequests().pending()).isEmpty();
    }

    // 끝난 토너먼트는 바이인을 받지 않는지 확인한다
    @Test
    void anEndedTournamentTakesNoBuyIn() {
        GameFixture g = GameFixture.started(2, 0, clock);
        g.check(g.send(g.actor(), "ALL_IN", null));
        g.check(g.send(g.actor(), "CALL", null));
        String winners = Settlement.buildPots(g.room.game()).stream()
                .map(p -> "\"" + p.id() + "\":[\"p0\"]").collect(Collectors.joining(",", "{", "}"));
        g.check(g.send("a", "SETTLE_HAND", "{\"winners\":" + winners + "}"));
        assertThat(g.room.game().status).isEqualTo(TournamentStatus.ENDED);

        assertThat(refusal(g.room, "Erin")).isEqualTo("BUY_IN_CLOSED");
    }

    // 토너먼트가 끝나면 대기 중이던 신청이 끝난 상태로 닫혀 더 기다리지 않는지 확인한다
    @Test
    void whenTheTournamentEndsPendingRequestsEndAsSuperseded() {
        GameFixture g = GameFixture.started(2, 0, clock);
        BuyInRequests.Request r = ask(g.room, "Erin");
        g.check(g.send(g.actor(), "ALL_IN", null));
        g.check(g.send(g.actor(), "CALL", null));
        String winners = Settlement.buildPots(g.room.game()).stream()
                .map(p -> "\"" + p.id() + "\":[\"p0\"]").collect(Collectors.joining(",", "{", "}"));
        g.check(g.send("a", "SETTLE_HAND", "{\"winners\":" + winners + "}"));
        assertThat(g.room.game().status).isEqualTo(TournamentStatus.ENDED);

        BuyInRequests.Request after = g.room.buyInRequests().find(r.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(Status.SUPERSEDED);
        assertThat(after.statusAt(clock.instant())).isEqualTo(Status.SUPERSEDED);
        assertThat(g.room.buyInRequests().pending()).isEmpty();
    }

    // 진행 중인 방에서 신청하면 대기 신청이 생기고 방장에게 알리는지 확인한다
    @Test
    void askingInARunningRoomMakesAPendingRequestAndTellsTheHost() {
        GameFixture g = playing();
        long version = g.room.version();
        int seated = g.room.participants().size();

        BuyInRequests.Request r = ask(g.room, " Erin ");

        assertThat(r.status()).isEqualTo(Status.PENDING);
        assertThat(r.name()).isEqualTo("Erin");
        assertThat(r.reentryOf()).isNull();
        assertThat(r.expiresAt()).isEqualTo(clock.instant().plus(Duration.ofMinutes(5)));
        assertThat(g.room.version()).isEqualTo(version + 1);
        assertThat(g.room.participants()).hasSize(seated);
    }

    // 승인하면 새 참가자와 자격이 생기고 새 플레이어로 연결되는지 확인한다
    @Test
    void approvingSeatsANewParticipantWithACredentialLinkedToTheNewPlayer() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");
        long version = g.room.version();

        g.check(approve(g, r, between("p2")));

        BuyInRequests.Request approved = g.room.buyInRequests().find(r.id()).orElseThrow();
        assertThat(approved.status()).isEqualTo(Status.APPROVED);
        assertThat(approved.credential()).isNotBlank();
        Participant erin = g.room.seatOf(new SeatBinding(approved.participantId(), approved.credential()))
                .orElseThrow();
        assertThat(erin.name()).isEqualTo("Erin");
        assertThat(g.room.playerIds().get(erin.participantId())).isEqualTo("p3");
        assertThat(player(g.room, "p3").joining).isEqualTo(Joining.NEXT_HAND);
        assertThat(g.room.version()).isGreaterThan(version);
        assertThat(listFor(g.room, "a")).isEmpty();
    }

    // 승인된 사람의 명령이 새 플레이어로 처리되는지 확인한다
    @Test
    void theApprovedPersonCommandsTheNewPlayer() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");
        g.check(approve(g, r, between("p2")));
        String erin = g.room.buyInRequests().find(r.id()).orElseThrow().participantId();
        String hand = g.room.game().hand.id;

        while (g.room.game().hand.id.equals(hand)) {
            passTurn(g);
        }
        while (!g.actor().equals(erin)) {
            passTurn(g);
        }
        g.check(g.send(erin, Legal.of(g.room.game()).callAdditional() > 0 ? "CALL" : "CHECK", null));

        assertThat(player(g.room, "p3").handTotal).isGreaterThan(0);
    }

    // 기권한 사람도 그 핸드가 끝나 탈락으로 정리되면 재입장을 신청할 수 있는지 확인한다
    @Test
    void aForfeitedPlayerMayAskToReenterOnceTheHandEnds() {
        GameFixture g = playing();
        g.check(g.send("c", "FORFEIT", "{}"));
        // 남은 칩은 핸드가 끝날 때 나눠지므로 그 전에는 아직 탈락자가 아니다
        assertThat(code(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"))).isEqualTo("NOT_ELIMINATED");
        g.check(g.send("a", "FOLD", null));
        assertThat(player(g.room, "p2").eliminated).isTrue();
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        assertThat(g.room.buyInRequests().pending()).hasSize(1);
    }

    // 탈락자의 재입장 신청이 승인되면 새 플레이어로 다시 연결되고 옛 ID는 더 쓰이지 않는지 확인한다
    @Test
    void anApprovedReentryRelinksTheSeatAndTheOldPlayerIdIsDone() {
        GameFixture g = playing();
        eliminateCarol(g);

        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        BuyInRequests.Request r = g.room.buyInRequests().pending().get(0);
        assertThat(r.reentryOf()).isEqualTo("p2");
        assertThat(r.name()).isEqualTo("Carol");
        assertThat(r.participantId()).isEqualTo("c");

        g.check(approve(g, r, replace("p2")));

        assertThat(statusOf(g.room, r)).isEqualTo(Status.APPROVED);
        assertThat(g.room.playerIds().get("c")).isEqualTo("p3");
        assertThat(player(g.room, "p3").entry).isEqualTo(2);
        assertThat(g.room.participants()).hasSize(3);
        assertThat(code(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"))).isEqualTo("NOT_ELIMINATED");
        assertThat(code(g.sendWithoutHand("a", "CANCEL_BUY_IN", "{\"playerId\":\"p2\"}")))
                .isEqualTo("INVALID_ACTION");
    }

    // 탈락하지 않은 사람은 재입장을 신청할 수 없는지 확인한다
    @Test
    void someoneStillPlayingCannotAskToReenter() {
        GameFixture g = playing();

        assertThat(code(g.sendWithoutHand("b", "REQUEST_BUY_IN", "{}"))).isEqualTo("NOT_ELIMINATED");
        assertThat(code(g.sendWithoutHand("b", "REQUEST_BUY_IN", "{\"x\":1}"))).isEqualTo("INVALID_INPUT");
        assertThat(g.room.buyInRequests().pending()).isEmpty();
    }

    // 거절된 신청은 승인할 수 없는지 확인한다
    @Test
    void aRejectedRequestCannotBeApproved() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");

        g.check(g.sendWithoutHand("a", "BUY_IN_REJECT", "{\"buyInRequestId\":\"" + r.id() + "\"}"));

        assertThat(statusOf(g.room, r)).isEqualTo(Status.REJECTED);
        assertThat(code(approve(g, r, between("p2")))).isEqualTo("BUY_IN_NOT_PENDING");
        assertThat(g.room.participants()).hasSize(3);
        assertThat(code(g.sendWithoutHand("a", "BUY_IN_APPROVE", "{}"))).isEqualTo("INVALID_INPUT");
        assertThat(code(approve(g, ask(g.room, "Finn"), "{\"kind\":\"nowhere\"}"))).isEqualTo("INVALID_INPUT");
    }

    // 5분이 지난 신청이 정리로 만료되고 승인할 수 없는지 확인한다
    @Test
    void afterFiveMinutesARequestExpiresAndCannotBeApproved() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");
        long version = g.room.version();

        clock.advance(Duration.ofMinutes(5).minusMillis(1));
        RoomLifecycle.sweep(g.room, env);
        assertThat(statusOf(g.room, r)).isEqualTo(Status.PENDING);

        clock.advance(Duration.ofMillis(1));
        assertThat(code(approve(g, r, between("p2")))).isEqualTo("BUY_IN_NOT_PENDING");
        RoomLifecycle.sweep(g.room, env);
        assertThat(statusOf(g.room, r)).isEqualTo(Status.EXPIRED);
        assertThat(g.room.version()).isGreaterThan(version);
        assertThat(listFor(g.room, "a")).isEmpty();
    }

    // 한 세션의 새 사람 신청 하나가 승인되면 같은 세션의 다른 대기 신청은 밀려나 두 번 앉지 못하는지 확인한다
    @Test
    void approvingOneNewcomerRequestEndsTheSameSessionsOtherRequests() {
        GameFixture g = playing();
        BuyInRequests.Request erin = ask(g.room, "s1", "Erin");
        BuyInRequests.Request finn = ask(g.room, "s1", "Finn");
        BuyInRequests.Request gina = ask(g.room, "s2", "Gina");

        g.check(approve(g, erin, between("p2")));

        assertThat(statusOf(g.room, finn)).isEqualTo(Status.SUPERSEDED);
        assertThat(code(approve(g, finn, between("p2")))).isEqualTo("BUY_IN_NOT_PENDING");
        assertThat(statusOf(g.room, gina)).isEqualTo(Status.PENDING);
    }

    // 탈락자가 재입장 신청을 여러 번 눌러도 방장에게는 한 건만 보이는지 확인한다
    @Test
    void aRepeatedReentryRequestStaysOnePendingRequest() {
        GameFixture g = playing();
        eliminateCarol(g);

        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));

        assertThat(g.room.buyInRequests().pending()).hasSize(1);
        assertThat(listFor(g.room, "a")).hasSize(1);
    }

    // 한 세션은 대기 신청 세 건까지만 낼 수 있는지 확인한다
    @Test
    void aSessionHoldsAtMostThreePendingRequests() {
        GameFixture g = playing();
        ask(g.room, "s1", "Erin");
        ask(g.room, "s1", "Finn");
        BuyInRequests.Request third = ask(g.room, "s1", "Gina");

        assertThatThrownBy(() -> ask(g.room, "s1", "Hank")).isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("BUY_IN_LIMIT");
        ask(g.room, "s2", "Hank");

        g.check(g.sendWithoutHand("a", "BUY_IN_REJECT", "{\"buyInRequestId\":\"" + third.id() + "\"}"));
        ask(g.room, "s1", "Hank");
    }

    // 방장만 승인·거절·취소할 수 있는지 확인한다
    @Test
    void onlyTheHostMayDecideOrCancel() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");

        assertThat(code(g.sendWithoutHand("b", "BUY_IN_APPROVE", approval(r.id(), between("p2")))))
                .isEqualTo("FORBIDDEN");
        assertThat(code(g.sendWithoutHand("b", "BUY_IN_REJECT", "{\"buyInRequestId\":\"" + r.id() + "\"}")))
                .isEqualTo("FORBIDDEN");
        g.check(approve(g, r, between("p2")));
        assertThat(code(g.sendWithoutHand("b", "CANCEL_BUY_IN", "{\"playerId\":\"p3\"}"))).isEqualTo("FORBIDDEN");
        assertThat(player(g.room, "p3").joining).isNotNull();
    }

    // 엔진이 자리를 거절하면 방과 신청이 그대로인지 확인한다
    @Test
    void anEngineRefusalLeavesTheRoomAndTheRequestAsTheyWere() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");
        GameState before = g.room.game();
        int seated = g.room.participants().size();

        assertThat(code(approve(g, r, replace("p1")))).isEqualTo("INVALID_SEATS");

        assertThat(g.room.game()).isSameAs(before);
        assertThat(g.room.participants()).hasSize(seated);
        assertThat(statusOf(g.room, r)).isEqualTo(Status.PENDING);
    }

    // 대기 중인 새 사람의 바이인을 취소하면 참가자에서 빠지고 연결이 닫히는지 확인한다
    @Test
    void cancellingANewcomersWaitingBuyInRemovesTheParticipantAndClosesTheConnection() {
        GameFixture g = playing();
        BuyInRequests.Request r = ask(g.room, "Erin");
        g.check(approve(g, r, between("p2")));
        String erin = g.room.buyInRequests().find(r.id()).orElseThrow().participantId();
        g.room.presence().attach(erin, "conn-erin", clock.instant());
        PublicationBuilder.collect(g.room);

        g.check(g.sendWithoutHand("a", "CANCEL_BUY_IN", "{\"playerId\":\"p3\"}"));

        assertThat(g.room.hasParticipant(erin)).isFalse();
        assertThat(g.room.playerIds()).doesNotContainKey(erin);
        assertThat(g.room.game().players).extracting(p -> p.id).containsExactly("p0", "p1", "p2");
        assertThat(PublicationBuilder.collect(g.room).revokedConnections()).containsExactly("conn-erin");
    }

    // 대기 중인 재입장을 취소하면 원래 탈락 기록에 다시 연결되는지 확인한다
    @Test
    void cancellingAWaitingReentryRelinksTheOriginalRecord() {
        GameFixture g = playing();
        eliminateCarol(g);
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        g.check(approve(g, g.room.buyInRequests().pending().get(0), replace("p2")));

        g.check(g.sendWithoutHand("a", "CANCEL_BUY_IN", "{\"playerId\":\"p3\"}"));

        assertThat(g.room.hasParticipant("c")).isTrue();
        assertThat(g.room.playerIds().get("c")).isEqualTo("p2");
        assertThat(player(g.room, "p2").eliminated).isTrue();
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
    }

    // 이름이 기존 참가자(탈락자 포함)와 같으면 거절하는지 확인한다
    @Test
    void aNameOfAnyParticipantIsADuplicate() {
        GameFixture g = playing();
        eliminateCarol(g);

        assertThat(refusal(g.room, "bob")).isEqualTo("DUPLICATE_NAME");
        assertThat(refusal(g.room, "CAROL")).isEqualTo("DUPLICATE_NAME");
        assertThat(refusal(g.room, "bad_name!")).isEqualTo("INVALID_NAME");
    }

    // 방 인원이 15명이면 새 사람의 신청을 거절하는지 확인한다
    @Test
    void aRoomOfFifteenRefusesNewcomers() {
        assertThat(Room.MAX_WITH_BUY_INS).isEqualTo(15);
        GameFixture g = playing();
        BuyInRequests.Request early = ask(g.room, "Erin");
        for (int i = 0; g.room.participants().size() < Room.MAX_WITH_BUY_INS; i++) {
            g.room.addBoughtInParticipant("x" + i, "N" + i, "cred-x" + i, clock.instant());
        }

        assertThat(refusal(g.room, "Late")).isEqualTo("ROOM_FULL");
        assertThat(code(approve(g, early, between("p2")))).isEqualTo("ROOM_FULL");
        assertThat(statusOf(g.room, early)).isEqualTo(Status.PENDING);
    }

    // 대기실은 여전히 10명까지만 받는지 확인한다(15명은 진행 중 바이인 경로에만 쓴다)
    @Test
    void aWaitingRoomStillSeatsAtMostTen() {
        CommandFixture f = new CommandFixture(4, clock);
        for (int i = 0; f.room.participants().size() < 10; i++) {
            f.room.addParticipant("w" + i, "W" + i, "cred-w" + i, clock.instant());
        }

        assertThatThrownBy(() -> f.room.addParticipant("late", "Late", "cred-late", clock.instant()))
                .isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("ROOM_FULL");
        assertThat(Room.MAX_PARTICIPANTS).isEqualTo(10);
    }

    // 원래 카드가 아직 자리에 있으면 재입장은 그 자리로만 승인되는지 확인한다
    @Test
    void aReentryWhoseCardIsStillSeatedGoesBackToThatSeatOnly() {
        GameFixture g = playing();
        eliminateCarol(g);
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        BuyInRequests.Request r = g.room.buyInRequests().pending().get(0);
        GameState before = g.room.game();

        assertThat(code(approve(g, r, between("p0")))).isEqualTo("INVALID_SEATS");
        assertThat(code(approve(g, r, replace("p1")))).isEqualTo("INVALID_SEATS");

        assertThat(g.room.game()).isSameAs(before);
        assertThat(g.room.playerIds().get("c")).isEqualTo("p2");
        assertThat(statusOf(g.room, r)).isEqualTo(Status.PENDING);
        g.check(approve(g, r, replace("p2")));
        assertThat(g.room.game().players.stream().filter(p -> p.name.equals("Carol")).count()).isEqualTo(1);
    }

    // 원래 자리를 다른 사람이 차지했으면 방장이 다른 자리를 고를 수 있는지 확인한다
    @Test
    void aReentryWhoseSeatWasTakenMayGoElsewhere() {
        GameFixture g = playing();
        eliminateCarol(g);
        g.check(approve(g, ask(g.room, "Erin"), replace("p2")));
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        BuyInRequests.Request r = g.room.buyInRequests().pending().get(0);

        g.check(approve(g, r, between("p0")));

        assertThat(g.room.playerIds().get("c")).isEqualTo("p4");
        assertThat(player(g.room, "p4").name).isEqualTo("Carol");
    }

    // 방장에게는 대기 신청이, 재입장 신청자에게는 자기 신청만 보이고 자격은 어디에도 없는지 확인한다
    @Test
    void theHostSeesPendingRequestsTheAskerSeesTheirOwnAndNoCredentialShows() {
        GameFixture g = playing();
        eliminateCarol(g);
        BuyInRequests.Request erin = ask(g.room, "Erin");
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));

        JsonNode host = listFor(g.room, "a");
        assertThat(host).hasSize(2);
        JsonNode row = host.get(0);
        assertThat(row.propertyNames()).containsExactlyInAnyOrder(
                "buyInRequestId", "name", "reentryOf", "requestedAt", "expiresAt");
        assertThat(row.get("buyInRequestId").asString()).isEqualTo(erin.id());
        assertThat(row.get("reentryOf").isNull()).isTrue();
        assertThat(row.get("expiresAt").asString()).isEqualTo("2026-11-21T00:05:00Z");
        assertThat(host.get(1).get("reentryOf").asString()).isEqualTo("p2");
        assertThat(listFor(g.room, "b")).isEmpty();
        assertThat(listFor(g.room, "c")).hasSize(1);

        g.check(approve(g, erin, between("p1")));
        String credential = g.room.buyInRequests().find(erin.id()).orElseThrow().credential();
        for (Participant p : g.room.participants()) {
            assertThat(SnapshotWriter.snapshot(g.room, p).json().toString()).doesNotContain(credential);
        }
    }

    // 스냅샷의 게임 JSON이 바이인으로 바뀐 필드를 다시 읽어도 그대로인지 확인한다
    @Test
    void theSnapshotGameRoundTripsTheBuyInFields() {
        GameFixture g = playing();
        eliminateCarol(g);
        g.check(g.sendWithoutHand("c", "REQUEST_BUY_IN", "{}"));
        g.check(approve(g, g.room.buyInRequests().pending().get(0), replace("p2")));
        g.check(approve(g, ask(g.room, "Erin"), between("p0")));

        JsonNode written = SnapshotWriter.snapshot(g.room, g.room.participant("a").orElseThrow()).json().get("game");
        GameState read = GameJson.readState(written);

        assertThat(GameJson.writeState(read)).isEqualTo(written);
        assertThat(read.formerPlayers).extracting(FormerPlayer::id).containsExactly("p2");
        assertThat(read.players).extracting(p -> p.entry).contains(2, 1);
        assertThat(read.players).filteredOn(p -> p.joining != null).hasSize(2);
        assertThat(SnapshotWriter.snapshot(g.room, g.room.participant("a").orElseThrow()).json()
                .get("participants")).hasSize(4);
        List<String> linked = g.room.participants().stream().map(p -> g.room.playerIds().get(p.participantId()))
                .toList();
        assertThat(linked).doesNotContainNull().doesNotHaveDuplicates();
    }
}
