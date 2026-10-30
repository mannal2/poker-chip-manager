package xyz.jwlee.poker.game;

import java.util.ArrayList;
import java.util.List;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

public final class Tournament {
    private Tournament() {}

    /** Builds a setup-phase tournament; invalid settings throw {@link IllegalArgumentException} with the code. */
    public static GameState create(GameSettings settings, TransitionContext ctx) {
        SettingsValidation validation = SettingsValidator.validate(settings);
        if (validation instanceof SettingsValidation.Invalid invalid) {
            throw new IllegalArgumentException(invalid.code().name());
        }
        GameSettings valid = ((SettingsValidation.Valid) validation).settings();
        GameState s = new GameState();
        s.tournamentId = ctx.id();
        s.version = 0;
        s.status = TournamentStatus.SETUP;
        s.settings = valid;
        s.initialTotal = settings.initial() * settings.names().size();
        s.setupOrder = new ArrayList<>();
        s.players = new ArrayList<>();
        List<String> names = valid.names();
        for (int i = 0; i < names.size(); i++) {
            Player p = new Player();
            p.id = "p" + i;
            p.name = names.get(i);
            p.stack = settings.initial();
            s.setupOrder.add(p.id);
            s.players.add(p);
        }
        return s;
    }
}
