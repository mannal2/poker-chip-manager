package xyz.jwlee.poker.game;

import java.util.ArrayList;
import java.util.List;
import xyz.jwlee.poker.game.command.BettingCommands;
import xyz.jwlee.poker.game.command.FlowCommands;
import xyz.jwlee.poker.game.command.ForfeitCommand;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.command.SetupCommands;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.ActionType;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.model.UndoSnapshot;
import xyz.jwlee.poker.game.rule.RuleViolation;

// 규칙 엔진의 단일 진입점으로, 명령 하나를 상태 복사본에 적용한다
/** Single entry point of the rule engine: applies one command to a copy of the state. */
public final class GameEngine {
    private GameEngine() {}

    // 명령을 처리해 새 상태와 이벤트(또는 거절 코드)를 돌려준다
    /** Rejects with a rule code only for {@link RuleViolation}; any other failure propagates. */
    public static TransitionResult transition(GameState input, GameCommand cmd, TransitionContext c) {
        GameState s = input.copy();
        List<GameEvent> events = new ArrayList<>();
        try {
            // Sealed switch without default: a command without a handler fails to compile.
            switch (cmd) {
                case GameCommand.StartTournament x -> SetupCommands.START_TOURNAMENT.apply(s, x, c, events);
                case GameCommand.SetupUpdate x -> SetupCommands.SETUP_UPDATE.apply(s, x, c, events);
                case GameCommand.Check x -> BettingCommands.act(s, ActionType.CHECK, x.playerId(), 0, c, events);
                case GameCommand.Call x -> BettingCommands.act(s, ActionType.CALL, x.playerId(), 0, c, events);
                case GameCommand.Fold x -> BettingCommands.act(s, ActionType.FOLD, x.playerId(), 0, c, events);
                case GameCommand.AllIn x -> BettingCommands.act(s, ActionType.ALL_IN, x.playerId(), 0, c, events);
                case GameCommand.Bet x ->
                    BettingCommands.act(s, ActionType.BET, x.playerId(), x.additional(), c, events);
                case GameCommand.Raise x ->
                    BettingCommands.act(s, ActionType.RAISE, x.playerId(), x.additional(), c, events);
                case GameCommand.SettleHand x -> FlowCommands.settleHand(s, x, c, events);
                case GameCommand.ScheduleBlinds x -> FlowCommands.scheduleBlinds(s, x, c, events);
                case GameCommand.Undo x -> FlowCommands.undo(s, x, c, events);
                case GameCommand.Abort x -> FlowCommands.abort(s, x, c, events);
                case GameCommand.Forfeit x -> ForfeitCommand.forfeit(s, x, c, events);
            }
            if (isUndoable(cmd)) {
                GameState snapshot = input.copy();
                snapshot.undo = null;
                s.undo = new UndoSnapshot(snapshot, events.stream().map(GameEvent::id).toList());
            }
            s.version = input.version + 1;
            Invariants.check(s);
            return new TransitionResult.Applied(s, events);
        } catch (RuleViolation e) {
            return new TransitionResult.Rejected(e.code());
        }
    }

    // 되돌리기 스냅샷을 남겨야 하는 명령인지 판별한다
    /** Player actions and payouts can be undone once. */
    private static boolean isUndoable(GameCommand cmd) {
        return cmd instanceof GameCommand.Check
                || cmd instanceof GameCommand.Call
                || cmd instanceof GameCommand.Bet
                || cmd instanceof GameCommand.Raise
                || cmd instanceof GameCommand.Fold
                || cmd instanceof GameCommand.AllIn
                || cmd instanceof GameCommand.SettleHand;
    }
}
