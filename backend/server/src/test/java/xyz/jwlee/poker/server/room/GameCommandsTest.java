package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.TournamentStatus;

class GameCommandsTest {

    private static String code(CommandResult r) {
        return CommandFixture.code(r);
    }

    private static void assertRejected(GameFixture f, CommandResult r, String code) {
        assertThat(code(r)).isEqualTo(code);
        assertThat(r.outcome().outcome()).isEqualTo(RequestOutcome.Outcome.REJECTED);
        assertThat(f.room.version()).isEqualTo(r.outcome().resultStateVersion());
    }

    // ---- START ----

    @Test
    void startSeatsTheGameFromTheWaitingRoom() {
        GameFixture f = new GameFixture(3, 0);
        long before = f.room.version();

        f.check(f.send("a", "START", "{}"));

        assertThat(f.room.phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(f.room.version()).isEqualTo(before + 1);
        assertThat(f.room.game().tournamentId).isNotBlank().doesNotContain("req-");
        assertThat(f.room.game().pot).isEqualTo(15);
        assertThat(f.room.game().hand.actorId).isEqualTo("p0");
        assertThat(f.room.playerIds()).containsEntry("a", "p0").containsEntry("b", "p1").containsEntry("c", "p2");
        assertThat(f.room.lastStartSettings()).isEqualTo(new RoomSettings(1000, 5, 10, 0));
        assertThat(f.room.events()).isNotEmpty();
        assertThat(f.room.events().get(0).type()).isEqualTo("HAND_START");
        assertThat(f.room.events().get(0).id()).doesNotContain("req-").endsWith(":0");
        assertThat(f.room.game().hand.id).isEqualTo(f.room.game().tournamentId + ":hand:1");
    }

    @Test
    void startFollowsTheSeatOrderAndTheDealerSeat() {
        GameFixture f = new GameFixture(3, 0);
        f.check(f.send("a", "SET_SEAT_ORDER", "{\"participantIds\":[\"c\",\"a\",\"b\"]}"));
        f.check(f.send("a", "SET_DEALER", "{\"participantId\":\"a\"}"));

        f.check(f.send("a", "START", "{}"));

        assertThat(f.room.playerIds()).containsEntry("c", "p0").containsEntry("a", "p1").containsEntry("b", "p2");
        assertThat(f.room.game().players.get(0).name).isEqualTo("Carol");
        assertThat(f.room.game().hand.buttonSeat).isEqualTo(1);
    }

    @Test
    void startIsForTheHostAndNeedsAStartableRoom() {
        GameFixture f = new GameFixture(3, 0);
        assertRejected(f, f.send("b", "START", "{}"), "FORBIDDEN");

        CommandFixture one = new CommandFixture(1);
        assertThat(code(one.send("a", "START", "{}"))).isEqualTo("PLAYER_COUNT");

        CommandFixture noDealer = new CommandFixture(3);
        assertThat(code(noDealer.send("a", "START", "{}"))).isEqualTo("NO_DEALER");
        assertThat(noDealer.room.game()).isNull();
        assertThat(noDealer.room.phase()).isEqualTo(RoomPhase.WAITING);
    }

    @Test
    void startIsRefusedOnceTheGameRuns() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("a", "START", "{}"), "NOT_WAITING");
    }

    // ---- betting ----

    @Test
    void theBlindsArePaidAndTheActorIsTheSeatAfterTheBigBlind() {
        GameFixture f = GameFixture.started(3, 0);

        assertThat(f.room.game().players.get(1).stack).isEqualTo(995);
        assertThat(f.room.game().players.get(2).stack).isEqualTo(990);
        assertThat(f.room.game().pot).isEqualTo(15);
        assertThat(f.actor()).isEqualTo("a");
    }

    @Test
    void onlyTheActorMayBet() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("b", "CALL", null), "NOT_YOUR_TURN");
        assertRejected(f, f.send("c", "FOLD", null), "NOT_YOUR_TURN");
        assertThat(f.room.events()).hasSize(1);
    }

    @Test
    void aPlayerIdInThePayloadIsIgnoredAndTheRequesterIsUsed() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("b", "CALL", "{\"playerId\":\"p0\"}"), "NOT_YOUR_TURN");

        f.check(f.send("a", "CALL", "{\"playerId\":\"p1\"}"));
        assertThat(f.room.game().players.get(0).stack).isEqualTo(990);
        assertThat(f.room.game().players.get(1).stack).isEqualTo(995);
    }

    @Test
    void foldingWhenNothingIsOwedIsRefused() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));

        assertRejected(f, f.send("c", "FOLD", null), "INVALID_ACTION");

        f.check(f.send("c", "CHECK", null));
    }

    @Test
    void foldingWhenSomethingIsOwedIsAllowed() {
        GameFixture f = GameFixture.started(3, 0);

        f.check(f.send("a", "FOLD", null));

        assertThat(f.room.game().players.get(0).folded).isTrue();
    }

    @Test
    void betAndRaiseNeedAnIntegerAmount() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("a", "RAISE", null), "INVALID_INPUT");
        assertRejected(f, f.send("a", "RAISE", "{\"additional\":\"20\"}"), "INVALID_INPUT");

        f.check(f.send("a", "RAISE", "{\"additional\":20}"));
        assertThat(f.room.game().players.get(0).stack).isEqualTo(980);
    }

    @Test
    void anEngineRuleRejectionIsRecordedWithItsCode() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("a", "RAISE", "{\"additional\":11}"), "INVALID_AMOUNT");
    }

    @Test
    void bettingBeforeTheGameStartsIsInvalid() {
        GameFixture f = new GameFixture(3, 0);

        assertRejected(f, f.send("a", "CALL", null), "INVALID_ACTION");
    }

    @Test
    void everyEngineEventGetsTheNextSequenceNumberInOrder() {
        GameFixture f = GameFixture.started(3, 0);
        int atStart = f.room.events().size();

        f.check(f.send("a", "CALL", null));

        assertThat(f.room.events()).hasSize(atStart + 1);
        assertThat(f.room.events().get(atStart).type()).isEqualTo("CALL");
        assertThat(f.room.events().get(atStart).id()).doesNotContain("req-").endsWith(":0");
    }

    // ---- scope ----

    @Test
    void aBettingCommandMustNameTheCurrentHand() {
        GameFixture f = GameFixture.started(3, 0);
        String tournament = f.room.game().tournamentId;

        assertRejected(f, f.sendScoped("a", "CALL", null, tournament, "old-hand"), "TOURNAMENT_CHANGED");
        assertRejected(f, f.sendScoped("a", "CALL", null, tournament, null), "TOURNAMENT_CHANGED");
        assertRejected(f, f.sendScoped("a", "CALL", null, "other", f.room.game().hand.id), "TOURNAMENT_CHANGED");
    }

    @Test
    void aCommandThatCrossesHandsMayLeaveTheHandOut() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));

        f.check(f.sendWithoutHand("a", "UNDO", "{}"));

        assertThat(f.room.game().players.get(0).stack).isEqualTo(1000);
        assertRejected(f, f.sendScoped("a", "SCHEDULE_BLINDS", "{\"sb\":10,\"bb\":20}",
                f.room.game().tournamentId, "old-hand"), "TOURNAMENT_CHANGED");
    }

    // ---- host-only commands ----

    @Test
    void undoIsForTheHostAndRestoresTheLastAction() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("a", "UNDO", "{}"), "UNDO_LOCKED");
        f.check(f.send("a", "CALL", null));
        assertRejected(f, f.send("b", "UNDO", "{}"), "FORBIDDEN");

        f.check(f.send("a", "UNDO", "{}"));

        assertThat(f.room.game().players.get(0).stack).isEqualTo(1000);
        assertThat(f.room.game().hand.actorId).isEqualTo("p0");
        assertThat(f.room.events().get(f.room.events().size() - 1).type()).isEqualTo("UNDO");
        assertThat(f.room.events()).hasSize(3);
    }

    @Test
    void scheduledBlindsApplyFromTheNextHand() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("b", "SCHEDULE_BLINDS", "{\"sb\":10,\"bb\":20}"), "FORBIDDEN");
        assertRejected(f, f.send("a", "SCHEDULE_BLINDS", "{\"sb\":20,\"bb\":10}"), "INVALID_BLINDS");
        assertRejected(f, f.send("a", "SCHEDULE_BLINDS", "{\"sb\":10}"), "INVALID_INPUT");
        f.check(f.send("a", "SCHEDULE_BLINDS", "{\"sb\":10,\"bb\":20}"));
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));
        f.check(f.send("c", "CHECK", null));
        f.checkDown();
        f.check(f.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}"));

        assertThat(f.room.game().hand.number).isEqualTo(2);
        assertThat(f.room.game().hand.smallBlind).isEqualTo(10);
        assertThat(f.room.game().hand.bigBlind).isEqualTo(20);
    }

    // ---- settlement ----

    private static GameFixture atSettlement() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("a", "CALL", null));
        f.check(f.send("b", "CALL", null));
        f.check(f.send("c", "CHECK", null));
        f.checkDown();
        assertThat(f.room.game().hand.phase).isEqualTo(Phase.SETTLEMENT);
        return f;
    }

    @Test
    void aHandPlaysToShowdownThenTheWinnerGetsThePotAndTheNextHandMovesTheBlinds() {
        GameFixture f = atSettlement();
        assertThat(f.room.game().pot).isEqualTo(30);

        assertRejected(f, f.send("b", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}"), "FORBIDDEN");
        f.check(f.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}"));

        assertThat(f.room.phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(f.room.game().hand.number).isEqualTo(2);
        assertThat(f.room.game().hand.buttonSeat).isEqualTo(1);
        assertThat(f.room.game().hand.sbSeat).isEqualTo(2);
        assertThat(f.room.game().hand.bbSeat).isEqualTo(0);
        assertThat(f.room.game().players.get(1).stack).isEqualTo(1020);
        assertThat(f.room.game().players.get(2).stack).isEqualTo(985);
        assertThat(f.room.game().players.get(0).stack).isEqualTo(980);
        assertThat(f.room.game().pot).isEqualTo(15);
    }

    @Test
    void settleHandWithAnIneligibleWinnerIsRefusedByTheEngine() {
        GameFixture f = atSettlement();

        assertRejected(f, f.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p9\"]}}"), "WINNER_REQUIRED");
        assertRejected(f, f.send("a", "SETTLE_HAND", "{}"), "INVALID_INPUT");
    }

    @Test
    void aDraftIsSavedWithoutChangingTheRoomVersion() {
        GameFixture f = atSettlement();
        long version = f.room.version();

        CommandResult first = f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}");
        f.check(first);
        CommandResult second = f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p2\"]}}");
        f.check(second);

        assertThat(f.room.version()).isEqualTo(version);
        assertThat(first.outcome().resultStateVersion()).isEqualTo(version);
        assertThat(f.room.settlementDraft().draftVersion()).isEqualTo(2);
        assertThat(f.room.settlementDraft().winners()).containsEntry("pot0", List.of("p2"));
    }

    @Test
    void aDraftNeedsTheHostTheSettlementPhaseAndEligibleWinners() {
        GameFixture playing = GameFixture.started(3, 0);
        assertRejected(playing, playing.send("a", "SETTLEMENT_DRAFT",
                "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}"), "INVALID_ACTION");

        GameFixture f = atSettlement();
        assertRejected(f, f.send("b", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}"),
                "FORBIDDEN");
        assertRejected(f, f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p9\"]}}"),
                "INVALID_INPUT");
        assertRejected(f, f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot7\":[\"p1\"]}}"),
                "INVALID_INPUT");
        assertRejected(f, f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":9,\"winners\":{}}"), "INVALID_INPUT");
        assertRejected(f, f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":1,\"winners\":{}}"), "INVALID_INPUT");
        assertRejected(f, f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":-1,\"winners\":{}}"), "INVALID_INPUT");
        f.check(f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{}}"));
        assertRejected(f, f.send("a", "SETTLEMENT_DRAFT", "{\"winners\":{}}"), "INVALID_INPUT");
        assertThat(f.room.settlementDraft().potIndex()).isZero();
    }

    @Test
    void theDraftSurvivesSchedulingBlindsDuringSettlement() {
        GameFixture f = atSettlement();
        f.check(f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}"));

        f.check(f.send("a", "SCHEDULE_BLINDS", "{\"sb\":10,\"bb\":20}"));

        assertThat(f.room.settlementDraft()).isNotNull();
        assertThat(f.room.settlementDraft().draftVersion()).isEqualTo(1);
    }

    @Test
    void aRaiseBelowTheMinimumIsMinRaise() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("a", "RAISE", "{\"additional\":15}"), "MIN_RAISE");
    }

    @Test
    void theDraftIsClearedBySettlementUndoAbortAndAHostChange() {
        String draft = "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}";

        GameFixture settled = atSettlement();
        settled.check(settled.send("a", "SETTLEMENT_DRAFT", draft));
        settled.check(settled.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}"));
        assertThat(settled.room.settlementDraft()).isNull();

        GameFixture undone = atSettlement();
        undone.check(undone.send("a", "SETTLEMENT_DRAFT", draft));
        undone.check(undone.send("a", "UNDO", "{}"));
        assertThat(undone.room.settlementDraft()).isNull();

        GameFixture aborted = atSettlement();
        aborted.check(aborted.send("a", "SETTLEMENT_DRAFT", draft));
        aborted.check(aborted.send("a", "ABORT", "{}"));
        assertThat(aborted.room.settlementDraft()).isNull();

        GameFixture handedOver = atSettlement();
        handedOver.check(handedOver.send("a", "SETTLEMENT_DRAFT", draft));
        handedOver.check(handedOver.send("a", "TRANSFER_HOST", "{\"participantId\":\"c\"}"));
        assertThat(handedOver.room.settlementDraft()).isNull();
        assertThat(handedOver.room.hostId()).isEqualTo("c");
    }

    @Test
    void theDraftVersionKeepsGrowingAcrossAClear() {
        GameFixture f = atSettlement();
        String draft = "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}";
        f.check(f.send("a", "SETTLEMENT_DRAFT", draft));
        f.check(f.send("a", "UNDO", "{}"));
        f.checkDown();

        f.check(f.send("a", "SETTLEMENT_DRAFT", draft));

        assertThat(f.room.settlementDraft().draftVersion()).isEqualTo(2);
    }

    // ---- ending ----

    private static GameFixture headsUpAllInAndSettled() {
        GameFixture f = GameFixture.started(2, 0);
        f.check(f.send("a", "ALL_IN", null));
        f.check(f.send("b", "CALL", null));
        assertThat(f.room.game().hand.phase).isEqualTo(Phase.SETTLEMENT);
        f.check(f.send("a", "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}"));
        return f;
    }

    @Test
    void theLastPlayerLeftEndsTheGameWithTheResultPhaseAndUndoGoesBack() {
        GameFixture f = headsUpAllInAndSettled();

        assertThat(f.room.game().status).isEqualTo(TournamentStatus.ENDED);
        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);

        f.check(f.sendWithoutHand("a", "UNDO", "{}"));

        assertThat(f.room.game().status).isEqualTo(TournamentStatus.PLAYING);
        assertThat(f.room.phase()).isEqualTo(RoomPhase.PLAYING);
    }

    @Test
    void abortEndsTheGameForTheHostOnly() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("b", "ABORT", "{}"), "FORBIDDEN");
        f.check(f.send("a", "ABORT", "{}"));

        assertThat(f.room.game().status).isEqualTo(TournamentStatus.ABORTED);
        assertThat(f.room.phase()).isEqualTo(RoomPhase.RESULT);
        assertRejected(f, f.send("a", "CHECK", null), "INVALID_ACTION");
    }

    // ---- forfeit and host handover ----

    @Test
    void aParticipantForfeitsThemselvesAndStaysOnTheRoster() {
        GameFixture f = GameFixture.started(3, 0);

        f.check(f.send("b", "FORFEIT", "{}"));

        assertThat(f.room.game().players.get(1).forfeited).isTrue();
        assertThat(f.room.hasParticipant("b")).isTrue();
        assertRejected(f, f.send("b", "FORFEIT", "{}"), "INVALID_ACTION");
    }

    @Test
    void theHostMustHandTheRoomOverBeforeForfeiting() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("a", "FORFEIT", "{}"), "TRANSFER_HOST_FIRST");

        f.check(f.send("a", "TRANSFER_HOST", "{\"participantId\":\"c\"}"));
        f.check(f.send("a", "FORFEIT", "{}"));
        assertThat(f.room.game().players.get(0).forfeited).isTrue();
    }

    @Test
    void forfeitNeedsARunningGame() {
        GameFixture f = new GameFixture(3, 0);

        assertRejected(f, f.send("b", "FORFEIT", "{}"), "INVALID_ACTION");
    }

    @Test
    void whileThePlayRunsTheRoomPassesOnlyToSomeoneStillIn() {
        GameFixture f = GameFixture.started(3, 0);
        f.check(f.send("b", "FORFEIT", "{}"));

        assertRejected(f, f.send("a", "TRANSFER_HOST", "{\"participantId\":\"b\"}"), "INVALID_INPUT");
        assertRejected(f, f.send("a", "TRANSFER_HOST", "{\"participantId\":\"zzz\"}"), "INVALID_INPUT");

        f.check(f.send("a", "TRANSFER_HOST", "{\"participantId\":\"c\"}"));
        assertThat(f.room.hostId()).isEqualTo("c");
    }

    @Test
    void leaveAndKickStayRefusedWhilePlaying() {
        GameFixture f = GameFixture.started(3, 0);

        assertRejected(f, f.send("b", "LEAVE", "{}"), "NOT_WAITING");
        assertRejected(f, f.send("a", "KICK", "{\"participantId\":\"b\"}"), "NOT_WAITING");
    }

    // 같은 requestId 값으로 시작해도 토너먼트·핸드 ID가 겹치지 않는지 확인한다.
    @Test
    void startsWithTheSameRequestIdGetDifferentTournamentAndHandIds() {
        GameFixture first = GameFixture.started(3, 0);
        GameFixture second = GameFixture.started(3, 0);

        assertThat(second.room.game().tournamentId).isNotEqualTo(first.room.game().tournamentId);
        assertThat(second.room.game().hand.id).isNotEqualTo(first.room.game().hand.id);
    }
}
