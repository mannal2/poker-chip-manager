package xyz.jwlee.poker.game.command;

import java.util.List;
import xyz.jwlee.poker.game.Round;
import java.util.Objects;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.Blinds;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.model.UndoSnapshot;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.Rules;
import xyz.jwlee.poker.game.settings.SettingsValidator;

/** Hand-flow commands (TS {@code flow.ts}); undo, blind scheduling, settlement and abort. */
public final class FlowCommands {
    private FlowCommands() {}

    /** Pays the pots to the chosen winners, then starts the next hand or ends the tournament. */
    public static void settleHand(
            GameState s, GameCommand.SettleHand cmd, TransitionContext c, List<GameEvent> events) {
        Hand h = HandGuard.inPlay(s);
        Rules.require(h.phase == Phase.SETTLEMENT && cmd.winners() != null);
        Round.settle(s, cmd.winners(), c, events);
    }

    /** Restores the snapshot once; version is kept and a blind schedule made in the same hand survives. */
    public static void undo(GameState s, GameCommand.Undo cmd, TransitionContext c, List<GameEvent> events) {
        HandGuard.inPlay(s, true);
        Rules.require(s.undo != null, RuleErrorCode.UNDO_LOCKED);
        UndoSnapshot u = s.undo;
        GameState snap = u.copy().state();
        String currentHandId = s.hand == null ? null : s.hand.id;
        String snapshotHandId = snap.hand == null ? null : snap.hand.id;
        Blinds pending = Objects.equals(currentHandId, snapshotHandId) ? s.pendingBlinds : snap.pendingBlinds;
        // Every GameState field must be restored here: a field added to GameState and missed below
        // would survive the undo. Only version (kept, then bumped by the engine), pendingBlinds
        // (schedule made in the same hand survives) and undo (consumed) are deliberate exceptions.
        s.tournamentId = snap.tournamentId;
        s.status = snap.status;
        s.settings = snap.settings;
        s.initialTotal = snap.initialTotal;
        s.setupOrder = snap.setupOrder;
        s.players = snap.players;
        s.hand = snap.hand;
        s.pot = snap.pot;
        s.pendingBlinds = pending;
        s.undo = null;
        // TS omits eventIds when the snapshot has none; the Java event always carries a list.
        Round.emit(s, c, events, new EventDetails.ActionUndone(u.eventIds() == null ? List.of() : u.eventIds()));
    }

    /** Queues new blinds for the next hand; an undo snapshot keeps the schedule too. */
    public static void scheduleBlinds(
            GameState s, GameCommand.ScheduleBlinds cmd, TransitionContext c, List<GameEvent> events) {
        HandGuard.inPlay(s);
        Rules.require(
                SettingsValidator.validChips(cmd.smallBlind())
                        && SettingsValidator.validChips(cmd.bigBlind())
                        && cmd.smallBlind() < cmd.bigBlind(),
                RuleErrorCode.INVALID_BLINDS);
        s.pendingBlinds = new Blinds(cmd.smallBlind(), cmd.bigBlind());
        if (s.undo != null) {
            s.undo.state().pendingBlinds = s.pendingBlinds;
        }
        Round.emit(s, c, events, new EventDetails.BlindsScheduled(cmd.smallBlind(), cmd.bigBlind()));
    }

    /** Ends the tournament early. */
    public static void abort(GameState s, GameCommand.Abort cmd, TransitionContext c, List<GameEvent> events) {
        Hand h = HandGuard.inPlay(s);
        s.status = TournamentStatus.ABORTED;
        h.actorId = null;
        s.undo = null;
        Round.emit(s, c, events, new EventDetails.TournamentAborted());
    }
}
