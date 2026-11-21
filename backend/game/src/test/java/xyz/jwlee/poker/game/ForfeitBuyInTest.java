package xyz.jwlee.poker.game;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.game.command.BuyInPlacement;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.RuleErrorCode;

// 기권(서버 전용)이 카드를 기다리는 바이인을 건드리지 않는지 검증한다
class ForfeitBuyInTest {
    private static final TransitionContext CTX = new TransitionContext("T", "2026-11-21T00:00:00Z");

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

    // 3명이 시작하고 D가 p2 뒤에 바이인해 다음 핸드를 기다리는 상태를 만든다
    private static GameState startedWithWaitingBuyIn() {
        GameState s = Tournament.create(new GameSettings(List.of("A", "B", "C"), 1000, 5, 10, 0), CTX);
        s = apply(s, new GameCommand.StartTournament()).state();
        s = apply(s, new GameCommand.BuyIn("D", new BuyInPlacement.Between("p2"), null)).state();
        assertThat(player(s, "p3").joining).isNotNull();
        return s;
    }

    // id로 플레이어를 찾는다
    private static Player player(GameState s, String id) {
        return s.players.stream().filter(p -> p.id.equals(id)).findFirst().orElseThrow();
    }

    // 기권한 스택을 나눌 때 카드를 기다리는 바이인은 몫을 받지 않는지 확인한다
    @Test
    void aWaitingBuyInGetsNoShareOfAForfeitedStack() {
        GameState s = startedWithWaitingBuyIn();
        String forfeiter = s.hand.actorId;
        s = apply(s, new GameCommand.Forfeit(forfeiter, true)).state();
        TransitionResult.Applied ended = apply(s, new GameCommand.Fold(s.hand.actorId));

        EventDetails.ForfeitStackSplit split = ended.events().stream()
                .map(e -> e.details())
                .filter(d -> d instanceof EventDetails.ForfeitStackSplit)
                .map(d -> (EventDetails.ForfeitStackSplit) d)
                .findFirst().orElseThrow();
        assertThat(split.playerId()).isEqualTo(forfeiter);
        assertThat(split.shares().keySet()).containsExactly("p1", "p2");
    }

    // 카드를 기다리는 바이인은 기권시킬 수 없는지 확인한다(방장은 바이인 취소를 쓴다)
    @Test
    void aWaitingBuyInCannotForfeit() {
        GameState s = startedWithWaitingBuyIn();

        TransitionResult r = GameEngine.transition(s, new GameCommand.Forfeit("p3", true), ctx(s));

        assertThat(r).isEqualTo(new TransitionResult.Rejected(RuleErrorCode.INVALID_ACTION));
    }
}
