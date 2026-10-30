package xyz.jwlee.poker.game.command;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import xyz.jwlee.poker.game.Round;
import xyz.jwlee.poker.game.Tournament;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.Rules;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

/** START_TOURNAMENT and SETUP_UPDATE. */
public final class SetupCommands {
    private SetupCommands() {}

    public static final CommandHandler<GameCommand.StartTournament> START_TOURNAMENT = (s, cmd, c, events) -> {
        Rules.require(s.status == TournamentStatus.SETUP);
        Rules.require(SettingsValidator.validate(s.settings) instanceof SettingsValidation.Valid);
        Rules.require(s.settings.button() >= 0, RuleErrorCode.DEALER_REQUIRED);
        s.status = TournamentStatus.PLAYING;
        Round.startHand(s, c, events);
    };

    public static final CommandHandler<GameCommand.SetupUpdate> SETUP_UPDATE = SetupCommands::setupUpdate;

    private static void setupUpdate(
            GameState s, GameCommand.SetupUpdate cmd, TransitionContext c, List<GameEvent> events) {
        Rules.require(s.status == TournamentStatus.SETUP && cmd.settings() != null);
        SettingsValidation validation = SettingsValidator.validate(cmd.settings());
        Rules.require(validation instanceof SettingsValidation.Valid, RuleErrorCode.INVALID_SETTINGS);
        var valid = ((SettingsValidation.Valid) validation).settings();
        List<Player> old = s.players;
        List<String> creation = s.setupOrder != null ? s.setupOrder : old.stream().map(p -> p.id).toList();
        List<String> order = cmd.order();
        if (order != null) {
            Rules.require(order.size() == valid.names().size()
                    && order.stream().allMatch(id -> old.stream().anyMatch(p -> p.id.equals(id))));
        }
        GameState fresh = Tournament.create(valid, new TransitionContext(s.tournamentId, c.at()));
        s.settings = fresh.settings;
        s.initialTotal = fresh.initialTotal;
        List<Player> players = new ArrayList<>();
        for (int i = 0; i < fresh.players.size(); i++) {
            Player p = fresh.players.get(i);
            p.id = order != null ? order.get(i) : i < old.size() ? old.get(i).id : c.id() + ":p" + i;
            players.add(p);
        }
        s.players = players;
        List<String> ids = players.stream().map(p -> p.id).toList();
        Rules.require(new HashSet<>(ids).size() == ids.size());
        List<String> next = new ArrayList<>(creation.stream().filter(ids::contains).toList());
        next.addAll(ids.stream().filter(id -> !creation.contains(id)).toList());
        s.setupOrder = next;
    }
}
