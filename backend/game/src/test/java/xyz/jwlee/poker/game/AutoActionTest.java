package xyz.jwlee.poker.game;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.ActionType;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.TransitionContext;

// 엔진의 자동 체크/폴드가 취소 스냅샷과 정산을 올바르게 다루는지 검증한다
class AutoActionTest {
    private static final TransitionContext CTX = new TransitionContext("T", "2026-10-31T00:00:00Z");

    // 이벤트 id가 겹치지 않도록 상태 버전을 접두로 쓰는 컨텍스트를 만든다
    private static TransitionContext ctx(GameState s) {
        return new TransitionContext("T" + s.version, CTX.at());
    }

    // 명령을 적용하고 거절되면 실패시킨다
    private static TransitionResult.Applied apply(GameState s, GameCommand cmd) {
        TransitionResult r = GameEngine.transition(s, cmd, ctx(s));
        assertThat(r).isInstanceOf(TransitionResult.Applied.class);
        return (TransitionResult.Applied) r;
    }

    // 자동 행동을 적용하고 거절되면 실패시킨다
    private static TransitionResult.Applied auto(GameState s) {
        TransitionResult r = GameEngine.autoAct(s, ctx(s));
        assertThat(r).isInstanceOf(TransitionResult.Applied.class);
        return (TransitionResult.Applied) r;
    }

    // 시작한 직후의 상태를 만든다
    private static GameState started(int players) {
        List<String> names = List.of("A", "B", "C").subList(0, players);
        GameState s = Tournament.create(new GameSettings(names, 1000, 5, 10, 0), CTX);
        return apply(s, new GameCommand.StartTournament()).state();
    }

    // 현재 행동자 id로 콜한다
    private static GameState call(GameState s) {
        return apply(s, new GameCommand.Call(s.hand.actorId)).state();
    }

    // 첫 이벤트를 베팅 행동 상세로 읽는다
    private static EventDetails.PlayerActed acted(TransitionResult.Applied r) {
        return (EventDetails.PlayerActed) r.events().get(0).details();
    }

    // 낼 몫이 없으면 체크하고 이벤트에 자동 표시를 남기는지 확인한다
    @Test
    void checksWhenNothingIsOwedAndMarksTheEventAutomatic() {
        GameState s = call(call(started(3))); // UTG and SB call, the big blind owes nothing
        TransitionResult.Applied r = auto(s);

        assertThat(acted(r).action()).isEqualTo(ActionType.CHECK);
        assertThat(acted(r).automatic()).isTrue();
        assertThat(acted(r).playerId()).isEqualTo(s.hand.actorId);
    }

    // 낼 몫이 있으면 폴드하고 이벤트에 자동 표시를 남기는지 확인한다
    @Test
    void foldsWhenACallIsOwedAndMarksTheEventAutomatic() {
        GameState s = started(3);
        TransitionResult.Applied r = auto(s);

        assertThat(acted(r).action()).isEqualTo(ActionType.FOLD);
        assertThat(acted(r).automatic()).isTrue();
        assertThat(r.state().version).isEqualTo(s.version + 1);
    }

    // 사람이 한 행동에는 자동 표시가 붙지 않는지 확인한다
    @Test
    void aHumanActionIsNotMarkedAutomatic() {
        TransitionResult.Applied r = apply(started(3), new GameCommand.Fold(null));
        assertThat(acted(r).automatic()).isFalse();
    }

    // 자동 행동이 사람 행동 이전의 스냅샷을 유지하고 이벤트를 덧붙이는지 확인한다
    @Test
    void anAutomaticActionKeepsTheSnapshotBeforeTheHumanActionAndAppendsItsEvents() {
        GameState before = started(3);
        TransitionResult.Applied human = apply(before, new GameCommand.Call(null));
        TransitionResult.Applied autoStep = auto(human.state());

        assertThat(autoStep.state().undo.state().version).isEqualTo(before.version);
        assertThat(autoStep.state().undo.state().hand.actorId).isEqualTo(before.hand.actorId);
        List<String> expected = new ArrayList<>(human.state().undo.eventIds());
        autoStep.events().forEach(e -> expected.add(e.id()));
        assertThat(autoStep.state().undo.eventIds()).containsExactlyElementsOf(expected);
        assertThat(human.state().undo.eventIds())
                .doesNotContainAnyElementsOf(autoStep.events().stream().map(GameEvent::id).toList());
    }

    // 자동 행동 뒤 되돌리면 사람 행동 이전 상태로 돌아가는지 확인한다
    @Test
    void undoingAfterAnAutomaticActionRestoresTheStateBeforeTheHumanAction() {
        GameState before = started(3);
        GameState afterHuman = apply(before, new GameCommand.Call(null)).state();
        TransitionResult.Applied autoStep = auto(afterHuman);
        TransitionResult.Applied undone = apply(autoStep.state(), new GameCommand.Undo());

        assertThat(undone.state().hand.actorId).isEqualTo(before.hand.actorId);
        assertThat(undone.state().players.stream().map(p -> p.stack).toList())
                .isEqualTo(before.players.stream().map(p -> p.stack).toList());
        assertThat(undone.state().players).noneMatch(p -> p.folded);
        EventDetails.ActionUndone details =
                (EventDetails.ActionUndone) undone.events().get(0).details();
        assertThat(details.eventIds()).containsAll(autoStep.events().stream().map(GameEvent::id).toList());
    }

    // 스냅샷이 없으면 자동 행동의 스냅샷도 null로 남는지 확인한다
    @Test
    void withoutASnapshotAnAutomaticActionLeavesItNull() {
        GameState s = started(3);
        assertThat(s.undo).isNull();
        assertThat(auto(s).state().undo).isNull();
    }

    // 자동 폴드로 핸드가 끝나면 정산하고 다음 핸드를 나누는지 확인한다
    @Test
    void anAutomaticFoldThatEndsTheHandPaysOutAndDealsTheNextHand() {
        GameState s = started(2); // heads-up: the small blind owes 5, so the automatic action folds
        TransitionResult.Applied r = auto(s);

        assertThat(r.events().stream().map(GameEvent::type).toList()).contains("FOLD", "PAYOUT", "HAND_START");
        GameState next = r.state();
        assertThat(next.hand.phase).isEqualTo(Phase.BETTING);
        assertThat(next.hand.id).isNotEqualTo(s.hand.id);
        int total = next.players.stream().mapToInt(p -> p.stack).sum() + next.pot;
        assertThat(total).isEqualTo(next.initialTotal);
    }

    // 행동할 차례인 사람이 없으면 자동 행동이 거부되는지 확인한다
    @Test
    void isRejectedWhenNobodyIsToAct() {
        GameState s = apply(started(2), new GameCommand.AllIn(null)).state();
        s = apply(s, new GameCommand.Call(null)).state();
        assertThat(s.hand.phase).isEqualTo(Phase.SETTLEMENT);

        assertThat(GameEngine.autoAct(s, ctx(s))).isInstanceOf(TransitionResult.Rejected.class);
    }
}
